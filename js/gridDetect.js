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

/** 1 where the pixel is ink. `lift` raises the threshold so thin grey grid lines survive. */
export function darkMask(grey, lift = 0) {
  const thr = Math.min(235, otsuThreshold(grey) + lift);
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

/** Longest dark run along a line, with where it starts and ends. */
function longestRunSpan(arr, start, step, len, gap = 2) {
  let best = { len: 0, a: 0, b: 0 };
  let a = -1;
  let last = -1;
  let g = 0;
  const close = () => {
    if (a >= 0 && last - a + 1 > best.len) best = { len: last - a + 1, a, b: last };
    a = -1;
    g = 0;
  };
  for (let k = 0; k < len; k++) {
    if (arr[start + k * step]) {
      if (a < 0) a = k;
      last = k;
      g = 0;
    } else if (a >= 0) {
      g++;
      if (g > gap) close();
    }
  }
  close();
  return best;
}

/**
 * Find grids as groups of long parallel lines that share the same extent.
 * `vertical` looks at columns (extent = top and bottom), otherwise at rows.
 * Returns groups { lo, hi, a, b, count, score } (across the lines, and along them), best first.
 */
function lineGroups(dark, w, h, vertical) {
  const across = vertical ? w : h; // number of lines to scan
  const along = vertical ? h : w;
  const tol = Math.max(3, Math.round(along * 0.012));
  const minLen = along * 0.1;
  const lines = [];
  let cur = null;
  for (let k = 0; k < across; k++) {
    const r = vertical ? longestRunSpan(dark, k, w, along) : longestRunSpan(dark, k * w, 1, along);
    if (r.len >= minLen && cur && Math.abs(r.a - cur.a) <= tol && Math.abs(r.b - cur.b) <= tol) {
      cur.hi = k;
      continue;
    }
    if (cur) lines.push(cur);
    cur = r.len >= minLen ? { lo: k, hi: k, a: r.a, b: r.b } : null;
  }
  if (cur) lines.push(cur);
  const med = (arr) => arr.slice().sort((x, y) => x - y)[arr.length >> 1];
  const groups = [];
  const used = new Set();
  const seeds = lines.slice().sort((p, q) => q.b - q.a - (p.b - p.a));
  for (const seed of seeds) {
    if (used.has(seed)) continue;
    const members = lines.filter((l) => !used.has(l) && Math.abs(l.a - seed.a) <= tol && Math.abs(l.b - seed.b) <= tol);
    members.forEach((l) => used.add(l));
    if (members.length < 4) continue;
    const a = med(members.map((l) => l.a));
    const b = med(members.map((l) => l.b));
    groups.push({
      lo: Math.min(...members.map((l) => l.lo)),
      hi: Math.max(...members.map((l) => l.hi)),
      a,
      b,
      count: members.length,
      score: members.length * (b - a),
    });
  }
  return groups.sort((p, q) => q.score - p.score);
}

/**
 * Candidate grid rectangles, best first, each as corners [tl, tr, br, bl] of [x, y].
 * Works on a whole newspaper page: it keys on groups of grid lines that share the same
 * length, which ignores title bars, text and the underlines of form fields. A page with
 * several crosswords gives several candidates.
 */
export function detectQuads(dark, w, h, max = 4) {
  let groups = lineGroups(dark, w, h, true).map((v) => [[v.lo, v.a], [v.hi + 1, v.a], [v.hi + 1, v.b + 1], [v.lo, v.b + 1]]);
  if (!groups.length) {
    groups = lineGroups(dark, w, h, false).map((v) => [[v.a, v.lo], [v.b + 1, v.lo], [v.b + 1, v.hi + 1], [v.a, v.hi + 1]]);
  }
  return groups.slice(0, max);
}

/** The most likely grid rectangle, with fallbacks when no grid lines are found. */
export function detectQuad(dark, w, h) {
  const found = detectQuads(dark, w, h, 1);
  if (found.length) return found[0];

  // fall back to the longest lines in the picture
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
  if (isFinite(bw) && isFinite(bh) && bw >= 0.15 * w && bh >= 0.15 * h) {
    return [[left, top], [right + 1, top], [right + 1, bottom + 1], [left, bottom + 1]];
  }
  const s = Math.min(w, h) * 0.8;
  const x0 = (w - s) / 2;
  const y0 = (h - s) / 2;
  return [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
}

/** Width and height of the straightened picture for a quad, keeping square cells square. */
export function warpDims(quad, outW) {
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const wq = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2;
  const hq = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  return { W: outW, H: Math.max(40, Math.round((outW * hq) / Math.max(1, wq))) };
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

/** Resample the quad into an outW x outH greyscale rectangle (bilinear). */
export function warpGrey(grey, w, h, quad, outW, outH = outW) {
  const H = solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  const res = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
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
      res[y * outW + x] = a * (1 - ty) + b * ty;
    }
  }
  return res;
}

/**
 * Estimate the number of columns and rows of a W x H straightened grid from the spacing of
 * its lines. Cells are square, so the row count follows from the column count.
 */
export function detectGridDims(dark, W, H, minCols = 5, maxCols = 25) {
  const col = new Float32Array(W);
  const row = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (dark[y * W + x]) {
        col[x]++;
        row[y]++;
      }
    }
  }
  for (let i = 0; i < W; i++) col[i] /= H;
  for (let i = 0; i < H; i++) row[i] /= W;
  const win = Math.max(2, Math.round(W / 300));
  const peak = (p, len, pos) => {
    let m = 0;
    for (let d = -win; d <= win; d++) m = Math.max(m, p[Math.min(len - 1, Math.max(0, Math.round(pos + d)))]);
    return m;
  };
  const at = (p, len, pos) => p[Math.min(len - 1, Math.max(0, Math.round(pos)))];
  const scores = {};
  let bestScore = -Infinity;
  for (let C = minCols; C <= maxCols; C++) {
    const rExact = H / (W / C);
    // a skewed photo distorts the aspect ratio a little, so try the nearby row counts too
    for (let R = Math.max(3, Math.floor(rExact * 0.88)); R <= Math.ceil(rExact * 1.12); R++) {
      let ls = 0;
      let ms = 0;
      for (let k = 0; k <= C; k++) ls += peak(col, W, k * (W / C));
      for (let k = 0; k <= R; k++) ls += peak(row, H, k * (H / R));
      for (let k = 0; k < C; k++) ms += at(col, W, (k + 0.5) * (W / C));
      for (let k = 0; k < R; k++) ms += at(row, H, (k + 0.5) * (H / R));
      const score = ls / (C + R + 2) - ms / (C + R);
      if (!scores[C] || score > scores[C].score) scores[C] = { score, R };
    }
    if (scores[C] && scores[C].score > bestScore) bestScore = scores[C].score;
  }
  // A 15 grid also has lines wherever a 5 grid does, so take the largest size that
  // scores almost as well as the best one.
  let cols = minCols;
  let rows = Math.max(3, Math.round(H / (W / minCols)));
  for (let C = minCols; C <= maxCols; C++) {
    if (scores[C] && scores[C].score >= 0.92 * bestScore) {
      cols = C;
      rows = scores[C].R;
    }
  }
  return { rows, cols, scores };
}

function ratio(dark, W, H, x0, y0, x1, y1) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(W, Math.ceil(x1));
  const yb = Math.min(H, Math.ceil(y1));
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
export function detectHints(dark, W, H, rows, cols) {
  const cw = W / cols;
  const ch = H / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * ch;
      const inner = ratio(dark, W, H, x + 0.15 * cw, y + 0.15 * ch, x + 0.85 * cw, y + 0.85 * ch);
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
        maybeNumber: ratio(dark, W, H, x + (a + dx) * cw, y + (b + dy) * ch, x + c2 * cw, y + d * ch) >= 0.035,
        maybeLetter: ratio(dark, W, H, x + (e + dx) * cw, y + f * ch, x + g * cw, y + i * ch) >= 0.09,
      });
    }
  }
  return out;
}
