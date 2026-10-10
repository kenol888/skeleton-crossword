// Artwork for the home screen, drawn as SVG so it follows the light and dark themes.
// The hero is a skull built from crossword squares. The thumbnails are tiny live pictures
// of saved puzzles. Only the two data constants are used by tests; the builders need a DOM.
import { computeNumbering, fromPattern } from './model.js';

/** 15 columns by 11 rows. '#' is a black square. Mirror-symmetric left to right. */
export const SKULL_ROWS = [
  '....#######....',
  '..###.....###..',
  '.##.........##.',
  '.#...........#.',
  '.#..###.###..#.',
  '.#..###.###..#.',
  '.##....#....##.',
  '..##.......##..',
  '...#.#.#.#.#...',
  '...#.#.#.#.#...',
  '....#######....',
];
/** Words typed across white squares of the skull, and the square the cursor waits in. */
export const SKULL_WORDS = [
  { row: 2, col: 3, text: 'SKELETON' },
  { row: 3, col: 3, text: 'CROSSWORD' },
];
export const SKULL_CURSOR = { row: 3, col: 12 };
/** The eye sockets glow like the scanner that reads a page. */
export const SKULL_EYES = [
  [4, 4], [4, 5], [4, 6], [5, 4], [5, 5], [5, 6],
  [4, 8], [4, 9], [4, 10], [5, 8], [5, 9], [5, 10],
];

const NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}, ...children) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

export function heroArt() {
  const S = 40;
  const R = SKULL_ROWS.length;
  const C = SKULL_ROWS[0].length;
  const numbers = computeNumbering(fromPattern(SKULL_ROWS)).numbers;
  const eyes = new Set(SKULL_EYES.map(([r, c]) => r * C + c));
  const svg = svgEl('svg', { viewBox: `0 0 ${C * S} ${R * S}`, class: 'art', role: 'img', 'aria-label': 'A skull drawn as a crossword grid' });
  svg.append(
    svgEl(
      'defs',
      {},
      svgEl(
        'pattern',
        { id: 'art-eye', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svgEl('rect', { width: 10, height: 10, class: 'eye-bg' }),
        svgEl('rect', { width: 5, height: 10, class: 'eye-stripe' })
      )
    )
  );
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      const black = SKULL_ROWS[r][c] === '#';
      svg.append(svgEl('rect', { x: c * S, y: r * S, width: S, height: S, class: black ? (eyes.has(i) ? 'b eye' : 'b') : 'c' }));
      if (!black && numbers[i]) svg.append(svgEl('text', { x: c * S + 4, y: r * S + 12, class: 'n' }, Object.assign(document.createTextNode(String(numbers[i])))));
    }
  }
  svg.append(svgEl('rect', { x: SKULL_CURSOR.col * S, y: SKULL_CURSOR.row * S, width: S, height: S, class: 'cursor' }));
  let k = 0;
  for (const w of SKULL_WORDS) {
    [...w.text].forEach((ch, j) => {
      svg.append(svgEl('text', { x: (w.col + j) * S + S / 2, y: w.row * S + S / 2 + 2, class: 'l', style: `--i:${k++}` }, document.createTextNode(ch)));
    });
  }
  return svg;
}

/**
 * A tiny picture of a puzzle. `cells` has one character per square, row by row:
 * '#' a black square, '+' a square with a letter, '.' an empty one.
 */
export function thumbSvg(rows, cols, cells) {
  const svg = svgEl('svg', { viewBox: `0 0 ${cols} ${rows}`, class: 'thumb', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  svg.append(svgEl('rect', { x: 0, y: 0, width: cols, height: rows, class: 't-bg' }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = cells[r * cols + c] || '.';
      svg.append(svgEl('rect', { x: c + 0.07, y: r + 0.07, width: 0.86, height: 0.86, class: ch === '#' ? 't-b' : ch === '+' ? 't-f' : 't-c' }));
    }
  }
  return svg;
}
