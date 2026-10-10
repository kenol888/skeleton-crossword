import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPattern, computeNumbering, matchClues, makeClue, symmetryTargets, toJSON, fromJSON, parseEnumeration, progress } from '../js/model.js';

const desc = (nb) => nb.slots.map((s) => `${s.number}${s.dir === 'across' ? 'a' : 'd'}${s.length}`);

test('3x3 with a centre block', () => {
  const nb = computeNumbering(fromPattern(['...', '.#.', '...']));
  assert.deepEqual(nb.numbers, [1, 0, 2, 0, 0, 0, 3, 0, 0]);
  assert.deepEqual(desc(nb), ['1a3', '1d3', '2d3', '3a3']);
});

test('5x5 known grid: numbers and slot lengths', () => {
  const p = fromPattern(['...#.', '.....', '.#.#.', '.....', '.#...']);
  const nb = computeNumbering(p);
  assert.deepEqual(nb.numbers, [
    1, 2, 3, 0, 4,
    5, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    6, 0, 0, 7, 0,
    0, 0, 8, 0, 0,
  ]);
  assert.deepEqual(desc(nb).sort(), ['1a3', '1d5', '2d2', '3d5', '4d5', '5a5', '6a5', '7d2', '8a3'].sort());
  for (const s of nb.slots) {
    assert.ok(s.length >= 2);
    for (const i of s.cells) assert.equal(p.cells[i].block, false);
  }
});

test('an empty grid numbers every row and column', () => {
  const nb = computeNumbering(fromPattern(['....', '....', '....', '....']));
  assert.equal(nb.slots.length, 8);
  assert.equal(Math.max(...nb.numbers), 7);
});

test('matchClues reports ok, length mismatch, missing and orphans', () => {
  const p = fromPattern(['...', '.#.', '...']);
  p.clues.across.push(makeClue(1, 'ok', '3'), makeClue(3, 'wrong length', '4'), makeClue(9, 'nowhere', '3'));
  p.clues.down.push(makeClue(1, 'ok', '3'));
  const nb = computeNumbering(p);
  const m = matchClues(p, nb);
  assert.deepEqual(m.across.map((x) => x.status), ['ok', 'length-mismatch', 'missing']);
  assert.deepEqual(m.down.map((x) => x.status), ['ok']);
  assert.deepEqual(m.orphanSlots.map((s) => `${s.number}${s.dir[0]}`), ['2d']);
});

test('mirror, enumeration, progress and JSON round trip', () => {
  assert.deepEqual(symmetryTargets(0, 15, 15, 'rotational'), [224]);
  assert.deepEqual(symmetryTargets(112, 15, 15, 'rotational'), []);
  assert.deepEqual(parseEnumeration('4-7'), { length: 11, parts: [4, 7] });
  assert.equal(parseEnumeration('(3,4)').length, 7);
  const p = fromPattern(['..', '.#']);
  p.cells[0].letter = 'A';
  assert.equal(progress(p), 1 / 3);
  p.clues.across.push(makeClue(1, 'x', '2'));
  const q = fromJSON(toJSON(p));
  assert.equal(q.rows, 2);
  assert.equal(q.cols, 2);
  assert.equal(q.cells[0].letter, 'A');
  assert.equal(q.clues.across[0].length, 2);
  assert.throws(() => fromJSON('{"nope":1}'));
});

test('mirror symmetry on a 15 x 11 grid: four copies, fewer on the axes', () => {
  // rows 11, cols 15: top/bottom and left/right reflections
  const at = (r, c) => r * 15 + c;
  assert.deepEqual(symmetryTargets(at(1, 5), 11, 15, 'mirror4').sort((a, b) => a - b), [at(1, 9), at(9, 5), at(9, 9)].sort((a, b) => a - b));
  assert.deepEqual(symmetryTargets(at(5, 3), 11, 15, 'mirror4').sort((a, b) => a - b), [at(5, 11)]); // on the middle row
  assert.deepEqual(symmetryTargets(at(2, 7), 11, 15, 'mirror4'), [at(8, 7)]); // on the middle column
  assert.deepEqual(symmetryTargets(at(5, 7), 11, 15, 'mirror4'), []); // the centre square
  assert.deepEqual(symmetryTargets(at(1, 5), 11, 15, 'none'), []);
});

test('numbering a rectangular grid (3 rows x 4 columns)', () => {
  const nb = computeNumbering(fromPattern(['....', '.#..', '....']));
  assert.deepEqual(nb.numbers, [1, 0, 2, 3, 0, 0, 4, 0, 5, 0, 0, 0]);
  assert.deepEqual(desc(nb), ['1a4', '1d3', '2d3', '3d3', '4a2', '5a4']);
});

test('old square puzzles (version 1 files) load with rotational symmetry', () => {
  const q = fromJSON({ version: 1, size: 2, title: 'Old', cells: Array.from({ length: 4 }, () => ({})), clues: { across: [], down: [] } });
  assert.deepEqual([q.rows, q.cols], [2, 2]);
  assert.equal(q.settings.symmetry, 'rotational');
});
