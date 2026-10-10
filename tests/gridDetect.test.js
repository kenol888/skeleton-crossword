import test from 'node:test';
import assert from 'node:assert/strict';
import {
  darkMask, detectQuad, detectGridDims, detectHints, warpGrey, warpDims, solveHomography, applyHomography,
} from '../js/gridDetect.js';

// Synthetic printed grid: white page, thick outer frame, thin lines, solid blocks,
// a small digit blob in the top-left of some cells and a letter blob in others.
function makeGrid(rows, cols, cell, blocks, numberCells, letterCells) {
  const W = cols * cell;
  const H = rows * cell;
  const g = new Uint8Array(W * H).fill(255);
  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) g[y * W + x] = 0;
    }
  };
  for (let k = 0; k <= cols; k++) rect(k * cell - (k === 0 || k === cols ? 2 : 1), 0, k * cell + (k === 0 || k === cols ? 2 : 1), H);
  for (let k = 0; k <= rows; k++) rect(0, k * cell - (k === 0 || k === rows ? 2 : 1), W, k * cell + (k === 0 || k === rows ? 2 : 1));
  const at = (i) => [(i % cols) * cell, Math.floor(i / cols) * cell];
  for (const i of blocks) { const [x, y] = at(i); rect(x, y, x + cell, y + cell); }
  for (const i of numberCells) { const [x, y] = at(i); rect(x + 0.2 * cell, y + 0.15 * cell, x + 0.4 * cell, y + 0.4 * cell); }
  for (const i of letterCells) { const [x, y] = at(i); rect(x + 0.3 * cell, y + 0.5 * cell, x + 0.7 * cell, y + 0.85 * cell); }
  return { g, W, H };
}

test('detects grid dimensions: 15x11, 15x15, 13x9 and 11x11', () => {
  for (const [R, C] of [[11, 15], [15, 15], [9, 13], [11, 11]]) {
    const { g, W, H } = makeGrid(R, C, 60, [5], [3], [40]);
    const d = detectGridDims(darkMask(g), W, H);
    assert.deepEqual([d.rows, d.cols], [R, C], `${C}x${R}`);
  }
});

test('detects blocks, number and letter candidates on a 15x11 grid', () => {
  const R = 11;
  const C = 15;
  const { g, W, H } = makeGrid(R, C, 60, [20, 100], [3], [40]);
  const hints = detectHints(darkMask(g), W, H, R, C);
  assert.equal(hints[20].block, true);
  assert.equal(hints[100].block, true);
  assert.equal(hints[3].maybeNumber, true);
  assert.equal(hints[40].maybeLetter, true);
  assert.equal(hints[7].block || hints[7].maybeNumber || hints[7].maybeLetter, false);
  assert.equal(hints.filter((h) => h.block).length, 2);
});

test('finds the grid on a busy page: header bar, text, form underlines', () => {
  const PW = 1300;
  const PH = 900;
  const page = new Uint8Array(PW * PH).fill(255);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) page[y * PW + x] = 0;
  };
  fill(40, 40, 1260, 70); // navy title bar spanning the page
  const { g, W, H } = makeGrid(11, 15, 34, [20, 100], [], []);
  const ox = 390;
  const oy = 170;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) page[(oy + y) * PW + ox + x] = g[y * W + x];
  // name / address underlines below the grid, same width as the grid
  for (let k = 0; k < 3; k++) fill(ox, oy + H + 30 + k * 30, ox + W, oy + H + 31 + k * 30);
  // text-like speckle to the right
  for (let y = 100; y < 600; y += 4) fill(950, y, 1100, y + 2);
  const q = detectQuad(darkMask(page), PW, PH);
  const near = (a, b, t) => Math.abs(a - b) <= t;
  assert.ok(near(q[0][0], ox - 2, 6) && near(q[0][1], oy - 2, 6), JSON.stringify(q));
  assert.ok(near(q[2][0], ox + W + 2, 6) && near(q[2][1], oy + H + 2, 6), JSON.stringify(q));
});

test('warping the whole image onto itself keeps it', () => {
  const { g, W, H } = makeGrid(7, 9, 40, [4], [], []);
  const out = warpGrey(g, W, H, [[0, 0], [W, 0], [W, H], [0, H]], W, H);
  let diff = 0;
  for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - out[i]);
  assert.ok(diff / g.length < 1, 'mean diff ' + diff / g.length);
});

test('a skewed photo of a 15x11 grid is straightened and measured', () => {
  const { g, W, H } = makeGrid(11, 15, 60, [20, 100], [], []);
  const quad = [[30, 20], [980, 40], [1000, 700], [10, 690]];
  const PW = 1100;
  const PH = 780;
  const page = new Uint8Array(PW * PH).fill(255);
  const Hm = solveHomography(quad, [[0, 0], [W, 0], [W, H], [0, H]]); // page -> grid
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const [u, v] = applyHomography(Hm, x + 0.5, y + 0.5);
      if (u >= 0 && v >= 0 && u < W && v < H) page[y * PW + x] = g[Math.floor(v) * W + Math.floor(u)];
    }
  }
  const dims = warpDims(quad, 1200);
  const out = warpGrey(page, PW, PH, quad, dims.W, dims.H);
  const dark = darkMask(out);
  const d = detectGridDims(dark, dims.W, dims.H);
  assert.deepEqual([d.rows, d.cols], [11, 15]);
  assert.equal(detectHints(dark, dims.W, dims.H, 11, 15)[20].block, true);
});
