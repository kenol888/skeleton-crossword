import test from 'node:test';
import assert from 'node:assert/strict';
import { locateClues } from '../js/clueFinder.js';

// Build words for a text line: one word per piece, spaced across x.
function line(texts, x, y, h = 12, gap = 6) {
  const out = [];
  let cx = x;
  for (const t of texts) {
    const w = t.length * 6.5;
    out.push({ text: t, x0: cx, y0: y, x1: cx + w, y1: y + h });
    cx += w + gap;
  }
  return out;
}
// A column of clue lines starting at y, spaced `step` apart.
function column(x, y, n, step = 15) {
  const words = [];
  for (let i = 0; i < n; i++) words.push(...line([String(i + 1), 'Some', 'clue', 'words'], x, y + i * step));
  return words;
}

const page = { w: 1300, h: 900 };
const grid = { x0: 400, y0: 170, x1: 900, y1: 500 };

function skeletonPage() {
  const words = [];
  words.push(...line(['THE', 'SKELETON', 'CROSSWORD'], 400, 60, 22)); // title banner
  words.push(...line(['ACROSS'], 930, 90, 16));
  words.push(...line(['DOWN'], 1110, 90, 16));
  words.push(...column(930, 110, 25)); // across clues, ends near y=485
  words.push(...column(1110, 110, 19)); // down clues, ends near y=380
  words.push(...line(['MYSTERY', 'WORD', '-', 'WIN', '£50'], 930, 540, 24)); // banner below
  // another crossword lower down with its own headings (should be ignored)
  words.push(...line(['ACROSS'], 580, 780, 16));
  words.push(...line(['DOWN'], 744, 782, 16));
  words.push(...column(580, 800, 3));
  words.push(...column(744, 800, 3));
  // a sentence that mentions across and down in normal case
  words.push(...line(['Across,', 'Down.'], 940, 700, 12));
  return words;
}

test('finds the clue columns next to the grid and measures where each list ends', () => {
  const loc = locateClues(skeletonPage(), grid, page);
  assert.ok(loc);
  assert.equal(loc.layout, 'columns');
  // Across: 25 lines from y=110; stops before the banner at y=540
  assert.ok(Math.abs(loc.across.y1 - (110 + 24 * 15 + 12)) <= 8, JSON.stringify(loc.across));
  assert.ok(loc.across.y0 >= 104 && loc.across.y0 <= 112);
  assert.ok(loc.across.x0 <= 930 && loc.across.x0 >= 915);
  // Down: 19 lines; ends well above the across list
  assert.ok(Math.abs(loc.down.y1 - (110 + 18 * 15 + 12)) <= 8, JSON.stringify(loc.down));
  assert.ok(loc.down.x0 <= 1110 && loc.down.x0 >= 1095);
  // the two columns do not overlap
  assert.ok(loc.across.x1 <= loc.down.x0 + 4);
});

test('picks the headings nearest the grid, not the other crossword on the page', () => {
  const loc = locateClues(skeletonPage(), grid, page);
  assert.ok(loc.across.y0 < 200, 'across list is the one at the top');
  const other = locateClues(skeletonPage(), { x0: 570, y0: 840, x1: 800, y1: 900 }, page);
  assert.ok(other.across.y0 > 700, 'with the grid down there, the lower headings are chosen');
});

test('stacked lists: ACROSS above DOWN in one column', () => {
  const words = [];
  words.push(...line(['ACROSS'], 950, 100, 16));
  words.push(...column(950, 122, 8)); // ends at ~y=227
  words.push(...line(['DOWN'], 950, 260, 16));
  words.push(...column(950, 282, 6));
  const loc = locateClues(words, { x0: 100, y0: 100, x1: 900, y1: 600 }, page);
  assert.equal(loc.layout, 'stacked');
  assert.ok(loc.across.y1 < 260, JSON.stringify(loc.across));
  assert.ok(loc.down.y0 > 270, JSON.stringify(loc.down));
});

test('returns null when there are no headings', () => {
  assert.equal(locateClues(column(900, 100, 10), grid, page), null);
});

