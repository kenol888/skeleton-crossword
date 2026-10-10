import test from 'node:test';
import assert from 'node:assert/strict';
import { SKULL_ROWS, SKULL_WORDS, SKULL_CURSOR, SKULL_EYES } from '../js/homeArt.js';

test('the skull is a 15 x 11 grid, mirror-symmetric left to right', () => {
  assert.equal(SKULL_ROWS.length, 11);
  for (const row of SKULL_ROWS) {
    assert.equal(row.length, 15);
    assert.equal(row, [...row].reverse().join(''), `row ${row} reads the same backwards`);
  }
});

test('the typed words and the cursor sit on white squares, and the eyes are black', () => {
  for (const w of SKULL_WORDS) {
    for (let j = 0; j < w.text.length; j++) assert.equal(SKULL_ROWS[w.row][w.col + j], '.', `${w.text}[${j}] is on a white square`);
    // the word fills its run of white squares or leaves room beside it
    assert.ok(w.col + w.text.length <= 15);
  }
  assert.equal(SKULL_ROWS[SKULL_CURSOR.row][SKULL_CURSOR.col], '.');
  // the cursor waits right after the last word
  const last = SKULL_WORDS[SKULL_WORDS.length - 1];
  assert.equal(SKULL_CURSOR.row, last.row);
  assert.equal(SKULL_CURSOR.col, last.col + last.text.length);
  for (const [r, c] of SKULL_EYES) assert.equal(SKULL_ROWS[r][c], '#');
});
