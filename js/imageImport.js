// Canvas-side image helpers for the import flow: load a photo or PDF, convert to greyscale,
// straighten the grid, and crop pieces for the text reader. The maths lives in gridDetect.js.
import { darkMask, detectQuad, detectQuads, detectGridDims, detectHints, warpGrey, warpDims, REGIONS } from './gridDetect.js';

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
export const MAX_SIDE = 2400;
export const WARP_WIDTH = 1200;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

function fitCanvas(source, sw, sh) {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

export async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("That file couldn't be opened as an image."));
      im.src = url;
    });
    return fitCanvas(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Opens a PDF and returns { pageCount, render(n) -> canvas }. */
export async function openPdf(file) {
  if (!window.pdfjsLib) await loadScript(PDFJS_URL);
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  return {
    pageCount: pdf.numPages,
    async render(n) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = MAX_SIDE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(viewport.width);
      c.height = Math.round(viewport.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return c;
    },
  };
}

export function canvasToGrey(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const grey = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) grey[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0;
  return { grey, w, h };
}

export function greyToCanvas(grey, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = grey[i];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Candidate grid corners [tl,tr,br,bl] in source canvas pixels, best first (always at least one). */
export function autoQuads(canvas) {
  // work on a copy no bigger than 1600px so thin grid lines survive but detection stays quick
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const { grey, w, h } = canvasToGrey(small);
  const dark = darkMask(grey, 30);
  let quads = detectQuads(dark, w, h);
  if (!quads.length) quads = [detectQuad(dark, w, h)];
  return quads.map((q) => q.map(([x, y]) => [x / scale, y / scale]));
}

/** Straighten the quad to a WARP_WIDTH wide rectangle. Returns { grey, dark, W, H }. */
export function straighten(canvas, quad) {
  const { grey, w, h } = canvasToGrey(canvas);
  const { W, H } = warpDims(quad, WARP_WIDTH);
  const out = warpGrey(grey, w, h, quad, W, H);
  return { grey: out, dark: darkMask(out, 30), W, H };
}

/** Grid dimensions (auto-detected unless rows and cols are given) and the hints in each cell. */
export function analyseGrid(warped, rows, cols) {
  let R = rows;
  let C = cols;
  if (!R || !C) {
    const d = detectGridDims(warped.dark, warped.W, warped.H);
    R = d.rows;
    C = d.cols;
  }
  return { rows: R, cols: C, hints: detectHints(warped.dark, warped.W, warped.H, R, C) };
}

/** Crop a cell's number or letter area from the straightened grid for the text reader. */
export function cropCellRegion(warped, rows, cols, index, kind) {
  const cw = warped.W / cols;
  const ch = warped.H / rows;
  const r = Math.floor(index / cols);
  const c = index % cols;
  const [a, b, c2, d] = REGIONS[kind === 'number' ? 'number' : 'letter'];
  const x0 = Math.round(c * cw + a * cw);
  const y0 = Math.round(r * ch + b * ch);
  const w = Math.max(4, Math.round((c2 - a) * cw));
  const h = Math.max(4, Math.round((d - b) * ch));
  const scale = 4;
  const pad = 12;
  const out = document.createElement('canvas');
  out.width = w * scale + pad * 2;
  out.height = h * scale + pad * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  const tmp = greyToCanvas(warped.grey, warped.W, warped.H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, x0, y0, w, h, pad, pad, w * scale, h * scale);
  return out;
}

/** Crop a rectangle (source canvas pixels) for reading clue text; upscale small areas. */
export function cropRect(canvas, x, y, w, h) {
  const scale = Math.max(1, Math.min(3, 1600 / Math.max(w, 1)));
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

/** Downscaled JPEG data URL stored with the puzzle so it can be viewed while playing. */
export function sourceThumbnail(canvas) {
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
