import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClues } from '../js/clueParser.js';

const brief = (list) => list.map((c) => `${c.number}|${c.text}|${c.enumeration}|${c.length}`);

test('headings in any case and numbered clues', () => {
  const r = parseClues(`ACROSS
1 Large wading bird (5)
12. Friendly (4-7)
Down
2 Frozen water (3)
5) Tea container (3,4)`);
  assert.deepEqual(brief(r.across), ['1|Large wading bird|5|5', '12|Friendly|4-7|11']);
  assert.deepEqual(brief(r.down), ['2|Frozen water|3|3', '5|Tea container|3,4|7']);
});

test('heading on the same line as the first clue', () => {
  const r = parseClues('Across 1 First one (4)\n3 Second one (2,2)\nDOWN 2 Down one (6)');
  assert.equal(r.across.length, 2);
  assert.equal(r.down.length, 1);
  assert.equal(r.down[0].length, 6);
});

test('wrapped clue lines are joined', () => {
  const r = parseClues(`ACROSS
4 A very long clue that goes on and
on across several lines of the
newspaper column (3,4)
7 Short one (5)`);
  assert.equal(r.across.length, 2);
  assert.equal(r.across[0].text, 'A very long clue that goes on and on across several lines of the newspaper column');
  assert.equal(r.across[0].length, 7);
});

test('two columns merged into one line are split', () => {
  const r = parseClues(`ACROSS DOWN
1 Large wading bird (5) 2 Frozen water (3)
3 Shop with loaves (6) 4 Hurry (4)`);
  assert.deepEqual(brief(r.across), ['1|Large wading bird|5|5', '3|Shop with loaves|6|6']);
  assert.deepEqual(brief(r.down), ['2|Frozen water|3|3', '4|Hurry|4|4']);
});

test('OCR noise in numbers and enumerations', () => {
  const r = parseClues(`ACROSS
l Opening bit (l0)
I2 Another (4,S)
15 Missing bracket (7
DOWN
2 Fine (5)`);
  const a = Object.fromEntries(r.across.map((c) => [c.number, c]));
  assert.equal(a[1].length, 10);
  assert.equal(a[12].enumeration, '4,5');
  assert.equal(a[12].length, 9);
  assert.equal(a[15].length, 7);
});

test('warnings for duplicates, missing letter counts and gaps', () => {
  const r = parseClues('ACROSS\n1 One (3)\n1 Again (3)\n4 No count here\nDOWN\n2 Two (4)');
  const w = r.warnings.join(' | ');
  assert.match(w, /Duplicate across clue 1/);
  assert.match(w, /4 Across has no letter count/);
  assert.match(w, /missing from both lists: 3/);
});

test('no headings: switches to Down when numbers reset', () => {
  const r = parseClues('1 A (3)\n4 B (3)\n2 C (3)\n3 D (3)');
  assert.deepEqual(r.across.map((c) => c.number), [1, 4]);
  assert.deepEqual(r.down.map((c) => c.number), [2, 3]);
});
