import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromJSON, fromPattern, computeNumbering } from '../js/model.js';
import { solveLayout, optionsFromPuzzle } from '../js/solver.js';
import { SAMPLE_ROWS } from './fixtures/sample-layout.js';

const sample = () => fromJSON(readFileSync(new URL('../samples/sample-15.json', import.meta.url), 'utf8'));
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
