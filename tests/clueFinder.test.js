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
