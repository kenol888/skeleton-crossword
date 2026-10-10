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
  }[mode];
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas);
  return { text: (data.text || '').trim(), confidence: data.confidence || 0 };
}
