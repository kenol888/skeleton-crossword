// Finds and reads the Across and Down clue lists on a page picture. Combines the page read
// (js/ocr.js), the column finder (js/clueFinder.js) and a careful second read of each column.
import { recognize, recognizeWords } from './ocr.js';
import { locateClues } from './clueFinder.js';
import { cropRect } from './imageImport.js';

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

/**
 * Look over the whole page for the clue lists nearest the grid.
 * grid: { x0, y0, x1, y1 } in page pixels. Resolves { text, boxes } or null if no lists were found.
 * boxes are in page pixels, for showing the user what was read.
 */
export async function findClues(canvas, grid, onStatus = () => {}) {
  onStatus('Looking for the clues…');
  const page = await recognizeWords(canvas, { onProgress: (s, p) => onStatus(`Looking for the clues… ${Math.round(p * 100)}%`) });
  const loc = locateClues(page.words, grid, { w: canvas.width, h: canvas.height });
  if (!loc) return null;
  return readColumns(canvas, loc, onStatus, (b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
}

/**
 * Read clues from a box the user drew (page pixels). If the box holds both an ACROSS and a
 * DOWN list side by side or stacked, they are separated; otherwise it is read as one list.
 */
export async function readClueBox(canvas, box, onStatus = () => {}) {
  const crop = cropRect(canvas, box.x, box.y, box.w, box.h);
  const k = crop.width / box.w;
  onStatus('Looking at the box…');
  const page = await recognizeWords(crop, { onProgress: (s, p) => onStatus(`Looking at the box… ${Math.round(p * 100)}%`) });
  const loc = locateClues(page.words, null, { w: crop.width, h: crop.height });
  if (loc) {
    const toSource = (b) => ({ x: box.x + b.x0 / k, y: box.y + b.y0 / k, w: (b.x1 - b.x0) / k, h: (b.y1 - b.y0) / k });
    return readColumns(crop, loc, onStatus, toSource);
  }
  onStatus('Reading the clues…');
  const r = await recognize(crop, { mode: 'text' });
  return { text: r.text, boxes: { single: box } };
}
