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

const median = (arr) => {
  const a = arr.slice().sort((p, q) => p - q);
  return a.length ? a[a.length >> 1] : 0;
};

/**
 * Measure one clue list: from just under its heading down to where its text stops.
 *
 * It uses only the vertical centres of the words, never their box heights. The text reader's
 * boxes differ between browsers and devices (some are several lines tall, or a few pixels off),
 * and judging by height made the list end too early. Text lines are found by clustering word
 * centres; the list ends where the gap to the next line is much more than the usual line pitch.
 * `gapFactor` is how many line pitches of empty space end the list.
 */
export function measureSection(words, heading, xLo, xHi, yHi, gapFactor = 1.9) {
  const inside = words
    .filter((w) => w !== heading && w.x0 >= xLo && w.x0 < xHi && w.y0 >= heading.y1 - 2 && w.y0 < yHi)
    .sort((p, q) => cy(p) - cy(q));
  if (!inside.length) return null;
  // typical text size: the middle value is not thrown off by a few oversize boxes
  const typical = median(inside.slice(0, 40).map(height)) || 10;
  const tol = 0.6 * typical;

  // cluster word centres into lines
  const lines = [];
  for (const w of inside) {
    const mid = cy(w);
    const line = lines.find((l) => Math.abs(l.cy - mid) <= tol);
    if (!line) lines.push({ cy: mid, sum: mid, n: 1, words: [w] });
    else {
      line.sum += mid;
      line.n++;
      line.cy = line.sum / line.n;
      line.words.push(w);
    }
  }
  lines.sort((p, q) => p.cy - q.cy);

  // usual distance between lines: ignore tiny steps, which come from slanted text splitting a line
  const steps = [];
  for (let i = 1; i < Math.min(lines.length, 16); i++) {
    const d = lines[i].cy - lines[i - 1].cy;
    if (d > 0.8 * typical) steps.push(d);
  }
  const pitch = median(steps) || 1.6 * typical;
  const maxGap = Math.max(gapFactor * pitch, 2 * typical);

  let last = lines[0];
  let count = 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].cy - last.cy > maxGap) break;
    last = lines[i];
    count++;
  }
  const accepted = lines.slice(0, count);
  const right = Math.max(...accepted.flatMap((l) => l.words.map((w) => w.x1)));
  return { x0: xLo, y0: heading.y1 + 1, x1: right, y1: last.cy + 0.7 * typical, lines: count };
}

/**
 * Returns { layout:'columns'|'stacked', across:{x0,y0,x1,y1}, down:{...} } or null.
 * The boxes hold the clue text only (the headings are left out).
 */
export function locateClues(words, grid, page, { gapFactor = 1.9 } = {}) {
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
    across = measureSection(words, a, a.x0 - 8, d.x0 - 8, Infinity, gapFactor);
    down = measureSection(words, d, d.x0 - 8, Math.min(page.w, d.x0 + 1.3 * colW), Infinity, gapFactor);
  } else {
    const colW = Math.max(300, grid ? grid.x1 - grid.x0 : 300);
    across = measureSection(words, a, a.x0 - 8, Math.min(page.w, a.x0 + colW), d.y0 - 2, gapFactor);
    down = measureSection(words, d, d.x0 - 8, Math.min(page.w, d.x0 + colW), Infinity, gapFactor);
  }
  if (!across || !down) return null;
  const pad = 3;
  const grow = (b) => ({ x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(page.w, b.x1 + pad), y1: Math.min(page.h, b.y1 + pad), lines: b.lines });
  return { layout: best.layout, across: grow(across), down: grow(down) };
}

// ---------------------------------------------------------------------------------------------
// Standard crosswords: the clues are printed in columns below (or beside) the grid. The Across
// list usually runs down one column and on into the next, and the Down list follows it, so the
// lists are not found by their headings. Instead the text is cut into columns, each column is
// measured, and the columns are read left to right as one stream; the parser sorts that stream
// into Across and Down using the headings and the numbering.

/** Cut words into text columns at the empty vertical gaps between them, left to right. */
export function splitColumns(words, minWords = 12) {
  if (!words.length) return [];
  const typical = median(words.map(height)) || 10;
  const gap = Math.max(10, 1.1 * typical);
  const sorted = words.slice().sort((p, q) => p.x0 - q.x0);
  const groups = [];
  let cur = { x0: sorted[0].x0, x1: sorted[0].x1, words: [sorted[0]] };
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.x0 - cur.x1 > gap) {
      groups.push(cur);
      cur = { x0: w.x0, x1: w.x1, words: [w] };
    } else {
      cur.x1 = Math.max(cur.x1, w.x1);
      cur.words.push(w);
    }
  }
  groups.push(cur);
  return groups.filter((g) => g.words.length >= minWords);
}

