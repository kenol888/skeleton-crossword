// App shell: home screen, routing between screens, saved puzzles.
import { h, $, toast, actionSheet, confirmDialog, inputDialog } from './ui/dom.js';
import { loadIndex, loadPuzzleRaw, savePuzzle, deletePuzzle, storageAvailable, thumbOf } from './storage.js';
import { fromJSON, newId } from './model.js';
import { openPlay, closePlay } from './play.js';
import { startImport } from './importFlow.js';
import { heroArt, thumbSvg } from './homeArt.js';
import { icon } from './ui/icons.js';
import { applyTheme, currentTheme, openAppSettings } from './theme.js';
import { VERSION, BUILT } from './version.js';

const screens = {
  library: $('#screen-library'),
  import: $('#screen-import'),
  play: $('#screen-play'),
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ navigation
function showLibrary() {
  closePlay();
  renderLibrary();
  show('library');
}

function play(puzzle) {
  show('play');
  openPlay(puzzle, { container: screens.play, onExit: showLibrary });
}

function resume(id) {
  const raw = loadPuzzleRaw(id);
  if (!raw) {
    toast("That puzzle couldn't be opened.");
    renderLibrary();
    return;
  }
  try {
    play(fromJSON(raw));
  } catch (e) {
    toast("That puzzle's data is damaged and can't be opened.");
  }
}

function importFromImage() {
  show('import');
  startImport({
    container: screens.import,
    onDone: (p) => {
      savePuzzle(p);
      play(p);
    },
    onCancel: showLibrary,
  });
}

// ------------------------------------------------------------------ saved puzzles
function loadSaved(id) {
  const raw = loadPuzzleRaw(id);
  return raw ? fromJSON(raw) : null;
}

async function rename(entry) {
  const v = await inputDialog('Rename puzzle', 'Name', entry.title, { maxlength: 60, okLabel: 'Rename' });
  if (!v || !v.trim()) return;
  const p = loadSaved(entry.id);
  if (!p) return;
  p.title = v.trim();
  savePuzzle(p);
  renderLibrary();
}

function duplicate(entry) {
  const p = loadSaved(entry.id);
  if (!p) return;
  p.id = newId();
  p.title += ' (copy)';
  p.createdAt = Date.now();
  savePuzzle(p);
  renderLibrary();
}

async function remove(entry) {
  if (await confirmDialog('Delete this puzzle?', `"${entry.title}" and your progress will be removed from this device.`, 'Delete', true)) {
    deletePuzzle(entry.id);
    renderLibrary();
  }
}

// ------------------------------------------------------------------ version
// Shows which version this copy is and, when online, whether a newer one has been published.
// The answer is only trusted if the last check succeeded: a failed check says so, rather than
// leaving an old "latest version" on screen.
const upd = { state: 'idle', latest: null, checkedAt: null, applying: false }; // state: idle | checking | ok | error

const fmtBuilt = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const freshJson = async () => {
  // a unique address plus no-store, so neither the browser nor the host's cache can answer
  const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('status ' + res.status);
  return res.json();
};

async function checkForUpdate() {
  if (upd.state === 'checking') return;
  upd.state = 'checking';
  refreshVersionLine();
  try {
    const data = await freshJson();
    if (!Number.isInteger(data.version)) throw new Error('bad version file');
    upd.latest = data;
    upd.checkedAt = new Date();
    upd.state = 'ok';
    // also ask the browser to look for a new offline-cache script, which is what applies the update
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch (e) { /* not available in every browser */ }
  } catch (e) {
    upd.state = 'error';
  }
  refreshVersionLine();
}

async function applyUpdate() {
  if (upd.applying) return;
  upd.applying = true;
  refreshVersionLine();
  try {
    // GitHub Pages lets the browser keep files for ten minutes. Fetch every file again past that
    // cache first, so the reload below picks up the new ones and not the old copies.
    const meta = await freshJson();
    await Promise.all(['./', ...(meta.files || [])].map((f) => fetch(f, { cache: 'reload' })));
  } catch (e) { /* carry on: clearing the stored copies still helps */ }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) { /* carry on and reload anyway */ }
  location.reload();
}

function refreshVersionLine() {
  const el = document.getElementById('version-line');
  if (el) fillVersionLine(el);
}

