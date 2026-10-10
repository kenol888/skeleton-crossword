// Puzzle data model, numbering and clue matching. Pure: no DOM.

export const VERSION = 1;

export function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createCell() {
  return {
    block: false,
    givenBlock: false,
    givenNumber: null,
    givenLetter: null,
    letter: '',
    pencil: false,
  };
}

export function createPuzzle({ size = 15, title = 'Untitled', clues, cells, settings, sourceImage = null } = {}) {
  const now = Date.now();
  const p = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    size,
    cells: cells || Array.from({ length: size * size }, createCell),
    clues: clues || { across: [], down: [] },
    sourceImage,
    settings: Object.assign({ symmetry: 'rotational' }, settings || {}),
    elapsedMs: 0,
  };
  for (const c of p.cells) {
    if (c.givenBlock) c.block = true;
    if (c.givenLetter) { c.letter = c.givenLetter; c.block = false; c.pencil = false; }
  }
  return p;
}

/** Index of the cell diagonally opposite (180 degree rotation). */
export function mirror(idx, size) {
  return size * size - 1 - idx;
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
 * Standard crossword numbering. `puzzle` needs { size, cells:[{block}] }.
 * Returns { numbers:Int[N*N], slots:[{number,dir,cells,length}] }
 */
export function computeNumbering(puzzle) {
  const N = puzzle.size;
  const cells = puzzle.cells;
  const white = (r, c) => r >= 0 && c >= 0 && r < N && c < N && !cells[r * N + c].block;
  const numbers = new Array(N * N).fill(0);
  const slots = [];
  let next = 1;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!white(r, c)) continue;
      const startsAcross = !white(r, c - 1) && white(r, c + 1);
      const startsDown = !white(r - 1, c) && white(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      const number = next++;
      numbers[r * N + c] = number;
      if (startsAcross) {
        const idxs = [];
        for (let cc = c; white(r, cc); cc++) idxs.push(r * N + cc);
        slots.push({ number, dir: 'across', cells: idxs, length: idxs.length });
      }
      if (startsDown) {
        const idxs = [];
        for (let rr = r; white(rr, c); rr++) idxs.push(rr * N + c);
        slots.push({ number, dir: 'down', cells: idxs, length: idxs.length });
      }
    }
  }
  return { numbers, slots };
}

/**
 * Match each clue to a slot.
 * Returns { across:[{clue,slot,status}], down:[...], orphanSlots:[slot] }
 * status: 'ok' | 'length-mismatch' | 'missing'
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
  if (!o || typeof o !== 'object' || !Array.isArray(o.cells) || !o.size) throw new Error('Not a puzzle file');
  if (o.cells.length !== o.size * o.size) throw new Error('Grid size does not match cell count');
  const p = createPuzzle({ size: o.size, title: o.title || 'Untitled' });
  p.id = o.id || p.id;
  p.createdAt = o.createdAt || p.createdAt;
  p.updatedAt = o.updatedAt || p.updatedAt;
  p.cells = o.cells.map((c) => Object.assign(createCell(), c));
  p.clues = {
    across: (o.clues && o.clues.across ? o.clues.across : []).map((c) => makeClueFrom(c)),
    down: (o.clues && o.clues.down ? o.clues.down : []).map((c) => makeClueFrom(c)),
  };
  p.sourceImage = o.sourceImage || null;
  p.settings = Object.assign({ symmetry: 'rotational' }, o.settings || {});
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
export function fromPattern(rows) {
  const size = rows.length;
  const p = createPuzzle({ size });
  rows.forEach((row, r) => {
    for (let c = 0; c < size; c++) p.cells[r * size + c].block = row[c] === '#';
  });
  return p;
}
