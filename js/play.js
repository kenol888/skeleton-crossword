// Play screen controller: owns the open puzzle, input, history, layout tools and autosave.
import { h, toast, dialog, actionSheet, inputDialog, modalOpen } from './ui/dom.js';
import { computeNumbering, matchClues, linkClues, symmetryTargets, parseEnumeration, SYMMETRY } from './model.js';
import { savePuzzle, loadSettings, saveSettings } from './storage.js';
import { createGridView } from './ui/grid.js';
import { createClueLists } from './ui/clues.js';
import { createKeyboard } from './ui/keyboard.js';
import { openWordFinder } from './ui/wordFinder.js';
import { icon } from './ui/icons.js';
import { themeRow } from './theme.js';
import { watchSelection, showDefinition, cleanWord } from './define.js';

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

export function openPlay(puzzle, { container, onExit }) {
  closePlay();
  const p = puzzle;
  const S = {
    settings: loadSettings(),
    sel: Math.max(0, p.cells.findIndex((c) => !c.block)),
    dir: 'across',
    input: 'letter', // what the selected square is being given: 'letter' or 'number'
    pencil: false,
    undo: [],
    redo: [],
    batch: null,
    numBuffer: '', // digits typed so far into the selected square
    numCell: null,
    numbering: null,
    matches: null,
    slotAt: { across: new Map(), down: new Map() },
    celebrated: false,
    saveTimer: null,
    lastTick: Date.now(),
    ticks: 0,
    kbOpen: false,
    placing: null, // { dir, number }: waiting for the player to tap the square where that clue starts
    fit: null,
  };

  // ---------------------------------------------------------------- derived data
  function recompute() {
    S.numbering = computeNumbering(p); // only used for the runs of white squares and for judging layouts
    S.matches = linkClues(p, S.numbering); // what the player sees: clues linked by the numbers they placed
    S.fit = matchClues(p, S.numbering); // how well the drawn layout would fit the clues (opt-in feedback)
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
    changed(rec.some((r) => 'block' in r.after || 'userNumber' in r.after));
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
    if (structural) recompute();
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
  // moving to another square finishes any number being typed and goes back to letters
  function leaveSquare() {
    finishNumber();
    S.input = 'letter';
  }
  function select(i) {
    leaveSquare();
    S.sel = i;
    if (!S.slotAt[S.dir].get(i) && S.slotAt[otherDir()].get(i)) S.dir = otherDir();
    render();
  }
  function toggleDir() {
    if (S.slotAt[otherDir()].get(S.sel)) S.dir = otherDir();
    render();
  }
  function gotoSlot(slot) {
    leaveSquare();
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
    leaveSquare();
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
    if (S.input === 'number') {
      backspaceDigit();
      return;
    }
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
  // Pick the square first, then what to put in it: a letter, a clue number, or a black square.
  function setInput(m) {
    if (m === 'number' && p.type === 'standard') return;
    finishNumber();
    if (p.cells[S.sel].block) {
      toast('That square is black. Pick a white square first, or remove the black square.');
      return;
    }
    S.input = m;
    S.placing = null;
    if (S.settings.keyboard === 'auto') S.kbOpen = true;
    render();
  }

  // Black square on the selected square: makes it black (its mirror squares too, if that setting is on)
  // or, if it is already black, makes it white again.
  function toggleBlack() {
    finishNumber();
    if (p.type === 'standard') {
      toast('This crossword\u2019s black squares are printed, so they stay.');
      return;
    }
    const c = p.cells[S.sel];
    if (c.givenBlock) {
      toast('That square is printed in the puzzle, so it stays black.');
      return;
    }
    const makeBlack = !c.block;
    if (makeBlack && c.givenLetter) {
      toast('That square holds a printed letter, so it stays white.');
      return;
    }
    const targets = [S.sel];
    if (S.settings.autoMirror) targets.push(...mirrorsOf(S.sel));
    const changes = [];
    for (const t of targets) {
      const tc = p.cells[t];
      if (tc.givenBlock) continue;
      if (makeBlack && tc.givenLetter) continue;
      changes.push({ i: t, patch: makeBlack ? { block: true, letter: '', pencil: false, userNumber: null } : { block: false } });
    }
    S.input = 'letter';
    S.placing = null;
    if (!commit(changes)) render();
  }

  function onGridDown(i) {
    finishNumber();
    if (S.placing) {
      if (p.cells[i].block) {
        toast('Black squares have no number. Tap a white square.');
        return;
      }
      placeNumber(i, S.placing.number);
      return;
    }
    if (p.cells[i].block) {
      // a black square can be selected, so that the Black square button can remove it
      S.sel = i;
      S.input = 'letter';
      render();
      return;
    }
    if (S.settings.keyboard === 'auto') S.kbOpen = true; // going to type: bring up the keyboard
    if (i === S.sel) toggleDir();
    else select(i);
  }

  // clue list actions
  function selectClue(dir, number) {
    const entry = S.matches[dir].find((e) => e.clue.number === number);
    if (!entry) return;
    finishNumber();
    S.placing = null;
    if (entry.status === 'missing') {
      // nothing is numbered for the player: ask where this clue starts
      S.placing = { dir, number };
      S.input = 'letter';
      render();
      return;
    }
    if (!entry.slot) {
      S.sel = entry.at;
      toast(`${number} is not at the start of an ${DIR_NAME[dir]} word. Move the number or change the black squares.`, 4500);
      render();
      return;
    }
    gotoSlot(entry.slot);
    render();
  }
  function toggleDone(dir, number) {
    const entry = S.matches[dir].find((e) => e.clue.number === number);
    if (!entry) return;
    entry.clue.manualDone = !entry.clue.manualDone;
    render();
    scheduleSave();
  }

  // Numbers the player places: the app never numbers the grid for them. They are typed digit by
  // digit into the selected square, like letters.
  function typeDigit(d) {
    const c = p.cells[S.sel];
    if (c.block) {
      toast('Black squares have no number.');
      return;
    }
    if (c.givenNumber) {
      toast(`${c.givenNumber} is printed in the puzzle, so it stays.`);
      return;
    }
    if (S.numCell !== S.sel) {
      S.numCell = S.sel;
      S.numBuffer = ''; // the first digit replaces any number already there
    }
    if (S.numBuffer.length >= 3 || (S.numBuffer === '' && d === '0')) return;
    S.numBuffer += d;
    commit([{ i: S.sel, patch: { userNumber: +S.numBuffer } }]);
  }
  function backspaceDigit() {
    const c = p.cells[S.sel];
    if (c.block || c.givenNumber) return;
    if (S.numCell !== S.sel) {
      S.numCell = S.sel;
      S.numBuffer = c.userNumber ? String(c.userNumber) : ''; // editing a number that is already there
    }
    S.numBuffer = S.numBuffer.slice(0, -1);
    commit([{ i: S.sel, patch: { userNumber: S.numBuffer ? +S.numBuffer : null } }]);
  }
  // A number lives in one square: once typing moves on, take it from any other square.
  function finishNumber() {
    const i = S.numCell;
    S.numCell = null;
    S.numBuffer = '';
    if (i === null) return;
    const n = p.cells[i].userNumber;
    if (!n) return;
    const changes = [];
    if (p.cells.some((c, j) => j !== i && c.givenNumber === n)) {
      changes.push({ i, patch: { userNumber: null } });
      toast(`${n} is already printed in the grid.`, 3500);
    } else {
      p.cells.forEach((c, j) => {
        if (j !== i && c.userNumber === n) changes.push({ i: j, patch: { userNumber: null } });
      });
    }
    if (changes.length) commit(changes);
  }
  function placeNumber(i, n) {
    S.placing = null;
    const printed = p.cells.findIndex((c, j) => j !== i && c.givenNumber === n);
    if (printed >= 0 || p.cells[i].givenNumber) {
      toast(`${n} is already printed in the grid.`, 3500);
      render();
      return;
    }
    const changes = [];
    p.cells.forEach((c, j) => {
      if (j !== i && c.userNumber === n) changes.push({ i: j, patch: { userNumber: null } }); // a number lives in one square
    });
    changes.push({ i, patch: { userNumber: n } });
    S.sel = i;
    if (!commit(changes)) render();
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
    if (/^[a-zA-Z]$/.test(k)) {
      if (S.input === 'number') {
        finishNumber();
        S.input = 'letter';
      }
      typeLetter(k.toUpperCase());
    } else if (p.type !== 'standard' && /^[0-9]$/.test(k)) {
      if (S.input !== 'number') {
        finishNumber();
        S.input = 'number';
      }
      typeDigit(k);
    } else if (k === 'Backspace' || k === 'Delete') backspace();
    else if (k === 'ArrowLeft') move(0, -1);
    else if (k === 'ArrowRight') move(0, 1);
    else if (k === 'ArrowUp') move(-1, 0);
    else if (k === 'ArrowDown') move(1, 0);
    else if (k === 'Tab') stepClue(e.shiftKey ? -1 : 1);
    else if (k === ' ') toggleDir();
    else if (k === '.' || k === '#') toggleBlack();
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ---------------------------------------------------------------- results and letter counts
  function showResult(title, message, problems, problemTitle = 'Things to check') {
    const body = h('div', { class: 'result' }, h('p', null, message));
    if (problems && problems.length) {
      body.append(h('h3', { class: 'wf-label' }, problems.length > 12 ? `${problemTitle} (first 12 of ${problems.length})` : problemTitle));
      body.append(h('ul', { class: 'problems' }, problems.slice(0, 12).map((x) => h('li', null, x))));
    }
    dialog({ title, body, buttons: [{ label: 'OK', value: true, primary: true }] });
  }
  async function setLetterCount(entry) {
    const label = `${entry.clue.number} ${DIR_NAME[entry.slot ? entry.slot.dir : (S.matches.across.includes(entry) ? 'across' : 'down')]}`;
    const v = await inputDialog('Letters in the answer', `Number of letters for ${label} (for example 7, or 3,4 for two words). Leave empty if unknown.`, entry.clue.enumeration || '', { inputmode: 'text', okLabel: 'Set count' });
    if (v === null) return;
    const en = v.replace(/[()]/g, '').trim();
    entry.clue.enumeration = en;
    entry.clue.length = parseEnumeration(en).length;
    recompute();
    render();
    scheduleSave();
  }

  // ---------------------------------------------------------------- other tools
  function clearDialog() {
    actionSheet('Clear', [
      { label: 'Clear letters', hint: 'Keeps black squares and printed letters', run: () => clearCells('letters') },
      { label: 'Clear black squares', hint: 'Keeps letters and printed squares', run: () => clearCells('blocks') },
      { label: 'Clear my numbers', hint: 'Keeps the numbers printed in the puzzle', run: () => clearCells('numbers') },
      { label: 'Clear everything I added', hint: 'Letters, black squares, numbers and clue ticks', run: () => clearCells('all'), danger: true },
    ]);
  }
  function clearCells(what) {
    const changes = [];
    p.cells.forEach((c, i) => {
      if ((what === 'letters' || what === 'all') && c.letter && !c.givenLetter) changes.push({ i, patch: { letter: '', pencil: false } });
      if ((what === 'blocks' || what === 'all') && c.block && !c.givenBlock) changes.push({ i, patch: { block: false } });
      if ((what === 'numbers' || what === 'all') && c.userNumber) changes.push({ i, patch: { userNumber: null } });
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
    const kbRow = () => {
      const opts = [['auto', 'When typing'], ['always', 'Always'], ['never', 'Never']];
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'On-screen keyboard' });
      opts.forEach(([k, label]) => {
        const b = h('button', { type: 'button', class: 'seg-btn' + (S.settings.keyboard === k ? ' on' : ''), onclick: () => {
          S.settings.keyboard = k;
          S.kbOpen = false;
          [...seg.children].forEach((x) => x.classList.toggle('on', x === b));
          save();
          render();
        } }, label);
        seg.append(b);
      });
      return h('div', { class: 'switch-row stack' }, h('span', { class: 'sw-text' }, h('strong', null, 'On-screen keyboard'), h('small', null, 'When typing: it slides up as soon as you tap a square, so the clues stay in view the rest of the time. Choose Never with a keyboard case.')), seg);
    };
    const body = h(
      'div',
      { class: 'settings' },
      themeRow(S.settings),
      p.type === 'standard' ? null : row('set-mirror', 'Mirror black squares for me', 'Turn off to place every mirror square yourself. The mirror squares are ringed in blue either way.', () => S.settings.autoMirror, (v) => { S.settings.autoMirror = v; save(); }),
      p.type === 'standard' ? null : symRow(),
      row('set-fb', 'Layout feedback', 'Show whether each clue fits the grid. This gives hints about the layout.', () => S.settings.layoutFeedback, (v) => { S.settings.layoutFeedback = v; save(); }),
      row('set-skip', 'Skip filled squares', 'Typing jumps over squares that already have a letter.', () => S.settings.skipFilled, (v) => { S.settings.skipFilled = v; save(); }),
      row('set-down', 'Move solved clues down', 'Crossed-off clues drop to the end of each list.', () => S.settings.moveSolvedDown, (v) => { S.settings.moveSolvedDown = v; save(); }),
      row('set-timer', 'Show timer', '', () => S.settings.showTimer, (v) => { S.settings.showTimer = v; save(); }),
      kbRow()
    );
    dialog({ title: 'Settings', body, buttons: [{ label: 'Done', value: true, primary: true }] });
  }
  async function renamePuzzle() {
    const v = await inputDialog('Rename puzzle', 'Name', p.title, { maxlength: 60, okLabel: 'Rename' });
    if (v && v.trim()) {
      p.title = v.trim();
      titleEl.textContent = p.title;
      scheduleSave();
    }
  }
  // the selected word in a clue, else the letters of the current answer, else ask
  async function lookUp() {
    let w = cleanWord(window.getSelection ? window.getSelection().toString() : '');
    if (!w) {
      const slot = currentSlot();
      const letters = slot ? slot.cells.map((i) => (p.cells[i].letter && !p.cells[i].pencil ? p.cells[i].letter : '?')).join('') : '';
      if (letters && !letters.includes('?')) w = cleanWord(letters);
    }
    if (!w) {
      const typed = await inputDialog('Look up a word', 'Word', '', { okLabel: 'Look up' });
      if (typed == null) return;
      w = typed;
    }
    showDefinition(w);
  }

  function toolsMenu() {
    actionSheet('Tools', [
      { label: 'Look up a word', hint: 'A dictionary definition of a word from a clue or your answer', run: lookUp },
      { label: 'Word finder', hint: 'Fill in a pattern like C?T?? or find anagrams', run: wordFinder },
      { label: 'Show original photo', hint: 'See the printed puzzle', run: showOriginal },
      { label: 'Rename puzzle', run: renamePuzzle },
      { label: 'Clear\u2026', hint: 'Letters, black squares, numbers or everything', run: clearDialog },
    ]);
  }

  // ---------------------------------------------------------------- completion
  function isComplete() {
    if (!p.clues.across.length && !p.clues.down.length) return false;
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
  const grid = createGridView({ down: onGridDown, move() {}, up() {} });
  const clues = createClueLists({ onSelect: selectClue, onToggle: toggleDone });
  const kb = createKeyboard({
    letter: typeLetter,
    digit: typeDigit,
    done: () => { finishNumber(); S.input = 'letter'; if (S.settings.keyboard === 'auto') S.kbOpen = false; render(); },
    backspace,
    toggleDir,
    togglePencil: () => { S.pencil = !S.pencil; render(); },
    prev: () => stepClue(-1),
    next: () => stepClue(1),
    hide: () => { S.kbOpen = false; render(); },
  });

  const btn = (label, fn, cls = '', aria) => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn, 'aria-label': aria || label }, label);
  const backBtn = btn('‹ Library', () => exit(), 'quiet');
  const titleEl = h('h1', { class: 'play-title' }, p.title);
  const iconBtn = (name, label, fn, cls = '') => h('button', { class: 'btn quiet ibtn ' + cls, type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name));
  const pencilBtn = iconBtn('pencil', 'Pencil', () => { S.pencil = !S.pencil; render(); }, 'toggle');
  const undoBtn = iconBtn('undo', 'Undo', undo);
  const redoBtn = iconBtn('redo', 'Redo', redo);
  const toolsBtn = h('button', { class: 'btn quiet ibtn', type: 'button', 'aria-label': 'Tools', onclick: toolsMenu }, icon('tools'), h('span', { class: 'ilabel' }, 'Tools'));
  const settingsBtn = iconBtn('settings', 'Settings', settingsDialog);
  // pick a square, then choose what goes in it
  const toolBtn = (name, label, fn) => h('button', { class: 'sq-tool', type: 'button', onclick: fn }, icon(name, 26), h('span', null, label));
  const toolLetter = toolBtn('letter', 'Letter', () => setInput('letter'));
  const toolNumber = toolBtn('number', 'Number', () => setInput('number'));
  const toolBlack = toolBtn('black', 'Black', toggleBlack);
  toolBlack.title = 'Black square';
  const sqTools = h('div', { class: 'sq-tools', role: 'group', 'aria-label': 'Put in the selected square' }, toolLetter, toolNumber, toolBlack);
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
      pencilBtn,
      undoBtn,
      redoBtn,
      toolsBtn,
      settingsBtn,
      timerEl
    ),
    h('div', { class: 'play-main' }, h('div', { class: 'grid-pane' }, grid.el), h('div', { class: 'side-pane' }, clueBar, sqTools, clues.root, kb.el))
  );
  root.style.setProperty('--cols', p.cols);
  root.style.setProperty('--rows', p.rows);
  container.textContent = '';
  container.append(root);
  const unwatch = watchSelection(root);

  function render() {
    const kbMode = S.settings.keyboard;
    const selBlock = p.cells[S.sel].block;
    const kbVisible = !selBlock && (kbMode === 'always' || (kbMode === 'auto' && S.kbOpen));
    const slot = currentSlot();
    const warn = new Set();
    if (S.settings.layoutFeedback) {
      for (const dir of ['across', 'down']) for (const e of S.fit[dir]) if (e.status === 'length-mismatch') e.slot.cells.forEach((i) => warn.add(i));
      for (const s of S.fit.orphanSlots) s.cells.forEach((i) => warn.add(i));
    }
    grid.update({
      puzzle: p,
      numbering: S.numbering,
      sel: S.sel,
      wordCells: new Set(slot ? slot.cells : []),
      mirrors: new Set(selBlock ? mirrorsOf(S.sel).filter((j) => !p.cells[j].block) : []), // the mirror squares still to place
      warn,
    });
    grid.el.classList.toggle('placing', !!S.placing);

    // current clue bar
    const entry = entryFor(slot);
    clueBar.textContent = '';
    if (S.placing) {
      clueBar.append(
        h(
          'div',
          { class: 'cb-main' },
          h('strong', { class: 'cb-num' }, `${S.placing.number} ${DIR_NAME[S.placing.dir]}`),
          ' starts where? Tap its square in the grid. ',
          h('button', { class: 'btn quiet small', type: 'button', onclick: () => { S.placing = null; render(); } }, 'Cancel')
        )
      );
    } else if (selBlock) {
      const todo = mirrorsOf(S.sel).filter((j) => !p.cells[j].block).length;
      clueBar.append(
        h(
          'div',
          { class: 'cb-main' },
          h('strong', null, 'Black square. '),
          todo && symMode() !== 'none'
            ? `Its ${todo === 1 ? 'mirror square is' : 'mirror squares are'} ringed in blue: ${S.settings.autoMirror ? '' : 'they are yours to place. '}pick ${todo === 1 ? 'it' : 'each one'}, then tap Black.`
            : 'Tap Make white to undo it.'
        )
      );
    } else if (S.input === 'number') {
      const c = p.cells[S.sel];
      clueBar.append(h('div', { class: 'cb-main' }, h('strong', null, 'Number: '), c.givenNumber ? `${c.givenNumber} is printed here and stays.` : `type the clue number that starts in this square${c.userNumber ? ` (now ${c.userNumber})` : ''}.`));
    } else if (!slot) {
      clueBar.append(h('div', { class: 'cb-main muted' }, 'Tap a square to begin.'));
    } else {
      const pattern = slot.cells.map((i) => p.cells[i].letter || '·').join(' ');
      if (entry) {
        clueBar.append(
          h('div', { class: 'cb-main' }, h('strong', { class: 'cb-num' }, `${entry.clue.number} ${DIR_NAME[slot.dir]}`), ' ', entry.clue.text, entry.clue.enumeration ? h('span', { class: 'ce' }, ` (${entry.clue.enumeration})`) : null),
          h(
            'div',
            { class: 'cb-foot' },
            h('span', { class: 'cb-pattern' }, pattern),
            h('span', { class: 'grow' }),
            !kbVisible && kbMode === 'auto' ? h('button', { class: 'btn quiet small', type: 'button', onclick: () => { S.kbOpen = true; render(); } }, 'Keyboard') : null,
            h('button', { class: 'btn quiet small', type: 'button', onclick: () => setLetterCount(entry) }, entry.clue.enumeration ? 'Change letter count' : 'Set letter count')
          )
        );
      } else {
        clueBar.append(h('div', { class: 'cb-main' }, h('strong', { class: 'cb-num' }, `${DIR_NAME[slot.dir]} word`), ` of ${slot.length} letters. `, h('span', { class: 'muted' }, 'Tap a clue, then this word\u2019s first square, to link them.')), h('div', { class: 'cb-pattern' }, pattern));
      }
    }
    clues.update({ puzzle: p, matches: S.matches, activeKey: entry ? slot.dir + ':' + entry.clue.number : '', settings: S.settings });
    kb.setState({ dir: S.dir, pencil: S.pencil, input: S.input });
    toolLetter.classList.toggle('on', !selBlock && S.input === 'letter');
    toolNumber.classList.toggle('on', !selBlock && S.input === 'number');
    toolBlack.classList.toggle('on', selBlock);
    const standard = p.type === 'standard'; // the whole grid is printed: only letters are entered
    toolLetter.disabled = selBlock;
    toolNumber.disabled = standard || selBlock;
    toolBlack.disabled = standard || !!p.cells[S.sel].givenBlock;
    toolBlack.lastChild.textContent = selBlock ? 'Make white' : 'Black';
    undoBtn.disabled = !S.undo.length;
    redoBtn.disabled = !S.redo.length;
    timerEl.hidden = !S.settings.showTimer;
    kb.el.hidden = !kbVisible;
    root.classList.toggle('kb-open', kbVisible);
    pencilBtn.classList.toggle('on', S.pencil);
    pencilBtn.setAttribute('aria-pressed', S.pencil ? 'true' : 'false');
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
    try { finishNumber(); } catch (e) { /* nothing to finish */ }
    clearInterval(timerId);
    unwatch();
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
