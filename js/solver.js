// Black-square layout solver for skeleton crosswords. Pure: no DOM.
//
// Depth-first search over cells in reading order with a tri-state grid and a
// trail stack. Clue numbers and lengths pin the layout down.

const U = 0;
const W = 1;
const B = 2;

/**
 * @param {object} opts
 *  size, clues:{across:[{number,length}],down:[...]},
 *  givenBlocks:[idx], givenWhites:[idx], givenNumbers:{idx:number},
 *  symmetry:boolean, maxSolutions, nodeCap
 * @returns {{solutions:Uint8Array[], unique:boolean, count:number, nodes:number, capped:boolean}}
 *  solutions[k][i] === 1 where the cell is a block.
 */
export function solveLayout(opts) {
  const N = opts.size;
  const T = N * N;
  const sym = !!opts.symmetry;
  const maxSolutions = opts.maxSolutions || 2;
  const nodeCap = opts.nodeCap || 2000000;
  // Real puzzles never contain a white square that belongs to no entry.
  const allowIsolated = !!opts.allowIsolated;
  const result = { solutions: [], unique: false, count: 0, nodes: 0, capped: false };

  const A = [];
  const D = [];
  let K = 0;
  for (const c of opts.clues.across) {
    if (A[c.number] && A[c.number] !== c.length) return result;
    A[c.number] = c.length;
    K = Math.max(K, c.number);
  }
  for (const c of opts.clues.down) {
    if (D[c.number] && D[c.number] !== c.length) return result;
    D[c.number] = c.length;
    K = Math.max(K, c.number);
  }
  // every number 1..K must have at least one clue
  for (let n = 1; n <= K; n++) if (!A[n] && !D[n]) return result;
  if (K === 0) return result;

  const g = new Uint8Array(T);
  const trail = [];
  const givenNum = new Int32Array(T);

  function set(i, v) {
    if (g[i] === v) {
      return true;
    }
    if (g[i] !== U) return false;
    g[i] = v;
    trail.push(i);
    if (sym) {
      const m = T - 1 - i;
      if (m !== i && g[m] !== v) {
        if (g[m] !== U) return false;
        g[m] = v;
        trail.push(m);
      }
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

  function runSet(i, step, len) {
    const r = (i / N) | 0;
    const c = i % N;
    if (step === 1) {
      if (c + len > N) return false;
    } else if (r + len > N) return false;
    for (let k = 0; k < len; k++) if (!set(i + k * step, W)) return false;
    const endR = step === 1 ? r : r + len;
    const endC = step === 1 ? c + len : c;
    if (endR < N && endC < N) return set(i + len * step, B);
    return true;
  }

  let stop = false;

  // Cells already known to be white, with block/edge to the left and above and a white
  // neighbour to the right or below, must be numbered starts. More of them than remaining
  // clue numbers means this branch is dead. (Symmetry makes many far cells known early.)
  function forcedStarts(from) {
    let count = 0;
    for (let j = from; j < T; j++) {
      if (g[j] !== W) continue;
      const r = (j / N) | 0;
      const c = j % N;
      if (!(c === 0 || g[j - 1] === B)) continue;
      if (!(r === 0 || g[j - N] === B)) continue;
      if ((c < N - 1 && g[j + 1] === W) || (r < N - 1 && g[j + N] === W)) count++;
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
        if (result.solutions.length >= maxSolutions) stop = true;
      }
      return;
    }
    // pruning: the remaining clue numbers each need their own start cell
    if (K - n + 1 > T - i) return;
    if (i % N === 0 && forcedStarts(i) > K - n + 1) return;
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
    const r = (i / N) | 0;
    const c = i % N;
    const leftB = c === 0 || g[i - 1] === B;
    const aboveB = r === 0 || g[i - N] === B;
    const rightExists = c < N - 1;
    const belowExists = r < N - 1;
    const right = rightExists ? g[i + 1] : B;
    const below = belowExists ? g[i + N] : B;
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
          else if (a !== (A[n] > 0) || d !== (D[n] > 0)) ok = false;
          if (ok && a) ok = runSet(i, 1, A[n]);
          if (ok && d) ok = runSet(i, N, D[n]);
          nn = n + 1;
        } else if (givenNum[i]) {
          ok = false;
        } else if (leftB && aboveB && !allowIsolated) {
          ok = false; // isolated white square: belongs to no entry
        }
        if (ok && !a && leftB && rightExists) ok = set(i + 1, B);
        if (ok && !d && aboveB && belowExists) ok = set(i + N, B);
        if (ok) visit(i + 1, nn);
        undo(mark);
        if (stop) return;
      }
    }
  }

  visit(0, 1);
  result.count = result.solutions.length;
  result.unique = result.count === 1 && !result.capped;
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
  return {
    size: puzzle.size,
    clues: {
      across: puzzle.clues.across.filter((c) => c.length > 0).map((c) => ({ number: c.number, length: c.length })),
      down: puzzle.clues.down.filter((c) => c.length > 0).map((c) => ({ number: c.number, length: c.length })),
    },
    givenBlocks,
    givenWhites,
    givenNumbers,
    symmetry: puzzle.settings.symmetry === 'rotational',
    maxSolutions: extra.maxSolutions || 2,
    nodeCap: extra.nodeCap || 2000000,
  };
}
