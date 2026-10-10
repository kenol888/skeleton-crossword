// Puzzle data model, numbering and clue matching. Pure: no DOM.

export const VERSION = 2;

/** Symmetry modes for the black squares. */
export const SYMMETRY = {
  mirror4: 'Mirror: top and bottom, left and right',
  rotational: 'Rotational: upside down',
  none: 'None',
};

export function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createCell() {
  return {
    block: false,
    givenBlock: false,
    givenNumber: null, // a clue number printed in the puzzle (locked)
    userNumber: null, // a clue number the player typed in
    givenLetter: null,
    letter: '',
    pencil: false,
  };
}

/** createPuzzle({ rows, cols }) or createPuzzle({ size }) for a square grid. */
export function createPuzzle({ rows, cols, size, title = 'Untitled', clues, cells, settings, sourceImage = null } = {}) {
  rows = rows || size || 11;
  cols = cols || size || 15;
  const now = Date.now();
  const p = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    rows,
    cols,
    cells: cells || Array.from({ length: rows * cols }, createCell),
    clues: clues || { across: [], down: [] },
    sourceImage,
    settings: Object.assign({ symmetry: 'mirror4' }, settings || {}),
    elapsedMs: 0,
  };
  for (const c of p.cells) {
    if (c.givenBlock) c.block = true;
    if (c.givenLetter) { c.letter = c.givenLetter; c.block = false; c.pencil = false; }
  }
  return p;
}

/**
 * The other squares that must match square `idx` under a symmetry mode.
 * mirror4: reflected top/bottom, left/right and both (up to 3 others).
 * rotational: the square diagonally opposite (half turn).
 */
export function symmetryTargets(idx, rows, cols, mode) {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const out = [];
  const add = (rr, cc) => {
    const j = rr * cols + cc;
    if (j !== idx && !out.includes(j)) out.push(j);
  };
  if (mode === 'mirror4') {
    add(rows - 1 - r, c);
    add(r, cols - 1 - c);
    add(rows - 1 - r, cols - 1 - c);
  } else if (mode === 'rotational') {
    add(rows - 1 - r, cols - 1 - c);
  }
  return out;
}

/** Parse "4-7", "3,4", "2,3,4", "(5)" -> { length, parts } */
export function parseEnumeration(str) {
  const parts = String(str || '').match(/\d+/g);
  if (!parts) return { length: 0, parts: [] };
  const nums = parts.map(Number);
  return { length: nums.reduce((a, b) => a + b, 0), parts: nums };
}

export function makeClue(number, text, enumeration) {
  return {
    number: Number(number),
    text: text || '',
    enumeration: enumeration || '',
    length: parseEnumeration(enumeration).length,
    manualDone: false,
  };
}

/**
 * Standard crossword numbering. `puzzle` needs { rows, cols, cells:[{block}] }.
 * Returns { numbers:Int[rows*cols] (0 = none), slots:[{number,dir,cells,length}] }
 */
export function computeNumbering(puzzle) {
  const R = puzzle.rows;
  const C = puzzle.cols;
  const cells = puzzle.cells;
  const white = (r, c) => r >= 0 && c >= 0 && r < R && c < C && !cells[r * C + c].block;
  const numbers = new Array(R * C).fill(0);
  const slots = [];
  let next = 1;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (!white(r, c)) continue;
      const startsAcross = !white(r, c - 1) && white(r, c + 1);
      const startsDown = !white(r - 1, c) && white(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      const number = next++;
      numbers[r * C + c] = number;
      if (startsAcross) {
        const idxs = [];
        for (let cc = c; white(r, cc); cc++) idxs.push(r * C + cc);
        slots.push({ number, dir: 'across', cells: idxs, length: idxs.length });
      }
      if (startsDown) {
        const idxs = [];
        for (let rr = r; white(rr, c); rr++) idxs.push(rr * C + c);
        slots.push({ number, dir: 'down', cells: idxs, length: idxs.length });
      }
    }
  }
  return { numbers, slots };
}

/** The clue number shown in a square: the printed one, else the one the player typed. 0 if none. */
export function numberAt(cell) {
  return cell.givenNumber || cell.userNumber || 0;
}

/**
 * Link each clue to the word that starts in the square the player numbered with its number.
 * Nothing is worked out for the player: a clue with no number placed yet has status 'missing'.
 * Returns { across:[{clue,slot,status,at}], down:[...], orphanSlots:[slot] }
 * status: 'ok' | 'length-mismatch' | 'missing' (no square carries this number)
 *         | 'misplaced' (the numbered square does not start a word in this direction).
 * `at` is the numbered square, or null. Words come from `numbering.slots`.
 */
