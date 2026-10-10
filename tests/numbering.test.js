import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPattern, computeNumbering, matchClues, makeClue, mirror, toJSON, fromJSON, parseEnumeration, progress } from '../js/model.js';

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
  assert.equal(mirror(0, 15), 224);
  assert.equal(mirror(112, 15), 112);
  assert.deepEqual(parseEnumeration('4-7'), { length: 11, parts: [4, 7] });
  assert.equal(parseEnumeration('(3,4)').length, 7);
  const p = fromPattern(['..', '.#']);
  p.cells[0].letter = 'A';
  assert.equal(progress(p), 1 / 3);
  p.clues.across.push(makeClue(1, 'x', '2'));
  const q = fromJSON(toJSON(p));
  assert.equal(q.size, 2);
  assert.equal(q.cells[0].letter, 'A');
  assert.equal(q.clues.across[0].length, 2);
  assert.throws(() => fromJSON('{"nope":1}'));
});