/** A line of text that finishes a clue ends with its letter count, such as (6) or (5,5). */
const endsWithCount = (text) => /\(\s*\d[\d,\-\s]*\)?\s*$/.test(text.trim()) || /\d\)\s*$/.test(text.trim());

/**
 * Measure one text column: from its first line down to where the clues stop. Like the skeleton
 * lists it uses only word centres, never box heights; it also drops trailing lines that do not
 * finish a clue (a solution grid or an advert under the clues), since every clue ends with a count.
 */
export function measureColumn(col, gapFactor = 1.9) {
  const ws = col.words.slice().sort((p, q) => cy(p) - cy(q));
  const typical = median(ws.slice(0, 40).map(height)) || 10;
  const tol = 0.6 * typical;
  // Lines come from normally sized words only: an oversize box has an off-centre middle and would
  // make a false line between two real ones. Oversize words are attached to the nearest line after.
  const normal = ws.filter((w) => height(w) <= 1.7 * typical);
  const odd = ws.filter((w) => height(w) > 1.7 * typical);
  const lines = [];
  for (const w of normal) {
    const mid = cy(w);
    const line = lines.find((l) => Math.abs(l.cy - mid) <= tol);
    if (!line) lines.push({ cy: mid, sum: mid, n: 1, words: [w] });
    else {
      line.sum += mid;
      line.n++;
      line.cy = line.sum / line.n;
      line.words.push(w);
    }
  }
  lines.sort((p, q) => p.cy - q.cy);
  if (!lines.length) return { x0: col.x0 - 4, y0: col.words[0].y0, x1: col.x1 + 4, y1: col.words[0].y1, lines: 0 };
  const steps = [];
  for (let i = 1; i < Math.min(lines.length, 16); i++) {
    const d = lines[i].cy - lines[i - 1].cy;
    if (d > 0.8 * typical) steps.push(d);
  }
  const pitch = median(steps) || 1.6 * typical;
  for (const w of odd) {
    let best = null;
    for (const l of lines) if (!best || Math.abs(l.cy - cy(w)) < Math.abs(best.cy - cy(w))) best = l;
    if (best && Math.abs(best.cy - cy(w)) <= 0.5 * pitch) best.words.push(w);
  }
  const maxGap = Math.max(gapFactor * pitch, 2 * typical);
  const text = (l) => l.words.slice().sort((p, q) => p.x0 - q.x0).map((w) => w.text).join(' ');
  const startsClue = (t) => /^\d{1,3}\s*[.)]?\s*\S/.test(t.trim());
  let count = 1;
  while (count < lines.length) {
    if (lines[count].cy - lines[count - 1].cy <= maxGap) {
      count++;
      continue;
    }
    // A big gap ends the clues, unless it is a short heading (such as "Clues down") that numbered clue lines follow.
    const clueLinesAfter = lines.slice(count + 1, count + 5).filter((l) => startsClue(text(l))).length;
    if (text(lines[count]).split(/\s+/).length <= 4 && clueLinesAfter >= 2) count++;
    else break;
  }
  let last = count - 1;
  while (last > 0 && !endsWithCount(text(lines[last]))) last--;
  if (!endsWithCount(text(lines[last]))) last = count - 1; // no counts at all: keep everything that was measured
  return { x0: col.x0 - 4, y0: lines[0].cy - 0.8 * typical, x1: col.x1 + 4, y1: lines[last].cy + 0.8 * typical, lines: last + 1 };
}

/**
 * Find the clue columns of a standard crossword. grid: { x0, y0, x1, y1 } or null.
 * Returns { columns:[{x0,y0,x1,y1,lines}] } in reading order (left to right), or null.
 */
export function locateStandardClues(words, grid, page, { gapFactor = 1.9 } = {}) {
  let region = grid ? words.filter((w) => w.y0 >= grid.y1 - 4) : words;
  if (grid && region.length < 25) region = words.filter((w) => w.x0 >= grid.x1 - 4); // clues beside the grid
  if (region.length < 12) return null;
  const columns = splitColumns(region)
    .map((c) => measureColumn(c, gapFactor))
    .filter((c) => c.lines >= 3);
  if (!columns.length) return null;
  const pad = 3;
  return {
    columns: columns.map((c) => ({ x0: Math.max(0, c.x0 - pad), y0: Math.max(0, c.y0 - pad), x1: Math.min(page.w, c.x1 + pad), y1: Math.min(page.h, c.y1 + pad), lines: c.lines })),
  };
}
