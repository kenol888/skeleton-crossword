// Image analysis for importing a printed grid. Pure: works on plain typed arrays, no DOM,
// so it can be tested in node. Greyscale = Uint8Array (0 black .. 255 white), row-major.

export function otsuThreshold(grey) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  const total = grey.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let max = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      thr = t;
    }
  }
  return thr;
}

/** 1 where the pixel is ink. */
export function darkMask(grey) {
  const thr = otsuThreshold(grey);
  const m = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) m[i] = grey[i] <= thr ? 1 : 0;
  return m;
}

function longestRun(arr, start, step, len, gap = 2) {
  let best = 0;
  let run = 0;
  let g = 0;
  for (let k = 0; k < len; k++) {
    if (arr[start + k * step]) {
      run += g + 1;
      g = 0;
    } else if (run > 0) {
      g++;
      if (g > gap) {
        if (run > best) best = run;
        run = 0;
        g = 0;
      }
    }
  }
  return Math.max(best, run);
}

/**
 * Find the outer rectangle of the grid from long dark lines.
 * Returns corners [tl, tr, br, bl] as [x, y]. Falls back to a centred square.
 */
export function detectQuad(dark, w, h) {
  const rowRun = new Int32Array(h);
  const colRun = new Int32Array(w);
  let maxR = 0;
  let maxC = 0;
  for (let y = 0; y < h; y++) {
    rowRun[y] = longestRun(dark, y * w, 1, w);
    if (rowRun[y] > maxR) maxR = rowRun[y];
  }
  for (let x = 0; x < w; x++) {
    colRun[x] = longestRun(dark, x, w, h);
    if (colRun[x] > maxC) maxC = colRun[x];
  }
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (let y = 0; y < h; y++) if (maxR > 0 && rowRun[y] >= 0.6 * maxR) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  for (let x = 0; x < w; x++) if (maxC > 0 && colRun[x] >= 0.6 * maxC) { left = Math.min(left, x); right = Math.max(right, x); }
  const bw = right - left;
  const bh = bottom - top;
  const ok = isFinite(bw) && isFinite(bh) && bw >= 0.15 * w && bh >= 0.15 * h && bw / bh > 0.6 && bw / bh < 1.67;
  if (!ok) {
    const s = Math.min(w, h) * 0.8;
    const x0 = (w - s) / 2;
    const y0 = (h - s) / 2;
    return [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
  }
  return [[left, top], [right + 1, top], [right + 1, bottom + 1], [left, bottom + 1]];
}

/** Homography H mapping dst points to src points. Returns 8 coefficients. */
export function solveHomography(dst, src) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i];
    const [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('Corners are degenerate');
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (!f) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row) => row[8]);
}

export function applyHomography(H, x, y) {
  const d = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

/** Resample the quad into an out x out greyscale square (bilinear). */
export function warpGrey(grey, w, h, quad, out) {
  const H = solveHomography([[0, 0], [out, 0], [out, out], [0, out]], quad);
  const res = new Uint8Array(out * out);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const [u, v] = applyHomography(H, x + 0.5, y + 0.5);
      const fx = u - 0.5;
      const fy = v - 0.5;
      let x0 = Math.floor(fx);
      let y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      let x1 = x0 + 1;
      let y1 = y0 + 1;
      x0 = Math.min(w - 1, Math.max(0, x0));
      x1 = Math.min(w - 1, Math.max(0, x1));
      y0 = Math.min(h - 1, Math.max(0, y0));
      y1 = Math.min(h - 1, Math.max(0, y1));
      const a = grey[y0 * w + x0] * (1 - tx) + grey[y0 * w + x1] * tx;
      const b = grey[y1 * w + x0] * (1 - tx) + grey[y1 * w + x1] * tx;
      res[y * out + x] = a * (1 - ty) + b * ty;
    }
  }
  return res;
}

/** Estimate N for an N x N grid from the spacing of its lines. dark is W x W. */
export function detectGridSize(dark, W, min = 5, max = 25) {
  const col = new Float32Array(W);
  const row = new Float32Array(W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (dark[y * W + x]) {
        col[x]++;
        row[y]++;
      }
    }
  }
  for (let i = 0; i < W; i++) {
    col[i] /= W;
    row[i] /= W;
  }
  const win = Math.max(2, Math.round(W / 300));
  const clamp = (v) => Math.min(W - 1, Math.max(0, Math.round(v)));
  const peak = (p, pos) => {
    let m = 0;
    for (let d = -win; d <= win; d++) m = Math.max(m, p[clamp(pos + d)]);
    return m;
  };
  let best = min;
  let bestScore = -Infinity;
  const scores = {};
  for (let N = min; N <= max; N++) {
    const cs = W / N;
    let ls = 0;
    let ms = 0;
    for (let k = 0; k <= N; k++) ls += peak(col, k * cs) + peak(row, k * cs);
    for (let k = 0; k < N; k++) ms += col[clamp((k + 0.5) * cs)] + row[clamp((k + 0.5) * cs)];
    const score = ls / (2 * (N + 1)) - ms / (2 * N);
    scores[N] = score;
    if (score > bestScore) bestScore = score;
  }
  // A 15 grid also has lines wherever a 5 grid does (and 13 -> none, 12 -> 6, 4, 3...), so
  // take the largest size that scores almost as well as the best one.
  for (let N = min; N <= max; N++) if (scores[N] >= 0.92 * bestScore) best = N;
  return { N: best, scores };
}

function ratio(dark, W, x0, y0, x1, y1) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(W, Math.ceil(x1));
  const yb = Math.min(W, Math.ceil(y1));
  let n = 0;
  let d = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      n++;
      d += dark[y * W + x];
    }
  }
  return n ? d / n : 0;
}

// Regions inside a cell, as fractions [x0, y0, x1, y1].
export const REGIONS = {
  number: [0.1, 0.08, 0.58, 0.5], // small clue number, top-left
  letter: [0.2, 0.42, 0.88, 0.92], // a printed letter, centre/lower
};

/** Per cell: is it a solid block, or does it hold a small number / a letter? */
export function detectHints(dark, W, N) {
  const cs = W / N;
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = c * cs;
      const y = r * cs;
      const inner = ratio(dark, W, x + 0.15 * cs, y + 0.15 * cs, x + 0.85 * cs, y + 0.85 * cs);
      if (inner >= 0.7) {
        out.push({ block: true, maybeNumber: false, maybeLetter: false });
        continue;
      }
      const [a, b, c2, d] = REGIONS.number;
      const [e, f, g, i] = REGIONS.letter;
      // the heavy outer frame bleeds a little into the cells on the edge: look further in there
      const dx = c === 0 ? 0.07 : 0;
      const dy = r === 0 ? 0.07 : 0;
      out.push({
        block: false,
        maybeNumber: ratio(dark, W, x + (a + dx) * cs, y + (b + dy) * cs, x + c2 * cs, y + d * cs) >= 0.035,
        maybeLetter: ratio(dark, W, x + (e + dx) * cs, y + f * cs, x + g * cs, y + i * cs) >= 0.09,
      });
    }
  }
  return out;
}
