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

test('clues with no letter counts at all (as printed in the Sunday Express skeleton)', () => {
  const r = parseClues(`ACROSS
1 A student a lout brains
3 Sap wanting a dated jet
6 Ace book well rid of covers
- The Third Man?
11 Cheerful around cooler
DOWN
1 Clear clue contents cops
2 Article by northern bird`);
  assert.deepEqual(r.across.map((c) => c.number), [1, 3, 6, 11]);
  assert.deepEqual(r.down.map((c) => c.number), [1, 2]);
  assert.equal(r.across[0].text, 'A student a lout brains');
  assert.equal(r.across[2].text, 'Ace book well rid of covers - The Third Man?');
  assert.equal(r.across[0].length, 0);
  // no letter counts anywhere is normal, so it is not warned about per clue
  assert.ok(!r.warnings.some((w) => /letter count/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some((w) => /missing from both lists: 4, 5, 7, 8, 9, 10/.test(w)), r.warnings.join('|'));
});

test('letter counts the text reader damaged: a lost opening bracket and a lost comma', () => {
  const r = parseClues(`Clues across
10. Rat will give a wide berth to Polynesian dance costume 5,5)
16. Grandma, I overturned on the busiest street in town! 4,4)
8. Kill nearly all the poultry, they say - an awful act (6,4,4)
Clues down
9. Information centre not in a good state - on a lean. Who to write to? (74)
11. Plain one (6)`);
  const a = Object.fromEntries(r.across.map((c) => [c.number, c]));
  assert.equal(a[10].enumeration, '5,5');
  assert.equal(a[10].length, 10);
  assert.equal(a[10].text, 'Rat will give a wide berth to Polynesian dance costume');
  assert.equal(a[16].enumeration, '4,4');
  assert.equal(a[8].enumeration, '6,4,4');
  assert.equal(r.down.find((c) => c.number === 9).enumeration, '7,4');
  assert.equal(r.down.find((c) => c.number === 9).length, 11);
  assert.equal(r.down.find((c) => c.number === 11).length, 6);
  // sensible long words are left alone
  assert.equal(parseClues('ACROSS\n1 Something long (15)').across[0].length, 15);
});

test('standard crossword clues: "Clues across" headings, wrapped lines and a list that continues in the next column', () => {
  const r = parseClues(`Clues across
1. To deem abnormal is to
downgrade (6)
4. Prediction that in a month,
street will be taken out and
railway put in (6)
23. Made careless error:
cancelled prom (7,3,4)
Clues down
1. Renders me tired, making
points I don't appreciate (7)
2. These can follow on your
instruction to take off
blemishes (5)`);
  assert.deepEqual(r.across.map((c) => [c.number, c.length]), [[1, 6], [4, 6], [23, 14]]);
  assert.deepEqual(r.down.map((c) => [c.number, c.length]), [[1, 7], [2, 5]]);
  assert.equal(r.across[1].text, 'Prediction that in a month, street will be taken out and railway put in');
});
