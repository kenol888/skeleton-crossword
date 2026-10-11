// Finds and reads the Across and Down clue lists on a page picture. Combines the page read
// (js/ocr.js), the column finder (js/clueFinder.js) and a careful second read of each column.
import { recognize, recognizeWords } from './ocr.js';
import { locateClues, locateStandardClues } from './clueFinder.js';
import { cropRect } from './imageImport.js';
import { parseClues } from './clueParser.js';

async function readColumns(canvas, loc, onStatus, toSource) {
  onStatus('Reading the Across clues…');
  const across = await recognize(cropRect(canvas, loc.across.x0, loc.across.y0, loc.across.x1 - loc.across.x0, loc.across.y1 - loc.across.y0), { mode: 'text' });
  onStatus('Reading the Down clues…');
  const down = await recognize(cropRect(canvas, loc.down.x0, loc.down.y0, loc.down.x1 - loc.down.x0, loc.down.y1 - loc.down.y0), { mode: 'text' });
  return {
    text: `ACROSS\n${across.text}\nDOWN\n${down.text}`,
    boxes: { across: toSource(loc.across), down: toSource(loc.down) },
  };
}

async function readStandardColumns(canvas, loc, onStatus, toSource) {
  const parts = [];
  const boxes = {};
  for (let k = 0; k < loc.columns.length; k++) {
    const c = loc.columns[k];
    onStatus(loc.columns.length > 1 ? `Reading clue column ${k + 1} of ${loc.columns.length}…` : 'Reading the clues…');
    const r = await recognize(cropRect(canvas, c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0), { mode: 'text' });
    parts.push(r.text);
    boxes['c' + k] = toSource(c);
  }
  // The headings ("Clues across", "Clues down") are in the text, and the Across list may run from one
  // column into the next, so the columns are simply joined in reading order.
  return { text: parts.join('\n'), boxes };
}

/**
 * Look over the whole page for the clue lists nearest the grid.
 * kind 'standard': the clues are in columns below or beside the grid and carry letter counts.
 * grid: { x0, y0, x1, y1 } in page pixels. Resolves { text, boxes } or null if no lists were found.
 * boxes are in page pixels, for showing the user what was read.
 */
export async function findClues(canvas, grid, onStatus = () => {}, kind = 'skeleton') {
  onStatus('Looking for the clues…');
  const page = await recognizeWords(canvas, { onProgress: (s, p) => onStatus(`Looking for the clues… ${Math.round(p * 100)}%`) });
  const size = { w: canvas.width, h: canvas.height };
  const toSource = (b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  if (kind === 'standard') {
    const std = async (opts) => {
      const loc = locateStandardClues(page.words, grid, size, opts);
      if (!loc) return null;
      const r = await readStandardColumns(canvas, loc, onStatus, toSource);
      r.missing = missingNumbers(r.text);
      return r;
    };
    let bestStd = await std({});
    if (bestStd && bestStd.missing > 0) {
      onStatus('Some clue numbers are missing. Taking a second look…');
      const alt = await std({ gapFactor: 3.2 });
      if (alt && alt.missing < bestStd.missing) bestStd = alt;
    }
    return bestStd;
  }
  const attempt = async (opts) => {
    const loc = locateClues(page.words, grid, size, opts);
    if (!loc) return null;
    const r = await readColumns(canvas, loc, onStatus, toSource);
    r.missing = missingNumbers(r.text);
    return r;
  };
  let best = await attempt({});
  // every clue number from 1 up to the highest should appear: if some are missing, the list may
  // have been cut short, so look again with a more forgiving idea of where the lists end
  if (best && best.missing > 0) {
    onStatus('Some clue numbers are missing. Taking a second look…');
    const alt = await attempt({ gapFactor: 3.2 });
    if (alt && alt.missing < best.missing) best = alt;
  }
  return best;
}

/** How many numbers between 1 and the highest clue number appear in neither list. */
export function missingNumbers(text) {
  const parsed = parseClues(text);
  const seen = new Set([...parsed.across, ...parsed.down].map((c) => c.number));
  const max = Math.max(0, ...seen);
  return max - seen.size;
}

/**
 * Read clues from a box the user drew (page pixels). If the box holds both an ACROSS and a
 * DOWN list side by side or stacked, they are separated; otherwise it is read as one list.
 */
export async function readClueBox(canvas, box, onStatus = () => {}, kind = 'skeleton') {
  const crop = cropRect(canvas, box.x, box.y, box.w, box.h);
  const k = crop.width / box.w;
  onStatus('Looking at the box…');
  const page = await recognizeWords(crop, { onProgress: (s, p) => onStatus(`Looking at the box… ${Math.round(p * 100)}%`) });
  if (kind === 'standard') {
    const std = locateStandardClues(page.words, null, { w: crop.width, h: crop.height });
    if (std) return readStandardColumns(crop, std, onStatus, (b) => ({ x: box.x + b.x0 / k, y: box.y + b.y0 / k, w: (b.x1 - b.x0) / k, h: (b.y1 - b.y0) / k }));
    onStatus('Reading the clues…');
    const one = await recognize(crop, { mode: 'text' });
    return { text: one.text, boxes: { single: box } };
  }
  const loc = locateClues(page.words, null, { w: crop.width, h: crop.height });
  if (loc) {
    const toSource = (b) => ({ x: box.x + b.x0 / k, y: box.y + b.y0 / k, w: (b.x1 - b.x0) / k, h: (b.y1 - b.y0) / k });
    return readColumns(crop, loc, onStatus, toSource);
  }
  onStatus('Reading the clues…');
  const r = await recognize(crop, { mode: 'text' });
  return { text: r.text, boxes: { single: box } };
}