// ---- messy word boxes: the same text read on a different device can have oddly sized boxes

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// A column of `n` clue lines whose boxes are unreliable: some words are much taller than the
// text, positions jitter a few pixels, and the whole column slants by `slope` px per px.
function messyColumn(x, y, n, rnd, { slope = 0.03, step = 18 } = {}) {
  const words = [];
  for (let i = 0; i < n; i++) {
    let cx = x;
    for (const t of [String(i + 1), 'Some', 'clue', 'words', 'here']) {
      const w = t.length * 6.5;
      const base = y + i * step + (cx - x) * slope;
      let y0 = base + (rnd() - 0.5) * 4;
      let h = 11 + rnd() * 2;
      if (rnd() < 0.18) h = 20 + rnd() * 14; // an oversize box, as some readers produce
      if (rnd() < 0.18) y0 -= h - 11; // box reaching above the line instead of below
      words.push({ text: t, x0: cx, y0, x1: cx + w, y1: y0 + h });
      cx += w + 6;
    }
  }
  return words;
}

test('oversize, jittered and slanted word boxes do not cut a clue list short', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rnd = seeded(seed);
    const words = [];
    words.push(...line(['ACROSS'], 930, 90, 16));
    words.push(...line(['DOWN'], 1110, 90, 16));
    words.push(...messyColumn(930, 112, 25, rnd)); // across: 25 lines
    words.push(...messyColumn(1110, 112, 19, rnd)); // down: 19 lines
    words.push(...line(['MYSTERY', 'WORD', '-', 'WIN', '£50'], 930, 600, 24));
    const loc = locateClues(words, grid, page);
    assert.ok(loc, `seed ${seed}: found`);
    const acrossBottom = 112 + 24 * 18; // last across line
    const downBottom = 112 + 18 * 18;
    assert.ok(loc.across.y1 >= acrossBottom + 8, `seed ${seed}: across list ends at ${Math.round(loc.across.y1)}, should reach past ${acrossBottom}`);
    assert.ok(loc.across.y1 <= 600 - 12, `seed ${seed}: across list stops before the banner (${Math.round(loc.across.y1)})`);
    assert.ok(loc.down.y1 >= downBottom + 8, `seed ${seed}: down list ends at ${Math.round(loc.down.y1)}, should reach past ${downBottom}`);
    assert.ok(loc.down.y1 < acrossBottom, `seed ${seed}: down list is the shorter one`);
  }
});

test('a paragraph gap inside a list does not end it, but a banner gap does', () => {
  const words = [];
  words.push(...line(['ACROSS'], 930, 90, 16));
  words.push(...line(['DOWN'], 1110, 90, 16));
  // clue lines 18px apart, with one slightly bigger gap (a 24px step) in the middle
  for (let i = 0; i < 20; i++) words.push(...line([String(i + 1), 'Some', 'clue'], 930, 112 + i * 18 + (i >= 10 ? 6 : 0)));
  words.push(...column(1110, 112, 5, 18));
  words.push(...line(['MYSTERY', 'WORD'], 930, 560, 24));
  const loc = locateClues(words, grid, page);
  assert.ok(loc.across.y1 > 112 + 19 * 18 + 6, `ran to the last clue (${Math.round(loc.across.y1)})`);
  assert.ok(loc.across.y1 < 560, 'but stopped before the banner');
});

// ---- standard crosswords: clue lists flow down one column and into the next

import { splitColumns, locateStandardClues } from '../js/clueFinder.js';

