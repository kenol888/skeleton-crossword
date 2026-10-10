// App shell: library screen, routing between screens, puzzle import/export.
import { h, $, toast, dialog, confirmDialog } from './ui/dom.js';
import { loadIndex, loadPuzzleRaw, savePuzzle, deletePuzzle, storageAvailable } from './storage.js';
import { fromJSON, toJSON, newId } from './model.js';
import { openPlay, closePlay } from './play.js';
import { startImport } from './importFlow.js';
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

function newFromPhoto() {
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

function newBlank() {
  const colsIn = h('input', { id: 'blank-cols', class: 'text-input', type: 'number', min: 3, max: 25, value: 15, inputmode: 'numeric', 'aria-label': 'Columns' });
  const rowsIn = h('input', { id: 'blank-rows', class: 'text-input', type: 'number', min: 3, max: 25, value: 11, inputmode: 'numeric', 'aria-label': 'Rows' });
  const name = h('input', { id: 'blank-name', class: 'text-input', type: 'text', maxlength: 60, 'aria-label': 'Puzzle name', placeholder: 'Skeleton ' + new Date().toLocaleDateString() });
  const body = h(
    'div',
    { class: 'form' },
    h('div', { class: 'two-up' }, h('label', { class: 'field', for: 'blank-cols' }, h('span', null, 'Columns (across)'), colsIn), h('label', { class: 'field', for: 'blank-rows' }, h('span', null, 'Rows (down)'), rowsIn)),
    h('label', { class: 'field', for: 'blank-name' }, h('span', null, 'Name'), name)
  );
  dialog({
    title: 'Blank puzzle',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Next: add clues', value: 'ok', primary: true },
    ],
  }).promise.then((v) => {
    if (v !== 'ok') return;
    const cols = Math.min(25, Math.max(3, parseInt(colsIn.value, 10) || 15));
    const rows = Math.min(25, Math.max(3, parseInt(rowsIn.value, 10) || 11));
    show('import');
    startImport({
      container: screens.import,
      blank: true,
      rows,
      cols,
      title: name.value.trim(),
      onDone: (p) => {
        savePuzzle(p);
        play(p);
      },
      onCancel: showLibrary,
    });
  });
}

async function trySample() {
  try {
    const res = await fetch('samples/sample-skeleton.json');
    if (!res.ok) throw new Error(String(res.status));
    const p = fromJSON(await res.json());
    p.id = newId();
    p.createdAt = p.updatedAt = Date.now();
    savePuzzle(p);
    play(p);
  } catch (e) {
    toast("Couldn't load the sample puzzle. Check your connection and try again.");
  }
}

function importFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'import-json' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const p = fromJSON(await f.text());
      p.id = newId();
      savePuzzle(p);
      renderLibrary();
      toast(`Added "${p.title}".`);
    } catch (e) {
      toast("That file isn't a puzzle saved from this app.");
    }
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