function fillVersionLine(el) {
  el.textContent = '';
  el.append(h('span', { class: 'ver-num' }, `Version ${VERSION}`), h('span', null, fmtBuilt(BUILT)));
  if (upd.applying) el.append(h('span', { class: 'ver-new' }, 'Updating…'));
  else if (upd.state === 'checking') el.append(h('span', { class: 'muted' }, 'Checking for updates…'));
  else if (upd.state === 'error') el.append(h('span', { class: 'ver-new' }, "Couldn't check (offline?)"));
  else if (upd.state === 'ok') {
    if (upd.latest.version > VERSION) {
      el.append(h('span', { class: 'ver-new' }, `Version ${upd.latest.version} is available`), h('button', { class: 'btn small primary', type: 'button', onclick: applyUpdate }, 'Update now'));
    } else {
      el.append(h('span', { class: 'ver-ok' }, `Latest · checked ${fmtTime(upd.checkedAt)}`));
    }
  }
  if (upd.state !== 'checking' && !upd.applying) el.append(h('button', { class: 'btn small', type: 'button', onclick: checkForUpdate }, 'Check for updates'));
}

function versionLine() {
  const el = h('p', { class: 'version', id: 'version-line' });
  fillVersionLine(el);
  if (upd.state === 'idle') checkForUpdate(); // check once when the app opens
  return el;
}

// ------------------------------------------------------------------ home screen
const IMAGE_ICON =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5.5-5.5 4 4 2.5-2.5L21 18"/></svg>';

function card(entry) {
  const pct = Math.round((entry.progress || 0) * 100);
  const when = new Date(entry.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const rows = entry.rows || entry.size;
  const cols = entry.cols || entry.size;
  let thumb = entry.thumb;
  if (!thumb) {
    // saved by an older version: work the picture out from the stored puzzle
    try {
      const p = loadSaved(entry.id);
      thumb = p ? thumbOf(p) : '';
    } catch (e) {
      thumb = '';
    }
  }
  const more = h('button', { class: 'card-more', type: 'button', 'aria-label': 'More for ' + entry.title, onclick: () => actionSheet(entry.title, [
    { label: 'Rename', run: () => rename(entry) },
    { label: 'Duplicate', run: () => duplicate(entry) },
    { label: 'Delete', hint: 'Removes it and your progress from this device', run: () => remove(entry), danger: true },
  ]) }, '⋯');
  return h(
    'li',
    { class: 'card' },
    h(
      'button',
      { class: 'card-main', type: 'button', onclick: () => resume(entry.id) },
      h('span', { class: 'card-thumb' }, rows && cols ? thumbSvg(rows, cols, thumb) : null),
      h(
        'span',
        { class: 'card-body' },
        h('span', { class: 'card-title' }, entry.title),
        h('span', { class: 'card-meta' }, `${cols} × ${rows} · ${when}${entry.type === 'standard' ? ' \u00B7 Standard' : ''}`),
        h('span', { class: 'bar', role: 'img', 'aria-label': pct + ' percent filled' }, h('span', { class: 'bar-fill', style: `width:${pct}%` })),
        h('span', { class: 'card-pct' }, pct ? pct + '% filled' : 'Not started')
      )
    ),
    more
  );
}

function renderLibrary() {
  const entries = loadIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  const root = screens.library;
  root.textContent = '';
  const importBtn = h('button', { class: 'btn primary xl', type: 'button', onclick: importFromImage });
  importBtn.innerHTML = IMAGE_ICON + '<span>Import from image</span>';
  const gear = h('button', { class: 'home-gear', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: openAppSettings }, icon('settings', 24));
  root.append(
    h(
      'div',
      { class: 'home' },
      gear,
      h(
        'section',
        { class: 'hero' },
        h(
          'div',
          { class: 'hero-copy' },
          h('h1', null, h('span', null, 'Skeleton'), h('span', null, 'Crossword')),
          h('p', { class: 'tag' }, 'Work out the grid, then fill it in.'),
          importBtn,
          versionLine()
        ),
        h('div', { class: 'hero-art' }, heroArt())
      ),
      !storageAvailable() ? h('p', { class: 'notice' }, "This browser isn't keeping saved data, so puzzles will be lost when you close the page.") : null,
      h(
        'section',
        { class: 'shelf' },
        h('h2', null, 'Puzzles', entries.length ? h('span', { class: 'count-chip' }, String(entries.length)) : null),
        entries.length ? h('ul', { class: 'cards' }, entries.map(card)) : h('p', { class: 'shelf-empty' }, 'Puzzles you import will appear here.')
      )
    )
  );
}

// ------------------------------------------------------------------ boot
applyTheme(currentTheme());
renderLibrary();
show('library');

if ('serviceWorker' in navigator && !/[?&]nosw\b/.test(location.search)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode is optional */ });
  });
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