function standardPage() {
  const words = [];
  const pageGrid = { x0: 27, y0: 85, x1: 735, y1: 790 };
  // left column: a heading, 24 clue lines (some ending in a letter count), the last ending (10)
  words.push(...line(['Clues', 'across'], 28, 815, 18));
  for (let i = 0; i < 24; i++) {
    const last = i === 23;
    const ends = last ? '(10)' : i % 3 === 2 ? '(6)' : 'word';
    words.push(...line([String(i + 1) + '.', 'Some', 'clue', 'text', ends], 28, 845 + i * 26, 14));
  }
  // under it, after a gap: a banner and a solution grid of single letters (must be left out)
  words.push(...line(['Solution', 'No', '1505'], 28, 845 + 23 * 26 + 62, 20));
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) words.push({ text: 'ABCDEFGHIJKL'[c], x0: 30 + c * 22, y0: 1700 + r * 24, x1: 44 + c * 22, y1: 1714 + r * 24 });
  // right column: three across clues, the Down heading, then down clues
  words.push(...line(['23.', 'Made', 'careless', 'error', '(7,3,4)'], 400, 815, 14));
  words.push(...line(['24.', 'Tsunamis', 'happening', 'in', '(6)'], 400, 841, 14));
  words.push(...line(['25.', 'Aspirations', 'to', 'remove', '(2,2,2)'], 400, 867, 14));
  words.push(...line(['Clues', 'down'], 400, 925, 18));
  for (let i = 0; i < 30; i++) words.push(...line([String(i + 1) + '.', 'Down', 'clue', 'text', i % 2 ? '(5)' : 'here'], 400, 955 + i * 26, 14));
  return { words, grid: pageGrid };
}

test('standard layout: the text below the grid splits into two columns', () => {
  const { words, grid } = standardPage();
  const below = words.filter((w) => w.y0 >= grid.y1);
  const cols = splitColumns(below);
  assert.equal(cols.length, 2);
  assert.ok(cols[0].x1 < 400 && cols[1].x0 >= 395);
});

test('standard layout: columns end at the last clue, leaving out the solution grid under it', () => {
  const { words, grid } = standardPage();
  const loc = locateStandardClues(words, grid, { w: 765, h: 2000 });
  assert.ok(loc);
  assert.equal(loc.columns.length, 2, 'two columns, left to right');
  const [left, right] = loc.columns;
  assert.ok(left.x1 < right.x0, 'the columns do not overlap');
  const lastClueY = 845 + 23 * 26;
  assert.ok(left.y1 >= lastClueY + 8, `left column reaches its last clue (${Math.round(left.y1)})`);
  assert.ok(left.y1 < 845 + 23 * 26 + 55, `but not into the solution banner or grid (${Math.round(left.y1)})`);
  // the right column: its last clue line ends with (5) at i = 29 (odd), at y = 955 + 29 * 26
  assert.ok(right.y1 >= 955 + 29 * 26 + 8, `right column reaches its last clue (${Math.round(right.y1)})`);
  assert.ok(left.y0 <= 820 && right.y0 <= 820, 'both start at the top of the clue area');
});

test('standard layout: clues beside the grid are found when there is little text below it', () => {
  const words = [];
  const grid = { x0: 20, y0: 50, x1: 520, y1: 550 };
  for (let i = 0; i < 20; i++) words.push(...line([String(i + 1) + '.', 'Clue', 'text', 'here', '(5)'], 560, 60 + i * 24, 14));
  const loc = locateStandardClues(words, grid, { w: 800, h: 700 });
  assert.ok(loc);
  assert.equal(loc.columns.length, 1);
  assert.ok(loc.columns[0].x0 >= 540);
});

test('standard layout: messy word boxes do not cut a column short', () => {
  for (const seed of [11, 12, 13, 14]) {
    const rnd = seeded(seed);
    const words = [];
    words.push(...messyColumn(28, 830, 30, rnd, { slope: 0.02, step: 24 }));
    words.push(...messyColumn(420, 830, 30, rnd, { slope: 0.02, step: 24 }));
    // make every line end with a count so trailing trimming has something to find
    const loc = locateStandardClues(words.map((w, i) => (w.text === 'here' ? { ...w, text: '(5)' } : w)), { x0: 0, y0: 0, x1: 765, y1: 800 }, { w: 765, h: 1700 });
    assert.ok(loc, `seed ${seed}`);
    assert.equal(loc.columns.length, 2, `seed ${seed}: columns`);
    for (const c of loc.columns) assert.ok(c.y1 >= 830 + 29 * 24 + 8, `seed ${seed}: column reaches the end (${Math.round(c.y1)})`);
  }
});

test('standard layout: nothing to find without enough text', () => {
  assert.equal(locateStandardClues(column(900, 100, 2), { x0: 0, y0: 0, x1: 500, y1: 50 }, { w: 1300, h: 900 }), null);
});