function exportPuzzle(id) {
  const raw = loadPuzzleRaw(id);
  if (!raw) return;
  const p = fromJSON(raw);
  const blob = new Blob([toJSON(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: p.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.skeleton.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function duplicate(id) {
  const raw = loadPuzzleRaw(id);
  if (!raw) return;
  const p = fromJSON(raw);
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

// ------------------------------------------------------------------ library screen
function card(entry) {
  const pct = Math.round((entry.progress || 0) * 100);
  const when = new Date(entry.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return h(
    'li',
    { class: 'card' },
    h(
      'button',
      { class: 'card-main', type: 'button', onclick: () => resume(entry.id) },
      h('span', { class: 'card-title' }, entry.title),
      h('span', { class: 'card-meta' }, `${entry.cols || entry.size} × ${entry.rows || entry.size} · ${when}`),
      h('span', { class: 'bar', role: 'img', 'aria-label': pct + ' percent filled' }, h('span', { class: 'bar-fill', style: `width:${pct}%` })),
      h('span', { class: 'card-pct' }, pct + '% filled')
    ),
    h(
      'div',
      { class: 'card-actions' },
      h('button', { class: 'btn quiet', type: 'button', onclick: () => duplicate(entry.id) }, 'Duplicate'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => exportPuzzle(entry.id) }, 'Export'),
      h('button', { class: 'btn quiet danger-text', type: 'button', onclick: () => remove(entry) }, 'Delete')
    )
  );
}

// ------------------------------------------------------------------ version
// Shows which version this copy is and, when online, whether a newer one has been published.
// The answer is only trusted if the last check succeeded: a failed check says so, rather than
// leaving an old "latest version" on screen.
const upd = { state: 'idle', latest: null, checkedAt: null }; // state: idle | checking | ok | error

const fmtBuilt = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

async function checkForUpdate() {
  if (upd.state === 'checking') return;
  upd.state = 'checking';
  refreshVersionLine();
  try {
    // a unique address plus no-store, so neither the browser nor the host's cache can answer
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
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

async function reloadLatest() {
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
  el.append(h('span', null, `Version ${VERSION} \u00B7 ${fmtBuilt(BUILT)}`));
  if (upd.state === 'checking') el.append(h('span', { class: 'muted' }, 'Checking for updates\u2026'));
  else if (upd.state === 'error') el.append(h('span', { class: 'ver-new' }, "Couldn't check (offline?)"));
  else if (upd.state === 'ok') {
    if (upd.latest.version > VERSION) {
      el.append(h('span', { class: 'ver-new' }, `Version ${upd.latest.version} is available`), h('button', { class: 'btn small primary', type: 'button', onclick: reloadLatest }, 'Update now'));
    } else {
      el.append(h('span', { class: 'ver-ok' }, `Latest version \u00B7 checked ${fmtTime(upd.checkedAt)}`));
    }
  }
  if (upd.state !== 'checking') el.append(h('button', { class: 'btn small', type: 'button', onclick: checkForUpdate }, 'Check for updates'));
}

function versionLine() {
  const el = h('p', { class: 'version', id: 'version-line' });
  fillVersionLine(el);
  if (upd.state === 'idle') checkForUpdate(); // check once when the app opens
  return el;
}

function renderLibrary() {
  const entries = loadIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  const root = screens.library;
  root.textContent = '';
  const miniGrid = h('div', { class: 'logo-grid', 'aria-hidden': 'true' }, ['', '', 'b', '', 'b', '', 'b', '', ''].map((c) => h('i', { class: c })));
  root.append(
    h(
      'div',
      { class: 'library' },
      h(
        'header',
        { class: 'hero' },
        miniGrid,
        h('div', null, h('h1', null, 'Skeleton Crossword'), h('p', { class: 'tag' }, 'Work out the grid, then fill it in.'), versionLine())
      ),
      !storageAvailable() ? h('p', { class: 'notice' }, "This browser isn't keeping saved data, so puzzles will be lost when you close the page. Export puzzles to keep them.") : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: newFromPhoto }, 'New puzzle from photo or PDF'),
        h('button', { class: 'btn big', type: 'button', onclick: newBlank }, 'Blank puzzle'),
        h('button', { class: 'btn big', type: 'button', onclick: trySample }, 'Try a sample'),
        h('button', { class: 'btn big quiet', type: 'button', onclick: importFile }, 'Import file')
      ),
      entries.length
        ? h('section', null, h('h2', { class: 'section-title' }, 'Your puzzles'), h('ul', { class: 'cards' }, entries.map(card)))
        : h(
            'section',
            { class: 'empty' },
            h('h2', { class: 'section-title' }, 'How it works'),
            h(
              'ol',
              { class: 'how' },
              h('li', null, h('strong', null, 'Add the puzzle.'), ' Photograph the page or use a screenshot or PDF. The app finds the grid and reads any printed squares and clues.'),
              h('li', null, h('strong', null, 'Find the black squares.'), ' Clue numbers and letter counts give the layout away. Place squares as you spot them, or ask for a check or a hint.'),
              h('li', null, h('strong', null, 'Fill in the answers.'), ' Clues are crossed off as each word is completed.')
            ),
            h('p', { class: 'muted' }, 'The Sunday Express does not publish its Skeleton online, so the app works from your copy of the printed page.')
          )
    )
  );
}

// ------------------------------------------------------------------ boot
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
