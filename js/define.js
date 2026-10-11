// Dictionary look-up for a word picked from a clue or an answer. Needs a connection: definitions come from
// Wiktionary (dictionaryapi.dev as a back-up) and are kept for the rest of the session. Nothing but the word is sent.
import { h, dialog } from './ui/dom.js';

const cache = new Map();

export function cleanWord(text) {
  const w = String(text || '').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  return /^[A-Za-z][A-Za-z'\-]*$/.test(w) && w.length <= 40 ? w.toLowerCase() : '';
}

const plain = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html; // never inserted into the page: only its text is read
  return t.content.textContent.replace(/\s+/g, ' ').trim();
};

async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fromWiktionary(w) {
  const res = await getJSON('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('lookup failed');
  const data = await res.json();
  const meanings = [];
  for (const m of data.en || []) {
    const defs = (m.definitions || []).map((d) => plain(d.definition || '')).filter(Boolean).slice(0, 3);
    if (defs.length) meanings.push({ part: m.partOfSpeech || '', defs });
  }
  return meanings;
}

async function fromDictionaryApi(w) {
  const res = await getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('lookup failed');
  const data = await res.json();
  const meanings = [];
  for (const entry of Array.isArray(data) ? data : []) {
    for (const m of entry.meanings || []) {
      const defs = (m.definitions || []).slice(0, 3).map((d) => d.definition).filter(Boolean);
      if (defs.length) meanings.push({ part: m.partOfSpeech || '', defs });
    }
  }
  return meanings;
}

/** Resolves {word, meanings:[{part, defs:[string]}]}, or null when there is no entry. Rejects when offline. */
export async function lookup(word) {
  const w = cleanWord(word);
  if (!w) return null;
  if (cache.has(w)) return cache.get(w);
  let meanings;
  try {
    meanings = await fromWiktionary(w);
  } catch (e) {
    meanings = await fromDictionaryApi(w); // throws too when really offline
  }
  const out = meanings && meanings.length ? { word: w, meanings: meanings.slice(0, 5) } : null;
  cache.set(w, out);
  return out;
}

export function showDefinition(text) {
  const w = cleanWord(text);
  const body = h('div', { class: 'define' });
  const d = dialog({ title: w ? w : 'Look up a word', body, buttons: [{ label: 'Close', value: true, primary: true }] });
  if (!w) {
    body.textContent = 'Pick a single word to look up.';
    return d;
  }
  body.append(h('p', { class: 'muted' }, 'Looking it up…'));
  lookup(w).then(
    (r) => {
      body.textContent = '';
      if (!r) {
        body.append(h('p', null, 'No dictionary entry for “' + w + '”. Try the base form of the word, such as without “s” or “ing”.'));
        return;
      }
      for (const m of r.meanings) {
        body.append(h('h3', { class: 'define-part' }, m.part), h('ol', { class: 'define-defs' }, m.defs.map((x) => h('li', null, x))));
      }
    },
    () => {
      body.textContent = '';
      body.append(h('p', null, 'Could not reach the dictionary. Check your connection and try again.'));
    }
  );
  return d;
}

/**
 * Show a small "Define" chip beside a one-word selection made inside `root`. The chip is fixed-position, so it never moves
 * anything else on the page.
 */
export function watchSelection(root) {
  const chip = h('button', { class: 'define-chip', type: 'button', hidden: true }, 'Define');
  document.body.append(chip);
  let word = '';
  chip.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection
  chip.addEventListener('click', () => {
    chip.hidden = true;
    showDefinition(word);
  });
  const update = () => {
    const sel = window.getSelection();
    word = '';
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      chip.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    word = cleanWord(sel.toString());
    if (!word || !el || !root.contains(el) || !el.closest('.ct, .cb-main')) {
      chip.hidden = true;
      return;
    }
    const r = range.getBoundingClientRect();
    chip.style.left = Math.max(8, Math.min(window.innerWidth - 80, r.left + r.width / 2 - 36)) + 'px';
    chip.style.top = Math.max(8, r.top - 48) + 'px';
    chip.hidden = false;
  };
  document.addEventListener('selectionchange', update);
  return () => {
    document.removeEventListener('selectionchange', update);
    chip.remove();
  };
}
