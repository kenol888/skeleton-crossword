import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromJSON, fromPattern, computeNumbering } from '../js/model.js';
import { solveLayout, optionsFromPuzzle } from '../js/solver.js';
import { SAMPLE_ROWS } from './fixtures/sample-layout.js';
import { LATTICE_ROWS } from './fixtures/lattice-15x11.js';
import { symmetryTargets } from '../js/model.js';

const sample = () => fromJSON(readFileSync(new URL('./fixtures/sample-15-lengths.json', import.meta.url), 'utf8'));
const mask = (rows) => fromPattern(rows).cells.map((c) => (c.block ? 1 : 0)).join('');

function cluesOf(p) {
  const nb = computeNumbering(p);
  const clues = { across: [], down: [] };
  for (const s of nb.slots) clues[s.dir].push({ number: s.number, length: s.length });
  return { nb, clues };
}

test('sample puzzle: layout is recovered uniquely and quickly', () => {
  const p = sample();
  assert.equal(p.cells.filter((c) => c.block).length, 2); // only the two given blocks are present
  const t = Date.now();
  const r = solveLayout(optionsFromPuzzle(p));
  const ms = Date.now() - t;
  console.log(`  solver: ${r.count} solution(s), unique=${r.unique}, ${r.nodes} nodes, ${ms} ms`);
  assert.equal(r.capped, false);
  assert.equal(r.unique, true);
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(Array.from(r.solutions[0]).join(''), mask(SAMPLE_ROWS));
});

test('sample puzzle: a wrong clue length gives 0 solutions', () => {
  const p = sample();
  p.clues.across[0].length += 1;
  const r = solveLayout(optionsFromPuzzle(p));
  assert.equal(r.count, 0);
  assert.equal(r.capped, false);
});

test('sample puzzle: consistent partial blocks accepted, a wrong block rejected', () => {
  const p = sample();
  const orig = fromPattern(SAMPLE_ROWS);
  const blocks = orig.cells.map((c, i) => (c.block ? i : -1)).filter((i) => i >= 0);
  const ok = solveLayout(optionsFromPuzzle(p, { extraBlocks: blocks.slice(0, 10) }));
  assert.equal(ok.count, 1);
  const whiteIdx = orig.cells.findIndex((c, i) => !c.block && i > 100);
  const bad = solveLayout(optionsFromPuzzle(p, { extraBlocks: [whiteIdx] }));
  assert.equal(bad.count, 0);
});

test('small 5x5 grid with symmetry off still works', () => {
  const p = fromPattern(['...#.', '.....', '.#.#.', '.....', '.#...']);
  const { nb, clues } = cluesOf(p);
  const r = solveLayout({ size: 5, clues, symmetry: false, maxSolutions: 10 });
  assert.ok(r.count >= 1);
  assert.ok(r.solutions.some((s) => Array.from(s).join('') === mask(['...#.', '.....', '.#.#.', '.....', '.#...'])));
  const want = nb.slots.map((x) => `${x.number}${x.dir}${x.length}`).sort();
  for (const s of r.solutions) {
    const rows = Array.from({ length: 5 }, (_, i) => Array.from(s.slice(i * 5, i * 5 + 5)).map((v) => (v ? '#' : '.')).join(''));
    const n2 = computeNumbering(fromPattern(rows));
    assert.deepEqual(n2.slots.map((x) => `${x.number}${x.dir}${x.length}`).sort(), want);
  }
});

test('a 5x5 symmetric example with symmetry on', () => {
  const rows = ['..#..', '.....', '#...#', '.....', '..#..'];
  const { clues } = cluesOf(fromPattern(rows));
  const r = solveLayout({ size: 5, clues, symmetry: true, maxSolutions: 10 });
  assert.ok(r.count >= 1);
  assert.ok(r.solutions.some((s) => Array.from(s).join('') === mask(rows)));
  // every solution is symmetric
  for (const s of r.solutions) for (let i = 0; i < 25; i++) assert.equal(s[i], s[24 - i]);
});

test('inconsistent clue lists return no solutions', () => {
  const r = solveLayout({
    size: 5,
    clues: { across: [{ number: 1, length: 9 }], down: [{ number: 1, length: 5 }] },
    symmetry: false,
  });
  assert.equal(r.count, 0);
  const r2 = solveLayout({ size: 5, clues: { across: [{ number: 1, length: 5 }, { number: 3, length: 5 }], down: [] }, symmetry: true });
  assert.equal(r2.count, 0); // number 2 has no clue
});

// ---- the Sunday Express format: 15 x 11, mirror symmetry, clue numbers only (no letter counts)

