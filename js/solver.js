// Black-square layout solver for skeleton crosswords. Pure: no DOM.
//
// Depth-first search over cells in reading order with a tri-state grid and a trail stack.
// The clue numbers say which numbers start an across word, a down word or both; letter
// counts, where known, pin the lengths. Symmetry copies every decision to its mirror cells.
import { symmetryTargets } from './model.js';

const U = 0;
const W = 1;
const B = 2;

/**
 * @param {object} opts
 *  rows, cols (or size for a square grid),
 *  clues:{across:[{number,length?}],down:[...]}  (length 0/missing = unknown),
 *  givenBlocks:[idx], givenWhites:[idx], givenNumbers:{idx:number},
 *  symmetry: 'mirror4' | 'rotational' | 'none' (true = rotational, false = none),
 *  maxSolutions, nodeCap
 * @returns {{solutions:Uint8Array[], unique:boolean, count:number, nodes:number, capped:boolean}}
 *  solutions[k][i] === 1 where the cell is a block.
 */
export function solveLayout(opts) {
  const R = opts.rows || opts.size;
  const C = opts.cols || opts.size;
  const T = R * C;
  let mode = opts.symmetry;
  if (mode === true) mode = 'rotational';
  if (!mode) mode = 'none';
  const maxSolutions = opts.maxSolutions || 2;
  const nodeCap = opts.nodeCap || 2000000;
  // Real puzzles never contain a white square that belongs to no entry.
  const allowIsolated = !!opts.allowIsolated;
  const result = { solutions: [], unique: false, complete: false, count: 0, nodes: 0, capped: false, truncated: false };

  const hasA = [];
  const hasD = [];
  const A = []; // known across length, or 0
  const D = [];
  let K = 0;
  for (const c of opts.clues.across) {
    if (hasA[c.number] && (A[c.number] || 0) !== (c.length || 0) && A[c.number] && c.length) return result;
    hasA[c.number] = true;
    A[c.number] = c.length || A[c.number] || 0;
    K = Math.max(K, c.number);
  }
  for (const c of opts.clues.down) {
    if (hasD[c.number] && D[c.number] && c.length && D[c.number] !== c.length) return result;
    hasD[c.number] = true;
    D[c.number] = c.length || D[c.number] || 0;
    K = Math.max(K, c.number);
  }
  // every number 1..K must have at least one clue
  for (let n = 1; n <= K; n++) if (!hasA[n] && !hasD[n]) return result;
  if (K === 0) return result;

  const mir = [];
  for (let i = 0; i < T; i++) mir.push(symmetryTargets(i, R, C, mode));

  const g = new Uint8Array(T);
  const trail = [];
  const givenNum = new Int32Array(T);

  function set(i, v) {
    if (g[i] !== v) {
      if (g[i] !== U) return false;
      g[i] = v;
      trail.push(i);
    }
    const m = mir[i];
    for (let k = 0; k < m.length; k++) {
      const j = m[k];
      if (g[j] === v) continue;
      if (g[j] !== U) return false;
      g[j] = v;
      trail.push(j);
    }
    return true;
  }
  function undo(mark) {
    while (trail.length > mark) g[trail.pop()] = U;
  }

  for (const i of opts.givenBlocks || []) if (!set(i, B)) return result;
  for (const i of opts.givenWhites || []) if (!set(i, W)) return result;
  for (const [k, v] of Object.entries(opts.givenNumbers || {})) {
    const i = Number(k);
    givenNum[i] = v;
    if (!set(i, W)) return result;
  }
  trail.length = 0; // givens are permanent

  // A word of known length: cells white, the one after it black (unless the grid ends).
  function runSet(i, step, len) {
    const r = Math.floor(i / C);
    const c = i % C;
    if (step === 1) {
      if (c + len > C) return false;
    } else if (r + len > R) return false;
    for (let k = 0; k < len; k++) if (!set(i + k * step, W)) return false;
    const endR = step === 1 ? r : r + len;
    const endC = step === 1 ? c + len : c;
    if (endR < R && endC < C) return set(i + len * step, B);
    return true;
  }
  // A word of unknown length: at least two cells.
  function startSet(i, step) {
    const r = Math.floor(i / C);
    const c = i % C;
    if (step === 1 ? c + 1 >= C : r + 1 >= R) return false;
    return set(i + step, W);
  }

  let stop = false;

  // Cells already known to be white, with block/edge to the left and above and a white
  // neighbour to the right or below, must be numbered starts. More of them than remaining
  // clue numbers means this branch is dead. (Symmetry makes many far cells known early.)
  function forcedStarts(from) {
    let count = 0;
    for (let j = from; j < T; j++) {
      if (g[j] !== W) continue;
      const r = Math.floor(j / C);
      const c = j % C;
      if (!(c === 0 || g[j - 1] === B)) continue;
      if (!(r === 0 || g[j - C] === B)) continue;
      if ((c < C - 1 && g[j + 1] === W) || (r < R - 1 && g[j + C] === W)) count++;
    }
    return count;
  }

  function visit(i, n) {
    if (stop) return;
    if (++result.nodes > nodeCap) {
      result.capped = true;
      stop = true;
      return;
    }
    if (i === T) {
      if (n === K + 1) {
        const sol = new Uint8Array(T);
        for (let k = 0; k < T; k++) sol[k] = g[k] === B ? 1 : 0;
        result.solutions.push(sol);
        if (result.solutions.length >= maxSolutions) {
          stop = true;
          result.truncated = true; // there may be more solutions than were collected
        }
      }
      return;
    }
    // pruning: the remaining clue numbers each need their own start cell
    if (K - n + 1 > T - i) return;
    if (i % C === 0 && forcedStarts(i) > K - n + 1) return;
    if (g[i] === U) {
      for (const v of [W, B]) {
        const mark = trail.length;
        if (set(i, v)) place(i, n);
        undo(mark);
        if (stop) return;
      }
    } else {
      place(i, n);
    }
  }

  function place(i, n) {
    if (g[i] === B) {
      visit(i + 1, n);
      return;
    }
    const r = Math.floor(i / C);
    const c = i % C;
    const leftB = c === 0 || g[i - 1] === B;
    const aboveB = r === 0 || g[i - C] === B;
    const rightExists = c < C - 1;
    const belowExists = r < R - 1;
    const right = rightExists ? g[i + 1] : B;
    const below = belowExists ? g[i + C] : B;
    let aOpts;
    let dOpts;
    if (!leftB) aOpts = [false];
    else if (right === W) aOpts = [true];
    else if (right === B) aOpts = [false];
    else aOpts = [true, false];
    if (!aboveB) dOpts = [false];
    else if (below === W) dOpts = [true];
    else if (below === B) dOpts = [false];
    else dOpts = [true, false];

    for (const a of aOpts) {
      for (const d of dOpts) {
        const mark = trail.length;
        let ok = true;
        let nn = n;
        if (a || d) {
          if (n > K) ok = false;
          else if (givenNum[i] && givenNum[i] !== n) ok = false;
          else if (a !== !!hasA[n] || d !== !!hasD[n]) ok = false;
          if (ok && a) ok = A[n] > 0 ? runSet(i, 1, A[n]) : startSet(i, 1);
          if (ok && d) ok = D[n] > 0 ? runSet(i, C, D[n]) : startSet(i, C);
          nn = n + 1;
        } else if (givenNum[i]) {
          ok = false;
        } else if (leftB && aboveB && !allowIsolated) {
          ok = false; // isolated white square: belongs to no entry
        }
        if (ok && !a && leftB && rightExists) ok = set(i + 1, B);
        if (ok && !d && aboveB && belowExists) ok = set(i + C, B);
        if (ok) visit(i + 1, nn);
        undo(mark);
        if (stop) return;
      }
    }
  }

  visit(0, 1);
  result.count = result.solutions.length;
  // `complete`: every solution was found, so facts shared by all of them are certain
  result.complete = !result.capped && !result.truncated;
  result.unique = result.count === 1 && result.complete;
  return result;
}

/** Build solver options from a puzzle. extraBlocks: indices the user has marked as blocks. */
export function optionsFromPuzzle(puzzle, extra = {}) {
  const givenBlocks = [];
  const givenWhites = [];
  const givenNumbers = {};
  puzzle.cells.forEach((c, i) => {
    if (c.givenBlock) givenBlocks.push(i);
    if (c.givenLetter) givenWhites.push(i);
    if (c.givenNumber) givenNumbers[i] = c.givenNumber;
  });
  for (const i of extra.extraBlocks || []) givenBlocks.push(i);
  for (const i of extra.extraWhites || []) givenWhites.push(i);
  const pick = (list) => list.map((c) => ({ number: c.number, length: c.length || 0 }));
  return {
    rows: puzzle.rows,
    cols: puzzle.cols,
    clues: { across: pick(puzzle.clues.across), down: pick(puzzle.clues.down) },
    givenBlocks,
    givenWhites,
    givenNumbers,
    symmetry: puzzle.settings.symmetry,
    maxSolutions: extra.maxSolutions || 2,
    nodeCap: extra.nodeCap || 2000000,
  };
}
