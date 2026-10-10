// Builds samples/sample-skeleton.json: an invented 15 x 11 skeleton in the Sunday Express
// format. Mirror-symmetric black squares, four printed black squares, four printed clue
// numbers and no letter counts. All clues are original. Crossing letters are not designed
// to agree: the sample exists to try the features (there is no answer key in the app).
import { writeFileSync } from 'node:fs';
import { fromPattern, computeNumbering, createPuzzle, makeClue, symmetryTargets } from '../js/model.js';
import { solveLayout, optionsFromPuzzle } from '../js/solver.js';
import { LATTICE_ROWS } from '../tests/fixtures/lattice-15x11.js';

const ACROSS = {
  1: 'Frozen rain falling in a shower', 3: 'Sharp-tasting fruit in a pie', 6: 'Large ocean mammal', 11: 'Place to sleep on a ship',
  12: 'Garden tool for weeding', 13: 'Climbing plant with fragrant flowers', 14: 'Sweet spread from bees', 15: 'Book of maps',
  16: 'Colourful arc after a shower', 17: 'Reef builder', 19: 'Pale purple blossom', 22: 'Pink stalks for a crumble',
  23: 'Frozen palate cleanser', 24: 'Prickly desert plant', 25: 'Wise bird of the night', 26: 'Spotted big cat', 27: 'Shop with loaves',
};
const DOWN = {
  1: 'Tree’s covering', 2: 'Italian farewell', 4: 'Coat for wet weather, say', 5: 'Walker on the pavement', 7: 'Large inland water',
  8: 'Bird’s home', 9: 'Seafront rides and arcades', 10: 'Calm and peaceful', 17: 'Small stream', 18: 'Gem from an oyster',
  20: 'Summer stone fruit', 21: 'Deep red wine',
};

const layout = fromPattern(LATTICE_ROWS);
const R = layout.rows;
const C = layout.cols;
const nb = computeNumbering(layout);

// the mirror symmetry the puzzle promises
for (let i = 0; i < R * C; i++) for (const j of symmetryTargets(i, R, C, 'mirror4')) if (layout.cells[i].block !== layout.cells[j].block) throw new Error('layout not mirror-symmetric at ' + i);

const clues = { across: [], down: [] };
for (const s of nb.slots) {
  const text = (s.dir === 'across' ? ACROSS : DOWN)[s.number];
  if (!text) throw new Error(`no clue written for ${s.number} ${s.dir}`);
  clues[s.dir].push(makeClue(s.number, text, ''));
}
const want = new Set(nb.slots.map((s) => s.dir + s.number));
for (const [dir, bank] of [['across', ACROSS], ['down', DOWN]]) for (const n of Object.keys(bank)) if (!want.has(dir + n)) throw new Error(`clue ${n} ${dir} has no word in the layout`);

const p = createPuzzle({ rows: R, cols: C, title: 'Sample: Lattice (invented)', clues, settings: { symmetry: 'mirror4' } });

// four printed black squares from four different mirror groups, four printed numbers
const blocks = layout.cells.map((c, i) => (c.block ? i : -1)).filter((i) => i >= 0);
const seen = new Set();
const givenBlocks = [];
for (const i of blocks) {
  const key = Math.min(i, ...symmetryTargets(i, R, C, 'mirror4'));
  if (!seen.has(key) && i % 2 === 1 && givenBlocks.length < 4) { seen.add(key); givenBlocks.push(i); }
}
for (const i of givenBlocks) { p.cells[i].givenBlock = true; p.cells[i].block = true; }
const numbered = nb.numbers.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
for (const k of [3, 11, 17, 24]) p.cells[numbered[k]].givenNumber = nb.numbers[numbered[k]];
p.id = 'sample-skeleton';
p.createdAt = 0;
p.updatedAt = 0;

const res = solveLayout(optionsFromPuzzle(p, { maxSolutions: 500 }));
const truth = layout.cells.map((c) => (c.block ? 1 : 0)).join('');
const found = res.solutions.some((s) => Array.from(s).join('') === truth);
console.log(`layouts that fit the sample's clues: ${res.count}${res.complete ? '' : '+'}, includes the intended one: ${found}`);
if (!found) throw new Error('the intended layout is not among the solutions');

writeFileSync(new URL('../samples/sample-skeleton.json', import.meta.url), JSON.stringify({ version: 2, ...p }, null, 1));
console.log('wrote samples/sample-skeleton.json; printed blocks at', givenBlocks.join(','));