const latticeClues = (withLengths) => {
  const p = fromPattern(LATTICE_ROWS);
  const nb = computeNumbering(p);
  const clues = { across: [], down: [] };
  for (const s of nb.slots) clues[s.dir].push({ number: s.number, length: withLengths ? s.length : 0 });
  return { p, nb, clues };
};
const at = (r, c) => r * 15 + c;
const latticeGivens = { givenBlocks: [at(1, 5), at(3, 3), at(6, 5), at(0, 4)], givenNumbers: {} };

test('15x11 mirror symmetry: layouts from clue numbers alone include the true one, all mirror-symmetric', () => {
  const { nb, clues } = latticeClues(false);
  const givenNumbers = {};
  for (const k of [3, 11, 17, 24]) {
    const i = nb.numbers.map((n, idx) => (n ? idx : -1)).filter((x) => x >= 0)[k];
    givenNumbers[i] = nb.numbers[i];
  }
  const t = Date.now();
  const r = solveLayout({ rows: 11, cols: 15, clues, givenBlocks: latticeGivens.givenBlocks, givenNumbers, symmetry: 'mirror4', maxSolutions: 500 });
  const ms = Date.now() - t;
  console.log(`  15x11 numbers only: ${r.count} layouts, complete=${r.complete}, ${r.nodes} nodes, ${ms} ms`);
  assert.equal(r.complete, true);
  assert.ok(r.count >= 1 && r.count < 500);
  assert.ok(ms < 3000, `took ${ms} ms`);
  assert.ok(r.solutions.some((s) => Array.from(s).join('') === mask(LATTICE_ROWS)), 'the true layout is among them');
  for (const s of r.solutions) {
    for (let i = 0; i < 165; i++) for (const j of symmetryTargets(i, 11, 15, 'mirror4')) assert.equal(s[i], s[j]);
    // every solution reproduces exactly the clue numbers that were given
    const rows = Array.from({ length: 11 }, (_, rr) => Array.from(s.slice(rr * 15, rr * 15 + 15)).map((v) => (v ? '#' : '.')).join(''));
    const n2 = computeNumbering(fromPattern(rows));
    const key = (x) => `${x.number}${x.dir}`;
    assert.deepEqual(n2.slots.map(key).sort(), nb.slots.map(key).sort());
  }
});

test('15x11: knowing the letter counts settles the layout', () => {
  const { clues } = latticeClues(true);
  const r = solveLayout({ rows: 11, cols: 15, clues, givenBlocks: latticeGivens.givenBlocks, symmetry: 'mirror4', maxSolutions: 5 });
  assert.equal(r.unique, true);
  assert.equal(Array.from(r.solutions[0]).join(''), mask(LATTICE_ROWS));
});

test('15x11: a result cut short by maxSolutions is not marked complete', () => {
  const { clues } = latticeClues(false);
  const r = solveLayout({ rows: 11, cols: 15, clues, givenBlocks: latticeGivens.givenBlocks, symmetry: 'mirror4', maxSolutions: 1 });
  assert.equal(r.count, 1);
  assert.equal(r.truncated, true);
  assert.equal(r.complete, false);
  assert.equal(r.unique, false);
});

test('15x11: a wrong grid size or a missing clue number finds nothing', () => {
  const { clues } = latticeClues(true);
  // a mirror-symmetric layout is also half-turn symmetric, so that setting still finds it
  const rot = solveLayout({ rows: 11, cols: 15, clues, givenBlocks: latticeGivens.givenBlocks, symmetry: 'rotational', maxSolutions: 2 });
  assert.equal(rot.count, 1);
  // the same clues cannot fit a grid with one row fewer
  const short = solveLayout({ rows: 10, cols: 15, clues, symmetry: 'mirror4', maxSolutions: 2 });
  assert.equal(short.count, 0);
  assert.equal(short.complete, true);
  const missing = { across: clues.across.filter((c) => c.number !== 3), down: clues.down };
  assert.equal(solveLayout({ rows: 11, cols: 15, clues: missing, symmetry: 'mirror4' }).count, 0);
});

test('a rectangular grid solves without symmetry too', () => {
  const rows = ['...#.', '.....', '.#.#.'];
  const p = fromPattern(rows);
  const { nb } = { nb: computeNumbering(p) };
  const clues = { across: [], down: [] };
  for (const s of nb.slots) clues[s.dir].push({ number: s.number, length: s.length });
  const r = solveLayout({ rows: 3, cols: 5, clues, symmetry: 'none', maxSolutions: 10 });
  assert.ok(r.solutions.some((s) => Array.from(s).join('') === mask(rows)));
});
