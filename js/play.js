// Play screen controller: owns the open puzzle, input, history, layout tools and autosave.
import { h, toast, clearToast, dialog, confirmDialog, inputDialog, modalOpen } from './ui/dom.js';
import { computeNumbering, matchClues, symmetryTargets, parseEnumeration, SYMMETRY } from './model.js';
import { savePuzzle, loadSettings, saveSettings } from './storage.js';
import { optionsFromPuzzle } from './solver.js';
import { runSolver } from './solverClient.js';
import { createGridView } from './ui/grid.js';
import { createClueLists } from './ui/clues.js';
import { createKeyboard } from './ui/keyboard.js';
import { openWordFinder } from './ui/wordFinder.js';

let closeCurrent = null;

export function closePlay() {
  if (closeCurrent) closeCurrent();
}

const DIR_NAME = { across: 'Across', down: 'Down' };
const MAX_HISTORY = 300;

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

function actionSheet(title, items) {
  const body = h('div', { class: 'sheet' });
  const d = dialog({ title, body, buttons: [{ label: 'Close', value: null }] });
  items.forEach((it) =>
    body.append(
      h(
        'button',
        { class: 'sheet-item' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { d.close(); it.run(); } },
        h('span', { class: 'si-label' }, it.label),
        it.hint ? h('span', { class: 'si-hint' }, it.hint) : null
      )
    )
  );
  return d;
}

