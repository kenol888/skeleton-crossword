import test from 'node:test';
import assert from 'node:assert/strict';
import {
  darkMask, detectQuad, detectGridSize, detectHints, warpGrey, solveHomography, applyHomography,
} from '../js/gridDetect.js';

// Synthetic printed grid: white page, thick outer frame, thin lines, solid blocks,
// a small digit blob in the top-left of some cells and a letter blob in others.
function makeGrid(N, W, blocks, numberCells, letterCells) {
  const g = new Uint8Array(W * W).fill(255);
  const cs = W / N;
  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(W, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) g[y * W + x] = 0;
    }
  };
  for (let k = 0; k <= N; k++) {
    const t = k === 0 || k === N ? 4 : 2;
    rect(k * cs - t / 2, 0, k * cs + t / 2, W);
    rect(0, k * cs - t / 2, W, k * cs + t / 2);
  }
  for (const i of blocks) rect((i % N) * cs, Math.floor(i / N) * cs, (i % N) * cs + cs, Math.floor(i / N) * cs + cs);
  for (const i of numberCells) {
    const x = (i % N) * cs;
    const y = Math.floor(i / N) * cs;
    rect(x + 0.2 * cs, y + 0.15 * cs, x + 0.4 * cs, y + 0.4 * cs);
  }
  for (const i of letterCells) {
    const x = (i % N) * cs;
    const y = Math.floor(i / N) * cs;
    rect(x + 0.3 * cs, y + 0.5 * cs, x + 0.7 * cs, y + 0.85 * cs);
  }
  return g;
}

test('detects grid sizes 15, 13 and 11', () => {
  for (const N of [15, 13, 11]) {
    const g = makeGrid(N, 900, [5, 20], [3], [40]);
    assert.equal(detectGridSize(darkMask(g), 900).N, N);
  }
});

test('detects blocks, number and letter candidates', () => {
  const N = 15;
  const g = makeGrid(N, 900, [5, 219], [3], [40]);
  const hints = detectHints(darkMask(g), 900, N);
  assert.equal(hints[5].block, true);
  assert.equal(hints[219].block, true);
  assert.equal(hints[3].maybeNumber, true);
  assert.equal(hints[40].maybeLetter, true);
  assert.equal(hints[7].block || hints[7].maybeNumber || hints[7].maybeLetter, false);
  assert.equal(hints.filter((h) => h.block).length, 2);
});

test('finds the grid rectangle on a larger page', () => {
  const W = 900;
  const page = new Uint8Array(1200 * 1000).fill(255);
  const grid = makeGrid(15, W, [], [], []);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (50 + y < 1000 && 150 + x < 1200) page[(50 + y) * 1200 + 150 + x] = grid[y * W + x];
  const q = detectQuad(darkMask(page), 1200, 1000);
  assert.ok(Math.abs(q[0][0] - 148) < 6 && Math.abs(q[0][1] - 48) < 6, JSON.stringify(q));
  assert.ok(Math.abs(q[2][0] - 1052) < 8 && Math.abs(q[2][1] - 952) < 8, JSON.stringify(q));
});

test('warping the whole image onto itself keeps it', () => {
  const g = makeGrid(9, 300, [4], [], []);
  const out = warpGrey(g, 300, 300, [[0, 0], [300, 0], [300, 300], [0, 300]], 300);
  let diff = 0;
  for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - out[i]);
  assert.ok(diff / g.length < 1, 'mean diff ' + diff / g.length);
});

test('warping a skewed photo straightens the grid', () => {
  const W = 900;
  const grid = makeGrid(13, W, [10, 100], [], []);
  const quad = [[30, 20], [880, 40], [900, 890], [10, 870]];
  const P = 1000;
  const page = new Uint8Array(P * P).fill(255);
  const H = solveHomography(quad, [[0, 0], [W, 0], [W, W], [0, W]]); // page -> grid
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const [u, v] = applyHomography(H, x + 0.5, y + 0.5);
      if (u >= 0 && v >= 0 && u < W && v < W) page[y * P + x] = grid[Math.floor(v) * W + Math.floor(u)];
    }
  }
  const out = warpGrey(page, P, P, quad, W);
  assert.equal(detectGridSize(darkMask(out), W).N, 13);
  assert.equal(detectHints(darkMask(out), W, 13)[10].block, true);
});
