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

// ---- numbers the player places: nothing is numbered for them

import { linkClues, numberAt } from '../js/model.js';

test('numberAt: printed number first, then the player\'s own, else 0', () => {
  assert.equal(numberAt({ givenNumber: 4, userNumber: 9 }), 4);
  assert.equal(numberAt({ givenNumber: null, userNumber: 9 }), 9);
  assert.equal(numberAt({}), 0);
});

test('linkClues: a clue is only linked once the player has numbered a square for it', () => {
  const p = fromPattern(['...#.', '.....', '.#.#.', '.....', '.#...']);
  p.clues.across.push(makeClue(1, 'first', ''), makeClue(5, 'second', ''), makeClue(6, 'third', ''));
  p.clues.down.push(makeClue(1, 'down one', ''));
  const nb = computeNumbering(p);

  // nothing numbered yet: nothing is linked, even though the layout has words starting everywhere
  let m = linkClues(p, nb);
  assert.deepEqual(m.across.map((e) => e.status), ['missing', 'missing', 'missing']);
  assert.ok(m.across.every((e) => e.slot === null && e.at === null));
  assert.equal(m.orphanSlots.length, nb.slots.length);

  // the player numbers the top-left square 1 and the left square of row 1 with 5
  p.cells[0].userNumber = 1;
  p.cells[5].userNumber = 5;
  m = linkClues(p, nb);
  assert.equal(m.across[0].status, 'ok');
  assert.equal(m.across[0].slot.cells[0], 0);
  assert.equal(m.across[0].slot.dir, 'across');
  assert.equal(m.down[0].status, 'ok'); // the same number also starts the down word
  assert.equal(m.down[0].slot.dir, 'down');
  assert.equal(m.across[1].status, 'ok');
  assert.equal(m.across[2].status, 'missing'); // 6 is still unplaced

  // a number in a square that does not start an across word
  p.cells[6].userNumber = 6; // row 1, second square: the word on that row starts one square to its left
  m = linkClues(p, nb);
  assert.equal(m.across[2].status, 'misplaced');
  assert.equal(m.across[2].slot, null);
  assert.equal(m.across[2].at, 6);
});

test('linkClues: a letter count that disagrees with the word is flagged, and a black square never carries a number', () => {
  const p = fromPattern(['...#.', '.....']);
  p.clues.across.push(makeClue(1, 'x', '5')); // the first word is 3 long
  p.cells[0].userNumber = 1;
  assert.equal(linkClues(p, computeNumbering(p)).across[0].status, 'length-mismatch');
  p.cells[3].userNumber = 2; // a black square
  const q = linkClues(p, computeNumbering(p));
  p.clues.across.push(makeClue(2, 'y', ''));
  assert.equal(linkClues(p, computeNumbering(p)).across[1].status, 'missing');
  assert.ok(q);
});