export function openPlay(puzzle, { container, onExit }) {
  closePlay();
  const p = puzzle;
  const S = {
    settings: loadSettings(),
    sel: Math.max(0, p.cells.findIndex((c) => !c.block)),
    dir: 'across',
    mode: 'letters',
    pencil: false,
    undo: [],
    redo: [],
    batch: null,
    paintValue: null,
    flash: new Set(),
    numbering: null,
    matches: null,
    slotAt: { across: new Map(), down: new Map() },
    celebrated: false,
    saveTimer: null,
    lastTick: Date.now(),
    ticks: 0,
    busy: false,
    lengthHints: null,
  };

  // ---------------------------------------------------------------- derived data
  function recompute() {
    S.numbering = computeNumbering(p);
    S.matches = matchClues(p, S.numbering);
    S.slotAt = { across: new Map(), down: new Map() };
    for (const slot of S.numbering.slots) for (const i of slot.cells) S.slotAt[slot.dir].set(i, slot);
  }
  const symMode = () => p.settings.symmetry || 'none';
  const mirrorsOf = (i) => symmetryTargets(i, p.rows, p.cols, symMode());
  const currentSlot = () => S.slotAt[S.dir].get(S.sel) || null;
  const otherDir = () => (S.dir === 'across' ? 'down' : 'across');
  const entryFor = (slot) => (slot ? S.matches[slot.dir].find((e) => e.slot === slot) || null : null);
  const orderedEntries = () => S.matches.across.concat(S.matches.down).filter((e) => e.slot);

  // ---------------------------------------------------------------- history
  function commit(changes) {
    const rec = [];
    for (const ch of changes) {
      const cell = p.cells[ch.i];
      const before = {};
      const after = {};
      for (const k of Object.keys(ch.patch)) {
        if (cell[k] !== ch.patch[k]) {
          before[k] = cell[k];
          after[k] = ch.patch[k];
        }
      }
      if (Object.keys(after).length) {
        rec.push({ i: ch.i, before, after });
        Object.assign(cell, after);
      }
    }
    if (!rec.length) return false;
    if (S.batch) S.batch.push(...rec);
    else pushHistory(rec);
    changed(rec.some((r) => 'block' in r.after));
    return true;
  }
  function pushHistory(rec) {
    S.undo.push(rec);
    if (S.undo.length > MAX_HISTORY) S.undo.shift();
    S.redo.length = 0;
  }
  function undo() {
    const rec = S.undo.pop();
    if (!rec) return;
    for (let k = rec.length - 1; k >= 0; k--) Object.assign(p.cells[rec[k].i], rec[k].before);
    S.redo.push(rec);
    changed(true);
  }
  function redo() {
    const rec = S.redo.pop();
    if (!rec) return;
    for (const r of rec) Object.assign(p.cells[r.i], r.after);
    S.undo.push(rec);
    changed(true);
  }
  function changed(structural) {
    if (structural) {
      S.lengthHints = null;
      recompute();
    }
    render();
    scheduleSave();
    checkComplete();
  }

  // ---------------------------------------------------------------- saving & timer
  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, 500);
  }
  function flushSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = null;
    const r = savePuzzle(p);
    if (!r.ok && r.quota) toast('Storage is full. Delete a saved puzzle or remove the photo to keep saving.', 5000);
  }
  function tick() {
    const now = Date.now();
    if (!document.hidden && !S.complete) p.elapsedMs += Math.min(now - S.lastTick, 5000);
    S.lastTick = now;
    S.ticks++;
    if (S.ticks % 15 === 0 && !S.complete) scheduleSave();
    timerEl.textContent = fmtTime(p.elapsedMs);
  }

  // ---------------------------------------------------------------- selection & input
  function select(i) {
    S.sel = i;
    if (!S.slotAt[S.dir].get(i) && S.slotAt[otherDir()].get(i)) S.dir = otherDir();
    render();
  }
  function toggleDir() {
    if (S.slotAt[otherDir()].get(S.sel)) S.dir = otherDir();
    render();
  }
  function gotoSlot(slot) {
    const cells = slot.cells;
    const firstEmpty = cells.find((i) => !p.cells[i].letter);
    S.dir = slot.dir;
    S.sel = firstEmpty !== undefined ? firstEmpty : cells[0];
  }
  function stepClue(delta) {
    const list = orderedEntries();
    if (!list.length) return;
    const slot = currentSlot();
    let k = list.findIndex((e) => e.slot === slot);
    k = k < 0 ? (delta > 0 ? 0 : list.length - 1) : (k + delta + list.length) % list.length;
    gotoSlot(list[k].slot);
    render();
  }
  function move(dr, dc) {
    const R = p.rows;
    const C = p.cols;
    let r = Math.floor(S.sel / C);
    let c = S.sel % C;
    for (;;) {
      r += dr;
      c += dc;
      if (r < 0 || c < 0 || r >= R || c >= C) return;
      if (!p.cells[r * C + c].block) break;
    }
    const wasDir = S.dir;
    S.dir = dr ? 'down' : 'across';
    S.sel = r * C + c;
    if (!S.slotAt[S.dir].get(S.sel)) S.dir = wasDir;
    render();
  }
  function advance() {
    const slot = currentSlot();
    if (slot) {
      const k = slot.cells.indexOf(S.sel);
      for (let j = k + 1; j < slot.cells.length; j++) {
        const next = p.cells[slot.cells[j]];
        if (next.givenLetter) continue; // printed letters are locked: type past them
        if (!S.settings.skipFilled || !next.letter) {
          S.sel = slot.cells[j];
          render();
          return;
        }
      }
      if (orderedEntries().length > 1) {
        stepClue(1);
        return;
      }
      render();
      return;
    }
    move(S.dir === 'down' ? 1 : 0, S.dir === 'across' ? 1 : 0);
  }
  function typeLetter(ch) {
    const cell = p.cells[S.sel];
    if (!cell || cell.block) return;
    if (!cell.givenLetter) commit([{ i: S.sel, patch: { letter: ch, pencil: S.pencil } }]);
    advance();
  }
  function backspace() {
    const cell = p.cells[S.sel];
    if (cell && !cell.block && cell.letter && !cell.givenLetter) {
      commit([{ i: S.sel, patch: { letter: '', pencil: false } }]);
      return;
    }
    const slot = currentSlot();
    if (slot) {
      const k = slot.cells.indexOf(S.sel);
      if (k > 0) {
        S.sel = slot.cells[k - 1];
        const prev = p.cells[S.sel];
        if (prev.letter && !prev.givenLetter) commit([{ i: S.sel, patch: { letter: '', pencil: false } }]);
        else render();
      }
    } else move(S.dir === 'down' ? -1 : 0, S.dir === 'across' ? -1 : 0);
  }
  function setMode(m) {
    S.mode = m;
    render();
  }

  // black-square painting
  function paint(i) {
    if (S.paintValue === null) return;
    const targets = [i];
    targets.push(...mirrorsOf(i));
    const changes = [];
    for (const t of targets) {
      const c = p.cells[t];
      if (c.givenBlock) continue;
      if (S.paintValue && c.givenLetter) continue;
      changes.push({ i: t, patch: S.paintValue ? { block: true, letter: '', pencil: false } : { block: false } });
    }
    commit(changes);
  }
  function onGridDown(i) {
    if (S.mode === 'blocks') {
      const c = p.cells[i];
      S.paintValue = c.givenBlock ? null : !c.block;
      if (S.paintValue && c.givenLetter) S.paintValue = null;
      S.batch = [];
      S.sel = i;
      if (S.paintValue === null) {
        toast(c.givenBlock ? 'That square is printed in the puzzle, so it stays black.' : 'That square holds a printed letter, so it stays white.');
        render();
      } else paint(i);
      return;
    }
    if (p.cells[i].block) return;
    if (i === S.sel) toggleDir();
    else select(i);
  }
  function onGridMove(i) {
    if (S.mode === 'blocks' && S.batch) paint(i);
  }
  function onGridUp() {
    if (S.batch) {
      if (S.batch.length) pushHistory(S.batch);
      S.batch = null;
      S.paintValue = null;
    }
  }

  // clue list actions
  function selectClue(dir, number) {
    const entry = S.matches[dir].find((e) => e.clue.number === number);
    if (!entry) return;
    if (!entry.slot) {
      toast(`Place the black squares for ${number} ${DIR_NAME[dir]} first.`);
      return;
    }
    gotoSlot(entry.slot);
    if (S.mode === 'blocks') S.mode = 'letters';
    render();
  }
  function toggleDone(dir, number) {
    const entry = S.matches[dir].find((e) => e.clue.number === number);
    if (!entry) return;
    entry.clue.manualDone = !entry.clue.manualDone;
    render();
    scheduleSave();
  }

  // ---------------------------------------------------------------- hardware keyboard
  function onKeyDown(e) {
    if (modalOpen()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      return;
    }
    if (e.altKey) return;
    const k = e.key;
    let handled = true;
    if (/^[a-zA-Z]$/.test(k)) typeLetter(k.toUpperCase());
    else if (k === 'Backspace' || k === 'Delete') backspace();
    else if (k === 'ArrowLeft') move(0, -1);
    else if (k === 'ArrowRight') move(0, 1);
    else if (k === 'ArrowUp') move(-1, 0);
    else if (k === 'ArrowDown') move(1, 0);
    else if (k === 'Tab') stepClue(e.shiftKey ? -1 : 1);
    else if (k === ' ') toggleDir();
    else if (k === '.' || k === '#') setMode(S.mode === 'blocks' ? 'letters' : 'blocks');
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ---------------------------------------------------------------- layout tools
  async function solveWith(withUserSquares) {
    const extraBlocks = [];
    const extraWhites = [];
    if (withUserSquares) {
      p.cells.forEach((c, i) => {
        if (c.block && !c.givenBlock) extraBlocks.push(i);
        if (c.letter && !c.pencil && !c.block && !c.givenLetter) extraWhites.push(i);
      });
    }
    S.busy = true;
    toast('Working it out\u2026', 8000);
    try {
      return await runSolver(optionsFromPuzzle(p, { extraBlocks, extraWhites, maxSolutions: 3000, nodeCap: 4000000 }));
    } finally {
      S.busy = false;
      clearToast();
    }
  }
  function problemList() {
    const out = [];
    for (const dir of ['across', 'down']) {
      for (const e of S.matches[dir]) {
        const label = `${e.clue.number} ${DIR_NAME[dir]}`;
        if (e.status === 'length-mismatch') out.push(`${label}: the clue has ${e.clue.length} letters but the grid gives ${e.slot.length}.`);
        else if (e.status === 'missing') out.push(`${label}: no word starts at this number yet.`);
      }
    }
    for (const s of S.numbering.slots) {
      if (!S.matches.orphanSlots.includes(s)) continue;
      out.push(`${s.number} ${DIR_NAME[s.dir]}: the grid has a word of ${s.length} letters here but no clue.`);
    }
    return out;
  }
  function showResult(title, message, problems, problemTitle = 'Things to check') {
    const body = h('div', { class: 'result' }, h('p', null, message));
    if (problems && problems.length) {
      body.append(h('h3', { class: 'wf-label' }, problems.length > 12 ? `${problemTitle} (first 12 of ${problems.length})` : problemTitle));
      body.append(h('ul', { class: 'problems' }, problems.slice(0, 12).map((x) => h('li', null, x))));
    }
    dialog({ title, body, buttons: [{ label: 'OK', value: true, primary: true }] });
  }
  /** What every possible layout agrees on. Only certain when the search was complete. */
  function agreement(res) {
    const blocks = [];
    const whites = [];
    for (let i = 0; i < p.cells.length; i++) {
      let all1 = true;
      let all0 = true;
      for (const s of res.solutions) {
        if (s[i]) all0 = false;
        else all1 = false;
      }
      if (all1) blocks.push(i);
      else if (all0) whites.push(i);
    }
    return { blocks, whites };
  }
  /** For each clue, the word lengths seen across the possible layouts: Map 'across:16' -> Set. */
  function possibleLengths(res) {
    const out = new Map();
    const tmp = { rows: p.rows, cols: p.cols, cells: null };
    for (const sol of res.solutions) {
      tmp.cells = Array.from(sol, (v) => ({ block: !!v }));
      for (const slot of computeNumbering(tmp).slots) {
        const key = slot.dir + ':' + slot.number;
        if (!out.has(key)) out.set(key, new Set());
        out.get(key).add(slot.length);
      }
    }
    return out;
  }
  const lengthText = (set) => [...set].sort((x, y) => x - y).join(' or ');

  async function checkLayout() {
    if (S.busy) return;
    if (!p.clues.across.length && !p.clues.down.length) {
      showResult('Check layout', 'Add the clues first. The layout is worked out from the clue numbers.');
      return;
    }
    const problems = problemList();
    const res = await solveWith(true);
    let msg;
    let open = [];
    if (res.count === 0 && res.capped) msg = 'There are too many possible layouts to check yet. Place more black squares or add letter counts and try again.';
    else if (res.count === 0) msg = "Your black squares and letters can't all be right. No layout fits them together with the clue numbers, printed squares and letter counts.";
    else if (!res.complete) msg = 'Very many layouts still fit. Place more black squares or add letter counts to narrow it down.';
    else if (res.unique) msg = 'Your squares fit exactly one complete layout. Use "Reveal whole layout" to see it.';
    else {
      const ag = agreement(res);
      const placed = ag.blocks.filter((i) => !p.cells[i].block).length;
      msg = `${res.count} layouts still fit your squares and the clues. ${placed ? `${placed} more black squares are certain (ask for hints).` : 'Every square they share is already in place.'} Adding letter counts for the clues below would settle the rest.`;
      S.lengthHints = possibleLengths(res);
      open = [...S.lengthHints].filter(([, set]) => set.size > 1).map(([key, set]) => {
        const [dir, num] = key.split(':');
        return `${num} ${DIR_NAME[dir]} could be ${lengthText(set)} letters.`;
      });
      render();
    }
    if (res.unique) S.lengthHints = null;
    if (open.length) showResult('Check layout', msg, open, 'Still open');
    else showResult('Check layout', msg, problems);
  }
  async function revealOne() {
    if (S.busy) return;
    let res = await solveWith(true);
    let warned = false;
    if (res.count === 0 && !res.capped) {
      res = await solveWith(false);
      warned = true;
    }
    if (res.count === 0) {
      showResult('Hint', res.capped ? 'There are too many possible layouts to give a hint yet.' : "The clue numbers and printed squares don't fit any layout, so no hint is possible. Check the clue numbers, the grid size and the symmetry setting.");
      return;
    }
    if (!res.complete) {
      toast('Too many layouts fit to be sure of a square yet. Place squares you are sure of, or add letter counts.', 5000);
      return;
    }
    const cands = agreement(res).blocks.filter((i) => !p.cells[i].block);
    if (!cands.length) {
      toast(res.count > 1 ? `${res.count} layouts still fit. Every square they all share is placed. Add letter counts to narrow it down.` : 'Every black square is already in place.', 5000);
      return;
    }
    const C = p.cols;
    const dist = (i) => Math.abs(Math.floor(i / C) - Math.floor(S.sel / C)) + Math.abs((i % C) - (S.sel % C));
    cands.sort((a, b) => dist(a) - dist(b));
    const pick = cands[0];
    const targets = [pick, ...mirrorsOf(pick)].filter((i) => !p.cells[i].block);
    commit(targets.map((i) => ({ i, patch: { block: true, letter: '', pencil: false } })));
    flash(targets);
    S.sel = pick;
    render();
    toast(warned ? 'Placed a black square. Some of your own squares may be wrong; try Check layout.' : targets.length > 1 ? `Placed a black square and its ${targets.length - 1} mirror${targets.length > 2 ? 's' : ''}.` : 'Placed a black square.', 4500);
  }
  async function revealAll() {
    if (S.busy) return;
    const ok = await confirmDialog('Reveal the whole layout?', 'This places every black square that is certain. It gives away the grid pattern but not the answers.', 'Reveal layout', true);
    if (!ok) return;
    let res = await solveWith(true);
    if (res.count === 0 && !res.capped) res = await solveWith(false);
    if (res.count === 0) {
      showResult('Reveal layout', res.capped ? 'There are too many possible layouts to reveal yet.' : "The clue numbers and printed squares don't fit any layout. Check the clue numbers, the grid size and the symmetry setting.");
      return;
    }
    if (!res.complete) {
      toast('Too many layouts fit to be sure of any square yet. Place squares you are sure of, or add letter counts.', 5000);
      return;
    }
    const blocks = agreement(res).blocks.filter((i) => !p.cells[i].block);
    commit(blocks.map((i) => ({ i, patch: { block: true, letter: '', pencil: false } })));
    flash(blocks);
    S.mode = 'letters';
    render();
    if (res.count === 1) toast('Layout revealed.', 4000);
    else {
      S.lengthHints = possibleLengths(res);
      const open = [...S.lengthHints].filter(([, set]) => set.size > 1).length;
      showResult('Layout partly revealed', `${res.count} layouts fit the clues. I placed the ${blocks.length} black squares they all share. ${open} clue${open === 1 ? '' : 's'} could still have more than one length: select a clue to see its options, then add its letter count once you have solved it.`);
    }
  }
  async function setLetterCount(entry) {
    const label = `${entry.clue.number} ${DIR_NAME[entry.slot ? entry.slot.dir : (S.matches.across.includes(entry) ? 'across' : 'down')]}`;
    const v = await inputDialog('Letters in the answer', `Number of letters for ${label} (for example 7, or 3,4 for two words). Leave empty if unknown.`, entry.clue.enumeration || '', { inputmode: 'text', okLabel: 'Set count' });
    if (v === null) return;
    const en = v.replace(/[()]/g, '').trim();
    entry.clue.enumeration = en;
    entry.clue.length = parseEnumeration(en).length;
    S.lengthHints = null;
    recompute();
    render();
    scheduleSave();
  }
  function flash(list) {
    S.flash = new Set(list);
    render();
    setTimeout(() => { S.flash = new Set(); render(); }, 1800);
  }

  // ---------------------------------------------------------------- other tools
  function clearDialog() {
    actionSheet('Clear', [
      { label: 'Clear letters', hint: 'Keeps black squares and printed letters', run: () => clearCells('letters') },
      { label: 'Clear black squares', hint: 'Keeps letters and printed squares', run: () => clearCells('blocks') },
      { label: 'Clear everything I added', hint: 'Letters, black squares and clue ticks', run: () => clearCells('all'), danger: true },
    ]);
  }
  function clearCells(what) {
    const changes = [];
    p.cells.forEach((c, i) => {
      if ((what === 'letters' || what === 'all') && c.letter && !c.givenLetter) changes.push({ i, patch: { letter: '', pencil: false } });
      if ((what === 'blocks' || what === 'all') && c.block && !c.givenBlock) changes.push({ i, patch: { block: false } });
    });
    if (what === 'all') for (const d of ['across', 'down']) for (const c of p.clues[d]) c.manualDone = false;
    if (!commit(changes)) {
      render();
      scheduleSave();
    }
    S.celebrated = false;
    S.complete = false;
  }
  function showOriginal() {
    if (!p.sourceImage) {
      toast('No photo was saved with this puzzle.');
      return;
    }
    let zoom = 1;
    const img = h('img', { class: 'orig-img', src: p.sourceImage, alt: 'The original puzzle' });
    const wrap = h('div', { class: 'orig-wrap' }, img);
    const setZoom = (z) => {
      zoom = Math.min(4, Math.max(0.5, z));
      img.style.width = zoom * 100 + '%';
    };
    const bar = h(
      'div',
      { class: 'orig-bar' },
      h('button', { class: 'btn', type: 'button', onclick: () => setZoom(zoom - 0.5) }, '−'),
      h('button', { class: 'btn', type: 'button', onclick: () => setZoom(1) }, 'Fit'),
      h('button', { class: 'btn', type: 'button', onclick: () => setZoom(zoom + 0.5) }, '+')
    );
    dialog({ title: 'Original puzzle', body: h('div', null, bar, wrap), wide: true, buttons: [{ label: 'Close', value: null }] });
  }
  function wordFinder() {
    const slot = currentSlot();
    if (!slot) {
      toast('Select a word first.');
      return;
    }
    const entry = entryFor(slot);
    let lens = [slot.length];
    if (entry) {
      const en = parseEnumeration(entry.clue.enumeration);
      if (en.parts.length > 1 && en.length === slot.length) lens = en.parts;
    }
    const parts = [];
    let at = 0;
    for (const len of lens) {
      const idxs = slot.cells.slice(at, at + len);
      parts.push({ start: at, length: len, pattern: idxs.map((i) => (p.cells[i].letter && !p.cells[i].pencil ? p.cells[i].letter : '?')).join('') });
      at += len;
    }
    openWordFinder({
      title: entry ? `${entry.clue.number} ${DIR_NAME[slot.dir]}: ${entry.clue.text}` : 'Word finder',
      parts,
      onPick: (word, partIdx) => {
        if (partIdx < 0) return;
        const part = parts[partIdx];
        const changes = [];
        for (let k = 0; k < part.length; k++) {
          const i = slot.cells[part.start + k];
          if (p.cells[i].givenLetter) continue;
          changes.push({ i, patch: { letter: word[k], pencil: true } });
        }
        commit(changes);
      },
    });
  }
  function settingsDialog() {
    const row = (id, label, hint, get, set) => {
      const input = h('input', { id, type: 'checkbox', checked: get() });
      input.checked = !!get();
      input.addEventListener('change', () => { set(input.checked); render(); });
      return h('label', { class: 'switch-row', for: id }, h('span', { class: 'sw-text' }, h('strong', null, label), h('small', null, hint)), input);
    };
    const save = () => saveSettings(S.settings);
    const symRow = () => {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Black square symmetry' });
      const note = h('small', null, SYMMETRY[symMode()].split(': ')[1] || 'No matching squares are placed.');
      Object.entries(SYMMETRY).forEach(([k, label]) => {
        const b = h('button', { type: 'button', class: 'seg-btn' + (symMode() === k ? ' on' : ''), onclick: () => {
          p.settings.symmetry = k;
          [...seg.children].forEach((x) => x.classList.toggle('on', x === b));
          note.textContent = label.split(': ')[1] || 'No matching squares are placed.';
          scheduleSave();
          render();
        } }, label.split(':')[0]);
        seg.append(b);
      });
      return h('div', { class: 'switch-row stack' }, h('span', { class: 'sw-text' }, h('strong', null, 'Black square symmetry'), note), seg);
    };
    const body = h(
      'div',
      { class: 'settings' },
      symRow(),
      row('set-fb', 'Layout feedback', 'Show whether each clue fits the grid. This gives hints about the layout.', () => S.settings.layoutFeedback, (v) => { S.settings.layoutFeedback = v; save(); }),
      row('set-skip', 'Skip filled squares', 'Typing jumps over squares that already have a letter.', () => S.settings.skipFilled, (v) => { S.settings.skipFilled = v; save(); }),
      row('set-down', 'Move solved clues down', 'Crossed-off clues drop to the end of each list.', () => S.settings.moveSolvedDown, (v) => { S.settings.moveSolvedDown = v; save(); }),
      row('set-timer', 'Show timer', '', () => S.settings.showTimer, (v) => { S.settings.showTimer = v; save(); }),
      row('set-kb', 'Show on-screen keyboard', 'Turn off if you use a keyboard case.', () => S.settings.showKeyboard, (v) => { S.settings.showKeyboard = v; save(); })
    );
    dialog({ title: 'Settings', body, buttons: [{ label: 'Done', value: true, primary: true }] });
  }
  function layoutMenu() {
    actionSheet('Black squares', [
      { label: 'Check my layout', hint: 'Tells you if your squares fit the clues, without giving anything away', run: checkLayout },
      { label: 'Hint: place one square', hint: 'Adds a certain black square and its mirror squares', run: revealOne },
      { label: 'Reveal whole layout', hint: 'Places every black square', run: revealAll, danger: true },
    ]);
  }
  function toolsMenu() {
    actionSheet('Tools', [
      { label: 'Word finder', hint: 'Fill in a pattern like C?T?? or find anagrams', run: wordFinder },
      { label: 'Show original photo', hint: 'See the printed puzzle', run: showOriginal },
      { label: 'Clear…', hint: 'Letters, black squares or both', run: clearDialog },
      { label: 'Settings', run: settingsDialog },
    ]);
  }

  // ---------------------------------------------------------------- completion
  function isComplete() {
    if (!p.clues.across.length && !p.clues.down.length) return false;
    if (S.matches.orphanSlots.length) return false;
    for (const dir of ['across', 'down']) for (const e of S.matches[dir]) if (e.status !== 'ok') return false;
    return p.cells.every((c) => c.block || (c.letter && !c.pencil));
  }
  function checkComplete() {
    if (S.celebrated || !isComplete()) return;
    S.celebrated = true;
    S.complete = true;
    flushSave();
    showResult('Grid complete', `Every square is filled and every clue fits the grid. Time: ${fmtTime(p.elapsedMs)}. The app has no answer key, so check your answers against the published solution.`);
  }

  // ---------------------------------------------------------------- view
  const grid = createGridView({ down: onGridDown, move: onGridMove, up: onGridUp });
  const clues = createClueLists({ onSelect: selectClue, onToggle: toggleDone });
  const kb = createKeyboard({
    letter: typeLetter,
    backspace,
    toggleDir,
    togglePencil: () => { S.pencil = !S.pencil; render(); },
    toggleMode: () => setMode(S.mode === 'blocks' ? 'letters' : 'blocks'),
    prev: () => stepClue(-1),
    next: () => stepClue(1),
  });

  const btn = (label, fn, cls = '', aria) => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn, 'aria-label': aria || label }, label);
  const backBtn = btn('‹ Library', () => exit(), 'quiet');
  const titleEl = h('h1', { class: 'play-title' }, p.title);
  const segLetters = h('button', { class: 'seg-btn', type: 'button', onclick: () => setMode('letters') }, 'Letters');
  const segBlocks = h('button', { class: 'seg-btn', type: 'button', onclick: () => setMode('blocks') }, 'Squares');
  const undoBtn = btn('Undo', undo, 'quiet');
  const redoBtn = btn('Redo', redo, 'quiet');
  const timerEl = h('span', { class: 'timer', 'aria-label': 'Time spent' }, fmtTime(p.elapsedMs));
  const clueBar = h('div', { class: 'clue-bar', 'aria-live': 'polite' });

  const root = h(
    'div',
    { class: 'play' },
    h(
      'header',
      { class: 'play-top' },
      backBtn,
      titleEl,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Input mode' }, segLetters, segBlocks),
      undoBtn,
      redoBtn,
      btn('Layout', layoutMenu, 'quiet'),
      btn('Tools', toolsMenu, 'quiet'),
      timerEl
    ),
    h('div', { class: 'play-main' }, h('div', { class: 'grid-pane' }, grid.el), h('div', { class: 'side-pane' }, clueBar, clues.root, kb.el))
  );
  root.style.setProperty('--cols', p.cols);
  root.style.setProperty('--rows', p.rows);
  container.textContent = '';
  container.append(root);

  function render() {
    const slot = currentSlot();
    const warn = new Set();
    if (S.settings.layoutFeedback) {
      for (const dir of ['across', 'down']) for (const e of S.matches[dir]) if (e.status === 'length-mismatch') e.slot.cells.forEach((i) => warn.add(i));
      for (const s of S.matches.orphanSlots) s.cells.forEach((i) => warn.add(i));
    }
    grid.update({
      puzzle: p,
      numbering: S.numbering,
      sel: S.sel,
      wordCells: new Set(slot ? slot.cells : []),
      mirrors: new Set(S.mode === 'blocks' ? mirrorsOf(S.sel) : []),
      warn,
      flash: S.flash,
    });
    grid.el.classList.toggle('blocks-mode', S.mode === 'blocks');

    // current clue bar
    const entry = entryFor(slot);
    clueBar.textContent = '';
    if (S.mode === 'blocks') {
      clueBar.append(h('div', { class: 'cb-main' }, h('strong', null, 'Black squares: '), 'tap or drag to add or remove them.' + (symMode() === 'mirror4' ? ' The three mirror squares follow.' : symMode() === 'rotational' ? ' The opposite square follows.' : '')));
    } else if (!slot) {
      clueBar.append(h('div', { class: 'cb-main muted' }, 'Tap a square to begin.'));
    } else {
      const pattern = slot.cells.map((i) => p.cells[i].letter || '·').join(' ');
      if (entry) {
        const opts = !entry.clue.length && S.lengthHints ? S.lengthHints.get(slot.dir + ':' + slot.number) : null;
        clueBar.append(
          h('div', { class: 'cb-main' }, h('strong', { class: 'cb-num' }, `${entry.clue.number} ${DIR_NAME[slot.dir]}`), ' ', entry.clue.text, entry.clue.enumeration ? h('span', { class: 'ce' }, ` (${entry.clue.enumeration})`) : null),
          h(
            'div',
            { class: 'cb-foot' },
            h('span', { class: 'cb-pattern' }, pattern),
            opts && opts.size > 1 ? h('span', { class: 'cb-opts' }, `Could be ${lengthText(opts)} letters`) : null,
            h('button', { class: 'btn quiet small', type: 'button', onclick: () => setLetterCount(entry) }, entry.clue.enumeration ? 'Change letter count' : 'Set letter count')
          )
        );
      } else {
        clueBar.append(h('div', { class: 'cb-main' }, h('strong', { class: 'cb-num' }, `${slot.number} ${DIR_NAME[slot.dir]}`), ` Word of ${slot.length} letters. `, h('span', { class: 'muted' }, 'No clue has this number.')), h('div', { class: 'cb-pattern' }, pattern));
      }
    }
    clues.update({ puzzle: p, matches: S.matches, activeKey: slot ? slot.dir + ':' + slot.number : '', settings: S.settings });
    kb.setState({ dir: S.dir, pencil: S.pencil, mode: S.mode });
    segLetters.classList.toggle('on', S.mode === 'letters');
    segBlocks.classList.toggle('on', S.mode === 'blocks');
    undoBtn.disabled = !S.undo.length;
    redoBtn.disabled = !S.redo.length;
    timerEl.hidden = !S.settings.showTimer;
    kb.el.hidden = !S.settings.showKeyboard;
    root.classList.toggle('no-kb', !S.settings.showKeyboard);
  }

  // ---------------------------------------------------------------- lifecycle
  const onVisibility = () => {
    S.lastTick = Date.now();
    if (document.hidden) flushSave();
  };
  const timerId = setInterval(tick, 1000);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushSave);

  function cleanup() {
    clearInterval(timerId);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushSave);
    flushSave();
    closeCurrent = null;
  }
  function exit() {
    cleanup();
    onExit();
  }
  closeCurrent = cleanup;

  recompute();
  S.complete = isComplete();
  S.celebrated = S.complete; // reopening a finished puzzle does not pop the banner again
  render();
  return { exit };
}
