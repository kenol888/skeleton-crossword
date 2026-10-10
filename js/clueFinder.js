// Finds where the Across and Down clue lists are on a page, from the positions of the words
// a text reader found. Pure: no DOM, so it can be tested in node.
//
// words: [{ text, x0, y0, x1, y1 }] in page pixels.
// grid:  { x0, y0, x1, y1 } the crossword grid, used to pick the headings nearest to it
//        (a newspaper page can hold several crosswords). May be null.
// page:  { w, h }

const isHeading = (w, name) => {
  const t = w.text.replace(/[^A-Za-z]/g, '');
  return t.length >= 3 && t === t.toUpperCase() && t.toUpperCase() === name;
};
const cy = (w) => (w.y0 + w.y1) / 2;
const height = (w) => w.y1 - w.y0;

function distToRect(w, r) {
  if (!r) return 0;
  const x = (w.x0 + w.x1) / 2;
  const y = cy(w);
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

/** Group words that sit on the same text line (centres within `tol`), top to bottom. */
function toLines(words, tol) {
  const lines = [];
  for (const w of words.slice().sort((p, q) => p.y0 - q.y0)) {
    const mid = cy(w);
    const line = lines.find((l) => Math.abs(l.cy - mid) <= tol);
    if (!line) lines.push({ cy: mid, y0: w.y0, y1: w.y1, x0: w.x0, x1: w.x1, h: height(w) });
    else {
      line.y0 = Math.min(line.y0, w.y0);
      line.y1 = Math.max(line.y1, w.y1);
      line.x0 = Math.min(line.x0, w.x0);
      line.x1 = Math.max(line.x1, w.x1);
      line.h = line.y1 - line.y0;
      line.cy = (line.y0 + line.y1) / 2;
    }
  }
  return lines.sort((p, q) => p.y0 - q.y0);
}

/**
 * Measure one clue list: from just under its heading down to where its text stops
 * (a gap bigger than a couple of text lines, or a much taller line such as a banner).
 */
export function measureSection(words, heading, xLo, xHi, yHi) {
  const inside = words.filter((w) => w !== heading && w.x0 >= xLo && w.x0 < xHi && w.y0 >= heading.y1 - 2 && w.y0 < yHi);
  if (!inside.length) return null;
  // a misread word can have a box several lines tall: judge line height by the typical word
  const hs = inside.map(height).sort((p, q) => p - q);
  const typical = hs[hs.length >> 1] || 10;
  const lines = toLines(inside.filter((w) => height(w) <= 2.2 * typical), 0.55 * typical);
  if (!lines.length) return null;
  let bottom = heading.y1;
  let right = 0;
  let count = 0;
  for (const l of lines) {
    if (l.y0 - bottom > Math.max(2.2 * typical, 18)) break;
    if (l.h > 1.8 * typical) break;
    bottom = Math.max(bottom, l.y1);
    right = Math.max(right, l.x1);
    count++;
  }
  if (!count) return null;
  return { x0: xLo, y0: heading.y1 + 1, x1: right, y1: bottom, lines: count };
}

/**
 * Returns { layout:'columns'|'stacked', across:{x0,y0,x1,y1}, down:{...} } or null.
 * The boxes hold the clue text only (the headings are left out).
 */
export function locateClues(words, grid, page) {
  const acrossHeads = words.filter((w) => isHeading(w, 'ACROSS'));
  const downHeads = words.filter((w) => isHeading(w, 'DOWN'));
  let best = null;
  for (const a of acrossHeads) {
    for (const d of downHeads) {
      const h = Math.max(height(a), height(d));
      const side = Math.abs(cy(a) - cy(d)) <= 0.8 * h && d.x0 > a.x1;
      const stacked = !side && d.y0 > a.y1 && Math.abs(a.x0 - d.x0) <= 2 * h && d.y0 - a.y1 < page.h * 0.7;
      if (!side && !stacked) continue;
      const score = distToRect(a, grid) + distToRect(d, grid);
      if (!best || score < best.score) best = { a, d, layout: side ? 'columns' : 'stacked', score };
    }
  }
  if (!best) return null;
  const { a, d } = best;
  let across;
  let down;
  if (best.layout === 'columns') {
    const colW = d.x0 - a.x0;
    across = measureSection(words, a, a.x0 - 8, d.x0 - 8, Infinity);
    down = measureSection(words, d, d.x0 - 8, Math.min(page.w, d.x0 + 1.3 * colW), Infinity);
  } else {
    const colW = Math.max(300, grid ? grid.x1 - grid.x0 : 300);
    across = measureSection(words, a, a.x0 - 8, Math.min(page.w, a.x0 + colW), d.y0 - 2);
    down = measureSection(words, d, d.x0 - 8, Math.min(page.w, d.x0 + colW), Infinity);
  }
  if (!across || !down) return null;
  const pad = 3;
  const grow = (b) => ({ x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(page.w, b.x1 + pad), y1: Math.min(page.h, b.y1 + pad), lines: b.lines });
  return { layout: best.layout, across: grow(across), down: grow(down) };
}
