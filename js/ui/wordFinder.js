// Pattern and anagram search over an English word list (loaded on first use).
import { h, dialog } from './dom.js';

const WORDS_URL = 'https://cdn.jsdelivr.net/npm/an-array-of-english-words@2.0.0/index.json';
const MAX_RESULTS = 150;

let byLength = null;
let loading = null;

async function loadWords() {
  if (byLength) return byLength;
  if (!loading) {
    loading = fetch(WORDS_URL)
      .then((r) => {
        if (!r.ok) throw new Error('word list ' + r.status);
        return r.json();
      })
      .then((list) => {
        const map = new Map();
        for (const w of list) {
          if (!/^[a-z]+$/.test(w)) continue;
          if (!map.has(w.length)) map.set(w.length, []);
          map.get(w.length).push(w);
        }
        byLength = map;
        return map;
      });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export function matchPattern(words, pattern) {
  const re = new RegExp('^' + pattern.toLowerCase().replace(/[^a-z]/g, '.') + '$');
  return words.filter((w) => re.test(w));
}

export function anagrams(words, letters) {
  const key = letters.toLowerCase().split('').sort().join('');
  return words.filter((w) => w.split('').sort().join('') === key);
}

/**
 * parts: [{ pattern:'C?T??', start, length }]  (one per word of the answer)
 * onPick(word, partIndex) fills the grid with pencil letters.
 */
export function openWordFinder({ title, parts, onPick }) {
  let mode = 'pattern';
  const inputs = parts.map((p, i) =>
    h('input', {
      id: 'wf-part-' + i,
      class: 'text-input mono',
      type: 'text',
      value: p.pattern,
      maxlength: p.length,
      autocapitalize: 'characters',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': `Pattern for part ${i + 1} of ${p.length} letters`,
    })
  );
  const anagramInput = h('input', { id: 'wf-anagram', class: 'text-input mono', type: 'text', placeholder: 'Letters to rearrange', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Letters to rearrange' });
  const results = h('div', { class: 'wf-results', 'aria-live': 'polite' });
  const patternBox = h('div', { class: 'wf-inputs' }, inputs.map((inp) => h('label', { class: 'field' }, h('span', null, 'Use ? for unknown letters'), inp)));
  const anagramBox = h('div', { class: 'wf-inputs', hidden: true }, h('label', { class: 'field' }, h('span', null, 'Anagram of'), anagramInput));
  const tabs = h('div', { class: 'seg' });
  const tabP = h('button', { type: 'button', class: 'seg-btn on', onclick: () => setMode('pattern') }, 'Pattern');
  const tabA = h('button', { type: 'button', class: 'seg-btn', onclick: () => setMode('anagram') }, 'Anagram');
  tabs.append(tabP, tabA);

  function setMode(m) {
    mode = m;
    tabP.classList.toggle('on', m === 'pattern');
    tabA.classList.toggle('on', m === 'anagram');
    patternBox.hidden = m !== 'pattern';
    anagramBox.hidden = m !== 'anagram';
    run();
  }

  function group(label, words, partIdx) {
    const box = h('div', { class: 'wf-group' });
    if (label) box.append(h('h3', { class: 'wf-label' }, label));
    if (!words.length) box.append(h('p', { class: 'muted' }, 'No matches.'));
    const list = h('div', { class: 'wf-words' });
    words.slice(0, MAX_RESULTS).forEach((w) =>
      list.append(h('button', { type: 'button', class: 'word-chip', onclick: () => { onPick(w.toUpperCase(), partIdx); d.close(); } }, w.toUpperCase()))
    );
    box.append(list);
    if (words.length > MAX_RESULTS) box.append(h('p', { class: 'muted' }, `Showing ${MAX_RESULTS} of ${words.length}. Add more letters to narrow it down.`));
    return box;
  }

  async function run() {
    results.textContent = '';
    results.append(h('p', { class: 'muted' }, 'Loading word list…'));
    let map;
    try {
      map = await loadWords();
    } catch (e) {
      results.textContent = '';
      results.append(h('p', { class: 'error' }, "Couldn't load the word list. Check your connection and try again."));
      return;
    }
    results.textContent = '';
    if (mode === 'pattern') {
      parts.forEach((p, i) => {
        const pat = inputs[i].value.trim();
        if (pat.length !== p.length) {
          results.append(h('p', { class: 'muted' }, `Part ${i + 1} needs ${p.length} characters.`));
          return;
        }
        results.append(group(parts.length > 1 ? `Word ${i + 1} (${p.length})` : '', matchPattern(map.get(p.length) || [], pat), i));
      });
    } else {
      const letters = anagramInput.value.replace(/[^a-zA-Z]/g, '');
      if (letters.length < 2) {
        results.append(h('p', { class: 'muted' }, 'Type the letters to rearrange.'));
        return;
      }
      // fill the whole answer (first part) when the length fits, otherwise just list the words
      const partIdx = parts.length === 1 && parts[0].length === letters.length ? 0 : -1;
      results.append(group('', anagrams(map.get(letters.length) || [], letters), partIdx));
    }
  }

  const body = h('div', { class: 'wf' }, tabs, patternBox, anagramBox, results);
  const d = dialog({ title: title || 'Word finder', body, wide: true, buttons: [{ label: 'Close', value: null }] });
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 150); };
  inputs.forEach((i) => i.addEventListener('input', later));
  anagramInput.addEventListener('input', later);
  run();
  return d;
}
