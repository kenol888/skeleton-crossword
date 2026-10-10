// New-puzzle wizard: photo or PDF -> corners -> check the grid -> clues -> play.
// "Blank puzzle" skips the first three steps.
import { h, toast, dialog, inputDialog } from './ui/dom.js';
import { createCell, createPuzzle, makeClue, parseEnumeration, SYMMETRY } from './model.js';
import { parseClues } from './clueParser.js';
import { recognize, OCR_FAILED } from './ocr.js';
import {
  isPdf, loadImageFile, openPdf, autoQuads, straighten, analyseGrid, greyToCanvas, cropCellRegion, cropCell, rotateCanvas, fixOrientation, sourceThumbnail,
} from './imageImport.js';
import { findClues, readClueBox } from './clueReader.js';

function dateTitle() {
  return 'Skeleton ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const TOOLS = [
  ['block', 'Black square', 'Tap a square to make it black, or tap a black square to make it white again.'],
  ['number', 'Number', 'Tap a square, then type the clue number printed in it.'],
  ['letter', 'Letter', 'Tap a square, then type the letter printed in it.'],
  ['clear', 'Clear', 'Tap a square to remove whatever the app marked on it.'],
];

export function startImport({ container, blank = false, rows = 11, cols = 15, title = '', onDone, onCancel }) {
  const st = {
    step: blank ? 4 : 1,
    src: null,
    turned: 0,
    quads: [],
    quadIdx: 0,
    quad: null,
    warped: null,
    rows,
    cols,
    symmetry: 'mirror4',
    tool: 'block',
    cells: Array.from({ length: rows * cols }, () => ({ kind: 'none', value: '', maybe: null })),
    readToken: 0,
    clueToken: 0,
    clueState: 'idle', // idle | reading | done | failed
    clueStatus: '',
    clueText: '',
    clues: { across: [], down: [] },
    warnings: [],
    boxes: null,
    title: title || dateTitle(),
  };

  const names = blank ? ['Clues'] : ['Photo', 'Corners', 'Grid', 'Clues'];
  const first = blank ? 4 : 1;

  // ---------------------------------------------------------------- shell
  function shell(stepNo, content) {
    const dots = names.map((n, i) => {
      const num = first + i;
      return h('li', { class: 'step-dot' + (num === stepNo ? ' on' : num < stepNo ? ' past' : ''), 'aria-current': num === stepNo ? 'step' : null }, n);
    });
    container.textContent = '';
    container.append(
      h(
        'div',
        { class: 'import' },
        h('header', { class: 'import-top' }, h('button', { class: 'btn quiet', type: 'button', onclick: onCancel }, '‹ Library'), h('h1', null, blank ? 'Blank puzzle' : 'New puzzle'), h('ol', { class: 'steps' }, dots)),
        h('div', { class: 'import-body' }, content)
      )
    );
  }
  const nav = (...btns) => h('div', { class: 'import-nav' }, btns);
  const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);

  function go(n) {
    st.readToken++; // stop any background reading started by the step we are leaving
    st.step = n;
    render();
  }
  function render() {
    [null, stepSource, stepCorners, stepGrid, stepClues][st.step]();
  }

  // ---------------------------------------------------------------- 1. source
  function stepSource() {
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const input = h('input', { id: 'file-in', class: 'file-in', type: 'file', accept: 'image/*,application/pdf' });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      status.textContent = 'Opening ' + f.name + '…';
      try {
        let canvas;
        if (isPdf(f)) {
          const pdf = await openPdf(f);
          let page = 1;
          if (pdf.pageCount > 1) {
            const v = await inputDialog('Which page?', `This PDF has ${pdf.pageCount} pages. Page with the crossword:`, '1', { inputmode: 'numeric', okLabel: 'Open page' });
            if (v === null) {
              status.textContent = '';
              return;
            }
            page = Math.min(pdf.pageCount, Math.max(1, parseInt(v, 10) || 1));
          }
          canvas = await pdf.render(page);
        } else {
          canvas = await loadImageFile(f);
        }
        await new Promise((r) => setTimeout(r, 20));
        const fixed = await fixOrientation(canvas, (m) => { status.textContent = m; });
        st.src = fixed.canvas;
        st.turned = fixed.degrees;
        status.textContent = 'Looking for the grid…';
        await new Promise((r) => setTimeout(r, 20));
        findQuads();
        go(2);
      } catch (e) {
        status.textContent = '';
        toast(isPdf(f) ? "Couldn't open that PDF. Check your connection (the PDF reader is downloaded the first time), or use a screenshot instead." : e.message || "Couldn't open that file.", 6000);
      }
    });
    const zone = h(
      'label',
      { class: 'drop', for: 'file-in' },
      h('strong', null, 'Choose a photo, screenshot or PDF'),
      h('span', null, 'On iPad you can pick from Photos, Files, or take a picture of the newspaper. A sideways page is turned the right way up for you.')
    );
    ['dragover', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          input.dispatchEvent(new Event('change'));
        }
      })
    );
    shell(
      1,
      h(
        'div',
        { class: 'panel narrow' },
        h('h2', null, 'Start from the printed puzzle'),
        h('p', null, 'Photograph the whole page flat and in good light, or use a screenshot or PDF of the e-edition.'),
        input,
        zone,
        status
      )
    );
  }

  function findQuads() {
    st.quads = autoQuads(st.src);
    st.quadIdx = 0;
    st.quad = st.quads[0].map((q) => q.slice());
  }

  // ---------------------------------------------------------------- 2. corners
  function stepCorners() {
    const cv = h('canvas', { class: 'crop-canvas' });
    cv.width = st.src.width;
    cv.height = st.src.height;
    cv.getContext('2d').drawImage(st.src, 0, 0);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${cv.width} ${cv.height}`);
    svg.setAttribute('class', 'crop-svg');
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('class', 'crop-poly');
    svg.append(poly);
    const wrap = h('div', { class: 'crop-wrap' }, cv, svg);
    const handles = st.quad.map((_, k) => {
      const hd = h('div', { class: 'handle', tabindex: '0', role: 'slider', 'aria-label': ['Top left', 'Top right', 'Bottom right', 'Bottom left'][k] + ' corner' });
      hd.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hd.setPointerCapture(e.pointerId);
        hd.classList.add('drag');
      });
      hd.addEventListener('pointermove', (e) => {
        if (!hd.hasPointerCapture(e.pointerId)) return;
        const r = cv.getBoundingClientRect();
        st.quad[k] = [
          Math.min(cv.width, Math.max(0, ((e.clientX - r.left) / r.width) * cv.width)),
          Math.min(cv.height, Math.max(0, ((e.clientY - r.top) / r.height) * cv.height)),
        ];
        draw();
      });
      const up = () => hd.classList.remove('drag');
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
      wrap.append(hd);
      return hd;
    });
    function draw() {
      poly.setAttribute('points', st.quad.map((q) => q.join(',')).join(' '));
      st.quad.forEach((q, k) => {
        handles[k].style.left = (q[0] / cv.width) * 100 + '%';
        handles[k].style.top = (q[1] / cv.height) * 100 + '%';
      });
    }
    draw();
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const turn = (deg) => {
      st.src = rotateCanvas(st.src, deg);
      st.turned = (st.turned + deg) % 360;
      st.clueState = 'idle';
      findQuads();
      stepCorners();
    };
    async function next() {
      status.textContent = 'Straightening…';
      await new Promise((r) => setTimeout(r, 20));
      try {
        st.warped = straighten(st.src, st.quad);
        applyAnalysis(analyseGrid(st.warped));
        go(3);
      } catch (e) {
        status.textContent = '';
        toast('Those corners overlap. Move them so they form a four-sided shape around the grid.', 5000);
      }
    }
    shell(
      2,
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Is the box round the grid?'),
        h('p', null, st.turned ? 'The page was sideways, so I turned it. If the box is not on the grid, drag its corners. ' : 'If the box is not on the grid, drag its corners. ', 'Photos taken at an angle are straightened for you.'),
        wrap,
        status,
        nav(
          btn('‹ Choose another', () => go(1), 'quiet'),
          btn('↺ Turn left', () => turn(270), 'quiet'),
          btn('↻ Turn right', () => turn(90), 'quiet'),
          st.quads.length > 1
            ? btn('Try another grid on the page', () => {
                st.quadIdx = (st.quadIdx + 1) % st.quads.length;
                st.quad = st.quads[st.quadIdx].map((q) => q.slice());
                draw();
              }, 'quiet')
            : null,
          btn('Next ›', next, 'primary')
        )
      )
    );
  }

  function applyAnalysis(a) {
    st.rows = a.rows;
    st.cols = a.cols;
    st.cells = a.hints.map((hh) => ({
      kind: hh.block ? 'block' : 'none',
      value: '',
      maybe: hh.maybeNumber ? 'number' : hh.maybeLetter ? 'letter' : null,
      both: hh.maybeNumber && hh.maybeLetter,
    }));
  }

  // ---------------------------------------------------------------- 3. check the grid
  function stepGrid() {
    const R = st.rows;
    const C = st.cols;
    const token = ++st.readToken;
    const cv = greyToCanvas(st.warped.grey, st.warped.W, st.warped.H);
    cv.className = 'warp-canvas';
    const over = h('div', { class: 'hint-grid', style: `--cols:${C};--rows:${R}` });
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const counts = h('span', { class: 'muted' });
    const help = h('p', { class: 'tool-help' });
    const nextBtn = btn('Next ›', () => go(4), 'primary');
    const warp = h('div', { class: 'warp-wrap', style: `aspect-ratio:${st.warped.W} / ${st.warped.H};--cols:${C};--rows:${R}` }, cv, over);
    const compareBtn = h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false' }, 'Compare with picture');
    compareBtn.addEventListener('click', () => {
      const on = warp.classList.toggle('compare');
      compareBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      compareBtn.textContent = on ? 'Showing the picture only. Tap to show marks' : 'Compare with picture';
      compareBtn.classList.toggle('primary', on);
    });

    const cellEls = st.cells.map((c, i) => {
      const b = h('button', { class: 'hcell', type: 'button', 'aria-label': `Row ${Math.floor(i / C) + 1}, column ${(i % C) + 1}` });
      b.addEventListener('click', () => applyTool(i));
      over.append(b);
      return b;
    });
    function paintCell(i) {
      const c = st.cells[i];
      const el = cellEls[i];
      const unread = c.kind === 'none' && c.maybe;
      el.className = 'hcell ' + c.kind + (unread ? ' unread' : '');
      el.dataset.label = c.kind === 'number' || c.kind === 'letter' ? c.value : unread ? '?' : '';
      el.title = unread ? 'There is print here that the app could not read' : '';
    }
    st.cells.forEach((_, i) => paintCell(i));
    function refreshCounts() {
      const b = st.cells.filter((c) => c.kind === 'block').length;
      const n = st.cells.filter((c) => c.kind === 'number').length;
      const l = st.cells.filter((c) => c.kind === 'letter').length;
      counts.textContent = `${b} black, ${n} numbered, ${l} lettered`;
    }
    refreshCounts();

    // a zoomed picture of the square and a box to type what is printed there
    async function askPrint(i) {
      const c = st.cells[i];
      let message = '';
      for (;;) {
        const input = h('input', {
          id: 'print-in', class: 'text-input mono', type: 'text', maxlength: 3, value: c.kind === 'number' || c.kind === 'letter' ? c.value : '',
          autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'What is printed in this square',
        });
        const zoom = cropCell(st.warped, R, C, i);
        zoom.className = 'cell-zoom';
        const body = h(
          'div',
          { class: 'zoom-body' },
          zoom,
          h('label', { class: 'field', for: 'print-in' }, h('span', null, 'What is printed in the dashed square?'), input),
          h('p', { class: message ? 'error' : 'muted' }, message || 'Type the clue number (such as 16) or the single letter. If the square is empty, choose Nothing here.')
        );
        const d = dialog({
          title: `Row ${Math.floor(i / C) + 1}, column ${(i % C) + 1}`,
          body,
          buttons: [
            { label: 'Cancel', value: null },
            { label: 'Nothing here', value: 'none' },
            { label: 'Set', value: 'ok', primary: true },
          ],
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') d.close('ok'); });
        setTimeout(() => { input.focus(); input.select(); }, 40);
        const r = await d.promise;
        if (r === null) return;
        if (r === 'none') {
          c.kind = 'none';
          c.value = '';
          c.maybe = null;
          break;
        }
        const v = input.value.trim();
        if (/^\d{1,3}$/.test(v) && +v > 0) {
          c.kind = 'number';
          c.value = String(+v);
          c.maybe = null;
          break;
        }
        if (/^[a-zA-Z]$/.test(v)) {
          c.kind = 'letter';
          c.value = v.toUpperCase();
          c.maybe = null;
          break;
        }
        message = 'That is not a clue number or a single letter. Try again.';
      }
      paintCell(i);
      refreshCounts();
    }

    async function applyTool(i) {
      const c = st.cells[i];
      // a square with print the app could not read, or the Number and Letter tools: show the square up close
      if ((c.kind === 'none' && c.maybe) || st.tool === 'number' || st.tool === 'letter') {
        await askPrint(i);
        return;
      }
      if (st.tool === 'block') {
        c.kind = c.kind === 'block' ? 'none' : 'block';
        c.value = '';
        c.maybe = null;
      } else if (st.tool === 'clear') {
        c.kind = 'none';
        c.value = '';
        c.maybe = null;
      }
      paintCell(i);
      refreshCounts();
    }

    // read any printed numbers and letters straight away, no button needed
    async function autoRead() {
      const jobs = [];
      st.cells.forEach((c, i) => {
        if (c.kind === 'none' && c.maybe) jobs.push(i);
      });
      if (!jobs.length) {
        status.textContent = 'No printed numbers or letters found. If the puzzle has some, use the Number or Letter tool below.';
        return;
      }
      const todo = jobs.slice(0, 80);
      nextBtn.disabled = true;
      try {
        for (let k = 0; k < todo.length; k++) {
          if (token !== st.readToken) return;
          const i = todo[k];
          const c = st.cells[i];
          status.textContent = `Reading the printed numbers and letters… ${k + 1} of ${todo.length}`;
          let got = false;
          if (c.maybe === 'number' || c.both) {
            // try the plain crop, then a crisp black-and-white one, then one digit at a time
            const attempts = [
              ['digits', false],
              ['digits', true],
              ['digit', true],
            ];
            for (const [mode, crisp] of attempts) {
              const r = await recognize(cropCellRegion(st.warped, R, C, i, 'number', crisp), { mode });
              if (token !== st.readToken) return;
              const t = r.text.replace(/\D/g, '');
              if (t && +t > 0 && +t < 200 && r.confidence > 30) {
                c.kind = 'number';
                c.value = String(+t);
                c.maybe = null;
                got = true;
                break;
              }
            }
          }
          if (!got && (c.maybe === 'letter' || c.both)) {
            const r = await recognize(cropCellRegion(st.warped, R, C, i, 'letter'), { mode: 'letter' });
            const t = r.text.replace(/[^A-Z]/g, '');
            if (token !== st.readToken) return;
            if (t.length === 1 && r.confidence > 30) {
              c.kind = 'letter';
              c.value = t;
              c.maybe = null;
            }
          }
          paintCell(i);
        }
        refreshCounts();
        const left = st.cells.filter((c) => c.kind === 'none' && c.maybe).length;
        const n = st.cells.filter((c) => c.kind === 'number').length;
        const l = st.cells.filter((c) => c.kind === 'letter').length;
        status.textContent = `Found ${n} printed number${n === 1 ? '' : 's'} and ${l} printed letter${l === 1 ? '' : 's'}.` + (left ? ` ${left} square${left === 1 ? ' has' : 's have'} print I could not read (dashed ?). Tap ${left === 1 ? 'it' : 'one'} to see the square up close and type what is printed.` : ' Check them against the picture.');
      } catch (e) {
        if (token === st.readToken) status.textContent = "Couldn't load the text reader (no connection?). Use the Number or Letter tool to type the printed numbers and letters yourself.";
      } finally {
        if (token === st.readToken) nextBtn.disabled = false;
      }
    }

    // changing the size re-reads the hints for the new grid
    function setDims(rows, cols) {
      st.rows = Math.min(25, Math.max(3, rows));
      st.cols = Math.min(25, Math.max(3, cols));
      applyAnalysis(analyseGrid(st.warped, st.rows, st.cols));
      stepGrid();
    }
    const stepper = (label, value, onChange) =>
      h(
        'div',
        { class: 'stepper' },
        h('span', null, label),
        h('button', { class: 'btn', type: 'button', 'aria-label': 'Fewer ' + label.toLowerCase(), onclick: () => onChange(value - 1) }, '−'),
        h('strong', { class: 'size-val' }, String(value)),
        h('button', { class: 'btn', type: 'button', 'aria-label': 'More ' + label.toLowerCase(), onclick: () => onChange(value + 1) }, '+')
      );
    const symSeg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Black square symmetry' },
      Object.entries(SYMMETRY).map(([k, label]) =>
        h('button', { type: 'button', class: 'seg-btn' + (st.symmetry === k ? ' on' : ''), onclick: () => { st.symmetry = k; stepGrid(); } }, label.split(':')[0])
      )
    );
    const toolBtns = TOOLS.map(([key, label]) => {
      const b = h('button', { type: 'button', class: 'seg-btn' + (st.tool === key ? ' on' : ''), onclick: () => setTool(key) }, label);
      b.dataset.tool = key;
      return b;
    });
    function setTool(key) {
      st.tool = key;
      toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === key));
      help.textContent = TOOLS.find((t) => t[0] === key)[2];
    }
    help.textContent = TOOLS.find((t) => t[0] === st.tool)[2];

    shell(
      3,
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Check what I found in the grid'),
        h(
          'ul',
          { class: 'legend' },
          h('li', null, h('i', { class: 'sw block' }), 'Black square printed in the puzzle'),
          h('li', null, h('i', { class: 'sw number' }, '7'), 'Clue number I read'),
          h('li', null, h('i', { class: 'sw letter' }, 'E'), 'Letter I read'),
          h('li', null, h('i', { class: 'sw unread' }, '?'), 'Print I could not read (tap it to type it in)')
        ),
        status,
        h('div', { class: 'size-row' }, h('span', { class: 'lbl' }, 'Fix a mistake:'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Tool' }, toolBtns), counts),
        h('div', { class: 'row' }, help, h('span', { class: 'grow' }), compareBtn),
        warp,
        h('div', { class: 'size-row' }, stepper('Columns', C, (v) => setDims(R, v)), stepper('Rows', R, (v) => setDims(v, C))),
        h('div', { class: 'size-row' }, h('span', { class: 'lbl' }, 'Black squares are symmetric:'), symSeg, h('span', { class: 'muted' }, SYMMETRY[st.symmetry].split(': ')[1] || 'no pattern assumed')),
        nav(btn('‹ Back', () => go(2), 'quiet'), nextBtn)
      )
    );
    autoRead();
  }

  // ---------------------------------------------------------------- 4. clues
  const gridRect = () => {
    const xs = st.quad.map((q) => q[0]);
    const ys = st.quad.map((q) => q[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };

  function applyClueText(text) {
    st.clueText = text;
    const parsed = parseClues(text);
    st.clues = { across: parsed.across, down: parsed.down };
    st.warnings = parsed.warnings;
  }

  function stepClues() {
    const token = ++st.clueToken;
    const status = h('p', { class: 'status', 'aria-live': 'polite' }, st.clueStatus);
    const setStatus = (m) => {
      st.clueStatus = m;
      if (status.isConnected) status.textContent = m;
    };
    const ta = h('textarea', {
      id: 'clue-text',
      class: 'text-area',
      rows: 8,
      placeholder: 'ACROSS\n1 A student a lout brains\n3 Sap wanting a dated jet\nDOWN\n1 Clear clue contents cops',
      spellcheck: 'false',
      'aria-label': 'Clue text',
    });
    ta.value = st.clueText;
    ta.addEventListener('input', () => { st.clueText = ta.value; });

    // ---- the picture, with boxes showing what was read
    let srcPanel = null;
    let view = null;
    let drawBtn = null;
    const boxEls = [];
    function showBoxes() {
      boxEls.forEach((b) => b.remove());
      boxEls.length = 0;
      if (!view || !st.boxes) return;
      const cv = view.querySelector('canvas');
      for (const [name, b] of Object.entries(st.boxes)) {
        const label = name === 'across' ? 'Across' : name === 'down' ? 'Down' : 'Clues';
        const el = h('div', { class: 'selbox' }, h('span', null, label));
        el.style.left = (b.x / cv.width) * 100 + '%';
        el.style.top = (b.y / cv.height) * 100 + '%';
        el.style.width = (b.w / cv.width) * 100 + '%';
        el.style.height = (b.h / cv.height) * 100 + '%';
        view.append(el);
        boxEls.push(el);
      }
    }
    if (st.src) {
      const cv = h('canvas', { class: 'src-canvas' });
      cv.width = st.src.width;
      cv.height = st.src.height;
      cv.getContext('2d').drawImage(st.src, 0, 0);
      view = h('div', { class: 'src-view' }, cv);
      let start = null;
      let drag = null;
      const dragEl = h('div', { class: 'selbox draft' });
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        return [Math.min(cv.width, Math.max(0, ((e.clientX - r.left) / r.width) * cv.width)), Math.min(cv.height, Math.max(0, ((e.clientY - r.top) / r.height) * cv.height))];
      };
      const showDrag = () => {
        dragEl.style.left = (drag.x / cv.width) * 100 + '%';
        dragEl.style.top = (drag.y / cv.height) * 100 + '%';
        dragEl.style.width = (drag.w / cv.width) * 100 + '%';
        dragEl.style.height = (drag.h / cv.height) * 100 + '%';
      };
      view.addEventListener('pointerdown', (e) => {
        if (!view.classList.contains('drawing')) return;
        e.preventDefault();
        view.setPointerCapture(e.pointerId);
        start = pos(e);
        drag = { x: start[0], y: start[1], w: 0, h: 0 };
        view.append(dragEl);
        showDrag();
      });
      view.addEventListener('pointermove', (e) => {
        if (!start) return;
        const q = pos(e);
        drag = { x: Math.min(start[0], q[0]), y: Math.min(start[1], q[1]), w: Math.abs(q[0] - start[0]), h: Math.abs(q[1] - start[1]) };
        showDrag();
      });
      const end = async () => {
        if (!start) return;
        start = null;
        dragEl.remove();
        if (drag && drag.w > 30 && drag.h > 30) {
          view.classList.remove('drawing');
          drawBtn.textContent = 'Draw a box round the clues';
          await runRead(() => readClueBox(st.src, drag, setStatus));
        }
      };
      view.addEventListener('pointerup', end);
      view.addEventListener('pointercancel', () => { start = null; dragEl.remove(); });
      drawBtn = btn('Draw a box round the clues', () => {
        const on = view.classList.toggle('drawing');
        drawBtn.textContent = on ? 'Now drag over the clues' : 'Draw a box round the clues';
        if (on) setStatus('Drag a box over the Across and Down lists (both together is fine).');
      }, '');
      srcPanel = h(
        'div',
        { class: 'src-panel' },
        h('h3', null, 'Where I read the clues'),
        view,
        h('div', { class: 'row' }, btn('Read again', () => { st.clueState = 'idle'; stepClues(); }, 'quiet'), drawBtn)
      );
      showBoxes();
    }

    // ---- the editable list of clues
    const tables = h('div', { class: 'clue-edit-wrap' });
    function renderTables() {
      tables.textContent = '';
      const anyCounts = st.clues.across.concat(st.clues.down).some((c) => c.enumeration);
      for (const dir of ['across', 'down']) {
        const list = st.clues[dir];
        const tbl = h('div', { class: 'clue-edit' }, h('h3', null, `${dir === 'across' ? 'Across' : 'Down'} (${list.length})`));
        list.forEach((c, idx) => {
          const row = h('div', { class: 'ce-row' + (anyCounts ? ' with-count' : '') });
          const num = h('input', { id: `ce-${dir}-${idx}-n`, class: 'text-input ce-n', value: c.number, inputmode: 'numeric', 'aria-label': 'Clue number' });
          const txt = h('input', { id: `ce-${dir}-${idx}-t`, class: 'text-input ce-t', value: c.text, 'aria-label': 'Clue text' });
          const en = h('input', { id: `ce-${dir}-${idx}-e`, class: 'text-input ce-e', value: c.enumeration, placeholder: 'letters', inputmode: 'text', 'aria-label': 'Letter count (optional)' });
          num.addEventListener('input', () => { c.number = parseInt(num.value, 10) || 0; });
          txt.addEventListener('input', () => { c.text = txt.value; });
          en.addEventListener('input', () => { c.enumeration = en.value.replace(/[()]/g, ''); c.length = parseEnumeration(en.value).length; });
          const del = h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Delete clue', onclick: () => { list.splice(idx, 1); renderTables(); } }, '×');
          row.append(...(anyCounts ? [num, txt, en, del] : [num, txt, del]));
          tbl.append(row);
        });
        tbl.append(
          h('button', { class: 'btn quiet', type: 'button', onclick: () => {
            const next = list.length ? Math.max(...list.map((x) => x.number)) + 1 : 1;
            list.push({ number: next, text: '', enumeration: '', length: 0 });
            renderTables();
          } }, '+ Add clue')
        );
        tables.append(tbl);
      }
      if (st.warnings.length) tables.append(h('ul', { class: 'problems warn-list' }, st.warnings.slice(0, 10).map((w) => h('li', null, w))));
    }
    renderTables();

    async function runRead(fn) {
      st.clueState = 'reading';
      status.classList.add('busy');
      try {
        const r = await fn();
        if (token !== st.clueToken) return;
        if (!r || !r.text.trim()) {
          st.clueState = 'failed';
          setStatus("I couldn't find the clue lists. Use \"Draw a box round the clues\", or paste them below.");
          return;
        }
        st.boxes = r.boxes;
        applyClueText(r.text);
        st.clueState = 'done';
        setStatus(`Found ${st.clues.across.length} across and ${st.clues.down.length} down clues. Check them below and fix any slips.`);
        showBoxes();
        renderTables();
        ta.value = st.clueText;
      } catch (e) {
        if (token !== st.clueToken) return;
        st.clueState = 'failed';
        setStatus(OCR_FAILED);
      } finally {
        status.classList.remove('busy');
      }
    }
    function sortText() {
      applyClueText(ta.value);
      renderTables();
      setStatus(`Sorted into ${st.clues.across.length} across and ${st.clues.down.length} down clues.`);
    }
    function start() {
      if (!st.clues.across.length && !st.clues.down.length && ta.value.trim()) sortText();
      if (!st.clues.across.length && !st.clues.down.length) {
        toast('Add the clues first. The app works out the grid from the clue numbers.', 4000);
        return;
      }
      onDone(buildPuzzle());
    }

    const paste = h(
      'details',
      { class: 'paste', open: !st.src || st.clueState === 'failed' },
      h('summary', null, 'Paste or type the clues instead'),
      h('p', { class: 'muted' }, 'On iPad, press and hold the clue text in your picture and choose Copy, then paste here. Put ACROSS and DOWN on their own lines.'),
      ta,
      h('div', { class: 'row' }, btn('Sort into Across and Down', sortText, ''))
    );

    shell(
      4,
      h(
        'div',
        { class: 'panel wide' },
        h('h2', null, 'Clues'),
        h('p', null, 'The app works out where the black squares go from the clue numbers, so every number needs to be there. Letter counts such as (5) are optional.'),
        status,
        h('div', { class: 'clues-layout' }, srcPanel, tables),
        paste,
        nav(btn('‹ Back', () => (blank ? onCancel() : go(3)), 'quiet'), btn('Start puzzle ›', start, 'primary'))
      )
    );

    // read the clues automatically the first time we get here
    if (st.src && st.clueState === 'idle') runRead(() => findClues(st.src, gridRect(), setStatus));
    else if (st.clueState === 'reading') setStatus(st.clueStatus);
  }

  // ---------------------------------------------------------------- build
  function buildPuzzle() {
    const R = st.rows;
    const C = st.cols;
    const cells = Array.from({ length: R * C }, createCell);
    st.cells.forEach((c, i) => {
      if (c.kind === 'block') {
        cells[i].givenBlock = true;
        cells[i].block = true;
      } else if (c.kind === 'number') cells[i].givenNumber = Number(c.value);
      else if (c.kind === 'letter') cells[i].givenLetter = c.value;
    });
    const mk = (list) =>
      list
        .filter((c) => c.number > 0)
        .sort((a, b) => a.number - b.number)
        .map((c) => makeClue(c.number, c.text, c.enumeration));
    return createPuzzle({
      rows: R,
      cols: C,
      title: st.title.trim() || dateTitle(),
      cells,
      clues: { across: mk(st.clues.across), down: mk(st.clues.down) },
      settings: { symmetry: st.symmetry },
      sourceImage: st.src ? sourceThumbnail(st.src) : null,
    });
  }

  render();
}
