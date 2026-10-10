// Lazy Tesseract.js wrapper. The library is only fetched the first time text is read.
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESS_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (progressCb && m && typeof m.progress === 'number') progressCb(m.status, m.progress);
        },
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

export const OCR_FAILED = "Couldn't load the text reader. Check your connection, or paste the clues instead.";

/**
 * mode: 'text' (a block of clues), 'digits' (a small clue number), 'letter' (one capital).
 * Resolves { text, confidence }.
 */
export async function recognize(canvas, { mode = 'text', onProgress = null } = {}) {
  progressCb = onProgress;
  const worker = await getWorker();
  const T = window.Tesseract;
  const params = {
    text: { tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK, tessedit_char_whitelist: '', preserve_interword_spaces: '1' },
    digits: { tessedit_pageseg_mode: T.PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789' },
    letter: { tessedit_pageseg_mode: T.PSM.SINGLE_CHAR, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
    digit: { tessedit_pageseg_mode: T.PSM.SINGLE_CHAR, tessedit_char_whitelist: '0123456789' },
  }[mode];
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas);
  return { text: (data.text || '').trim(), confidence: data.confidence || 0 };
}

const pageCache = new WeakMap();

/**
 * Read a whole page and return every word with its position:
 * { words:[{text,x0,y0,x1,y1,conf}], good, confidence }. `good` counts confidently read
 * words of three or more letters, which is a good test of whether the page is the right
 * way up. The result is remembered per canvas so later steps can reuse it.
 */
export async function recognizeWords(canvas, { onProgress = null } = {}) {
  if (pageCache.has(canvas)) return pageCache.get(canvas);
  progressCb = onProgress;
  const worker = await getWorker();
  const T = window.Tesseract;
  await worker.setParameters({ tessedit_pageseg_mode: T.PSM.AUTO, tessedit_char_whitelist: '', preserve_interword_spaces: '0' });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  let raw = data.words || [];
  if (!raw.length) {
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) raw = raw.concat(l.words || []);
  }
  const words = raw.map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
  const good = words.filter((w) => w.conf >= 70 && /^[A-Za-z]{3,}$/.test(w.text)).length;
  const result = { words, good, confidence: data.confidence || 0 };
  pageCache.set(canvas, result);
  return result;
}