export function linkClues(puzzle, numbering) {
  const squareOf = new Map();
  puzzle.cells.forEach((c, i) => {
    const n = numberAt(c);
    if (n && !c.block && !squareOf.has(n)) squareOf.set(n, i);
  });
  const out = { across: [], down: [], orphanSlots: [] };
  const used = new Set();
  for (const dir of ['across', 'down']) {
    for (const clue of puzzle.clues[dir]) {
      const at = squareOf.has(clue.number) ? squareOf.get(clue.number) : null;
      let slot = null;
      let status = 'missing';
      if (at !== null) {
        slot = numbering.slots.find((s) => s.dir === dir && s.cells[0] === at) || null;
        if (!slot) status = 'misplaced';
        else {
          used.add(slot);
          status = !clue.length || slot.length === clue.length ? 'ok' : 'length-mismatch';
        }
      }
      out[dir].push({ clue, slot, status, at });
    }
  }
  out.orphanSlots = numbering.slots.filter((s) => !used.has(s));
  return out;
}

/**
 * Match each clue to a slot by the numbers a layout would get (used to judge a drawn layout,
 * not to show anything to the player).

 * Returns { across:[{clue,slot,status}], down:[...], orphanSlots:[slot] }
 * status: 'ok' | 'length-mismatch' | 'missing'. A clue with no letter count is 'ok' once a word starts there.
 */
export function matchClues(puzzle, numbering) {
  const out = { across: [], down: [], orphanSlots: [] };
  const used = new Set();
  for (const dir of ['across', 'down']) {
    for (const clue of puzzle.clues[dir]) {
      const slot = numbering.slots.find((s) => s.dir === dir && s.number === clue.number) || null;
      let status = 'missing';
      if (slot) {
        used.add(slot);
        status = !clue.length || slot.length === clue.length ? 'ok' : 'length-mismatch';
      }
      out[dir].push({ clue, slot, status });
    }
  }
  out.orphanSlots = numbering.slots.filter((s) => !used.has(s));
  return out;
}

/** A slot is filled when every cell has a non-pencil letter. */
export function slotFilled(puzzle, slot) {
  return slot.cells.every((i) => puzzle.cells[i].letter && !puzzle.cells[i].pencil);
}

/** Progress 0..1: filled cells over white cells. */
export function progress(puzzle) {
  let white = 0;
  let filled = 0;
  for (const c of puzzle.cells) {
    if (c.block) continue;
    white++;
    if (c.letter) filled++;
  }
  return white ? filled / white : 0;
}

export function toJSON(p) {
  return JSON.stringify({ version: VERSION, ...p });
}

export function fromJSON(input) {
  const o = typeof input === 'string' ? JSON.parse(input) : input;
  if (!o || typeof o !== 'object' || !Array.isArray(o.cells)) throw new Error('Not a puzzle file');
  // version 1 files had one square `size`
  const rows = o.rows || o.size;
  const cols = o.cols || o.size;
  if (!rows || !cols) throw new Error('Not a puzzle file');
  if (o.cells.length !== rows * cols) throw new Error('Grid size does not match cell count');
  const p = createPuzzle({ rows, cols, title: o.title || 'Untitled' });
  p.id = o.id || p.id;
  p.createdAt = o.createdAt || p.createdAt;
  p.updatedAt = o.updatedAt || p.updatedAt;
  p.cells = o.cells.map((c) => Object.assign(createCell(), c));
  p.clues = {
    across: (o.clues && o.clues.across ? o.clues.across : []).map((c) => makeClueFrom(c)),
    down: (o.clues && o.clues.down ? o.clues.down : []).map((c) => makeClueFrom(c)),
  };
  p.sourceImage = o.sourceImage || null;
  const legacy = o.version === 1 || !o.version;
  p.settings = Object.assign({ symmetry: legacy ? 'rotational' : 'mirror4' }, o.settings || {});
  if (!SYMMETRY[p.settings.symmetry]) p.settings.symmetry = 'none';
  p.elapsedMs = o.elapsedMs || 0;
  return p;
}

function makeClueFrom(c) {
  const clue = makeClue(c.number, c.text, c.enumeration);
  if (c.length) clue.length = c.length;
  clue.manualDone = !!c.manualDone;
  return clue;
}

/** Build a puzzle from rows of text: '#' block, anything else white. For tests and tools. */
export function fromPattern(rowStrings, settings) {
  const rows = rowStrings.length;
  const cols = rowStrings[0].length;
  const p = createPuzzle({ rows, cols, settings });
  rowStrings.forEach((row, r) => {
    if (row.length !== cols) throw new Error('Rows must all be the same length');
    for (let c = 0; c < cols; c++) p.cells[r * cols + c].block = row[c] === '#';
  });
  return p;
}
