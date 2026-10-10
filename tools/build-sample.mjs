// Builds samples/sample-15.json from the hidden layout and an invented clue bank.
// All clues are original. Crossing letters are NOT designed to agree: this sample
// exists to exercise the layout features (there is no answer key in the app).
import { writeFileSync } from 'node:fs';
import { fromPattern, computeNumbering, createPuzzle, makeClue, parseEnumeration } from '../js/model.js';
import { SAMPLE_ROWS } from '../tests/fixtures/sample-layout.js';

const bank = {
  2: [['Opposite of yes','2'],['Ocean-liner prefix','2'],['Cry of surprise','2'],['Greek letter','2'],['Doctor, briefly','2'],['Musical note','2']],
  3: [['Frozen water','3'],['Garden tool for weeding','3'],['Small bed for a baby','3'],['Frying vessel','3'],['Wise bird of the night','3'],['Distinctive shade','3'],['Boat paddle','3'],['Sheep\'s cry','3'],['Short sleep','3'],['Not wet','3'],['Naughty child, informally','3'],['Tea container with a tap','3'],['Fish trap','3'],['Mother, informally','3'],['Pull sharply','3'],['Nothing at all','3'],['Mischievous sprite','3'],['Lab rodent','3'],['Dined','3'],['Spider\'s trap','3']],
  4: [['Frozen rain','4'],['Tree\'s covering','4'],['Italian farewell','4'],['Large inland water','4'],['Bird\'s home','4'],['Support for a wheel','4'],['Hurry','4'],['Minor error','4'],['Narrow path','4'],['Look closely','4'],['Large feline','4'],['Wintry flakes','4'],['Cut of pork','4'],['Small whirlpool','4'],['Not fast','4'],['Dull pain','4'],['US ten-cent piece','4'],['Tall tale','4']],
  5: [['Large ocean mammal','5'],['Sharp-tasting fruit','5'],['Sweet spread from bees','5'],['Small stream','5'],['Place to sleep on a ship','5'],['Book of maps','5'],['Young plant growth','5'],['Gem from an oyster','5'],['Reef builder','5'],['Pale purple blossom','5'],['Cut of beef','5'],['Sofa, say','5']],
  6: [['Prickly desert plant','6'],['Citrus fruit','6'],['Shop with loaves','6'],['Spotted big cat of the Americas','6'],['Calm and peaceful','6'],['Summer stone fruit','6'],['Frozen palate cleanser','6'],['Deep red wine','6'],['Flower\'s sweet drink','6'],['Journey by sea','6']],
  7: [['Colourful arc after a shower','7'],['Pink stalks for a crumble','7']],
  9: [['Winter sport on a board','9']],
  10: [['Coat for wet weather','10'],['Walker on the pavement','10'],['Seafront rides and arcades','10'],['Stall at the seaside','5,5']],
  11: [['Climbing plant with fragrant flowers','11'],['Kindly and easy-going','4-7']],
  15: [['Digits to ring someone','9,6'],['Morning bowlful','9,6']],
};

const layout = fromPattern(SAMPLE_ROWS);
const nb = computeNumbering(layout);
const N = 15;
// symmetry check
for (let i = 0; i < N * N; i++) if (layout.cells[i].block !== layout.cells[N * N - 1 - i].block) throw new Error('layout not symmetric at ' + i);

const clues = { across: [], down: [] };
const used = {};
for (const s of nb.slots) {
  const list = bank[s.length];
  if (!list) throw new Error('no clue bank for length ' + s.length);
  const k = used[s.length] || 0;
  if (k >= list.length) throw new Error('bank exhausted for length ' + s.length);
  used[s.length] = k + 1;
  const [text, en] = list[k];
  if (parseEnumeration(en).length !== s.length) throw new Error('bad enumeration ' + en);
  clues[s.dir].push(makeClue(s.number, text, '(' + en.replace(/,/g, ',') + ')'.replace(')', ')')));
}
for (const d of ['across', 'down']) clues[d].sort((a, b) => a.number - b.number);
// enumerations stored without parentheses
for (const d of ['across', 'down']) for (const c of clues[d]) c.enumeration = c.enumeration.replace(/[()]/g, '');

const p = createPuzzle({ size: N, title: 'Sample: Garden Path (invented)', clues });
// givens: two blocks, three numbers, two letters
const blocks = layout.cells.map((c, i) => (c.block ? i : -1)).filter((i) => i >= 0);
p.cells[blocks[0]].givenBlock = true;
p.cells[blocks[0]].block = true;
const mid = blocks.filter((i) => i > 60 && i < 110)[0];
p.cells[mid].givenBlock = true;
p.cells[mid].block = true;
const numbered = nb.numbers.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
for (const k of [0, 22, 48]) p.cells[numbered[k]].givenNumber = nb.numbers[numbered[k]];
const whites = layout.cells.map((c, i) => (!c.block && !nb.numbers[i] ? i : -1)).filter((i) => i >= 0);
p.cells[whites[30]].givenLetter = 'E'; p.cells[whites[30]].letter = 'E';
p.cells[whites[100]].givenLetter = 'S'; p.cells[whites[100]].letter = 'S';
// blocks only given ones: the rest hidden
for (const c of p.cells) if (!c.givenBlock) c.block = false;
p.id = 'sample-15';
p.createdAt = 0; p.updatedAt = 0;
writeFileSync(new URL('../samples/sample-15.json', import.meta.url), JSON.stringify({ version: 1, ...p }, null, 1));
console.log('slots', nb.slots.length, 'across', clues.across.length, 'down', clues.down.length);
console.log('givens: blocks', blocks[0], mid, 'numbers', [0,22,48].map(k=>numbered[k]+':'+nb.numbers[numbered[k]]), 'letters', whites[30], whites[100]);
