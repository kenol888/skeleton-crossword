// New-puzzle wizard: photo or PDF -> corners -> grid hints -> clues -> finish.
// "Blank puzzle" skips the first three steps.
import { h, toast, dialog, inputDialog } from './ui/dom.js';
import { createCell, createPuzzle, makeClue, parseEnumeration, SYMMETRY } from './model.js';
import { parseClues } from './clueParser.js';
import { optionsFromPuzzle } from './solver.js';
import { runSolver } from './solverClient.js';
import { recognize, OCR_FAILED } from './ocr.js';
import {
  isPdf, loadImageFile, openPdf, autoQuads, straighten, analyseGrid, greyToCanvas, cropCellRegion, cropRect, sourceThumbnail,
} from './imageImport.js';

const STEP_NAMES = ['Photo', 'Corners', 'Grid', 'Clues', 'Finish'];

function dateTitle() {
  return 'Skeleton ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function startImport({ container, blank = false, rows = 11, cols = 15, title = '', onDone, onCancel }) {
  const st = {
    step: blank ? 4 : 1,
    src: null,
    quad: null,
    quads: [],
    quadIdx: 0,
    warped: null,
    rows,
    cols,
    symmetry: 'mirror4',
    cells: Array.from({ length: rows * cols }, () => ({ kind: 'none', value: '', maybe: null })),
    clueText: '',
    clues: { across: [], down: [] },
    warnings: [],
    title: title || dateTitle(),
    box: null,
  };

  const names = blank ? ['Clues', 'Finish'] : STEP_NAMES;
  const first = blank ? 4 : 1;

  // ---------------------------------------------------------------- shell
  function shell(stepNo, content) {
    const dots = names.map((n, i) => {
      const num = first + i;
      return h('li', { class: 'step-dot' + (num === stepNo ? ' on' : num < stepNo ? ' past' : '') , 'aria-current': num === stepNo ? 'step' : null }, n);
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
    st.step = n;
    render();
  }
  function render() {
    [null, stepSource, stepCorners, stepGrid, stepClues, stepFinish][st.step]();
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
          st.src = await pdf.render(page);
        } else {
          st.src = await loadImageFile(f);
        }
        status.textContent = 'Looking for the grid…';
        await new Promise((r) => setTimeout(r, 20));
        st.quads = autoQuads(st.src);
        st.quadIdx = 0;
        st.quad = st.quads[0].map((q) => q.slice());
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
      h('span', null, 'On iPad you can pick from Photos, Files, or take a picture of the newspaper.')
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
        h('p', null, 'Photograph the page flat and in good light, or use a screenshot or PDF of the e-edition. You will adjust the grid corners next, then check what the app found.'),
        input,
        zone,
        status,
        h('p', { class: 'muted' }, 'No picture to hand? ', h('button', { class: 'link', type: 'button', onclick: onCancel }, 'Go back'), ' and choose Blank puzzle.')
      )
    );
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
    shell(
      2,
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Drag the four corners onto the grid'),
        h('p', null, 'Place each handle on an outer corner of the grid. Photos taken at an angle are straightened for you.'),
        wrap,
        status,
        nav(
          btn('‹ Choose another', () => go(1), 'quiet'),
          st.quads.length > 1 ? btn('Try another grid on the page', () => {
            st.quadIdx = (st.quadIdx + 1) % st.quads.length;
            st.quad = st.quads[st.quadIdx].map((q) => q.slice());
            draw();
          }, 'quiet') : null,
          btn('Reset corners', () => { st.quad = st.quads[st.quadIdx].map((q) => q.slice()); draw(); }, 'quiet'),
          btn('Straighten grid ›', async () => {
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
          }, 'primary')
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

  // ---------------------------------------------------------------- 3. grid hints
  function stepGrid() {
    const R = st.rows;
    const C = st.cols;
    const cv = greyToCanvas(st.warped.grey, st.warped.W, st.warped.H);
    cv.className = 'warp-canvas';
    const over = h('div', { class: 'hint-grid', style: `--cols:${C};--rows:${R}` });
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const cellEls = st.cells.map((c, i) => {
      const b = h('button', { class: 'hcell', type: 'button', 'aria-label': `Row ${Math.floor(i / C) + 1}, column ${(i % C) + 1}` });
      b.addEventListener('click', () => cycle(i));
      over.append(b);
      return b;
    });
    function paintCell(i) {
      const c = st.cells[i];
      const el = cellEls[i];
      el.className = 'hcell ' + c.kind + (c.kind === 'none' && c.maybe ? ' maybe' : '');
      el.textContent = c.kind === 'number' || c.kind === 'letter' ? c.value : c.kind === 'none' && c.maybe ? '?' : '';
    }
    st.cells.forEach((_, i) => paintCell(i));

    async function cycle(i) {
      const c = st.cells[i];
      const order = ['none', 'block', 'number', 'letter'];
      let next = order[(order.indexOf(c.kind) + 1) % 4];
      let value = '';
      if (next === 'number') {
        const v = await inputDialog('Printed clue number', 'Number shown in this square', '', { inputmode: 'numeric', maxlength: 3, okLabel: 'Set number' });
        if (v && /^\d{1,3}$/.test(v.trim()) && +v > 0) value = String(+v);
        else next = 'letter';
      }
      if (next === 'letter') {
        const v = await inputDialog('Printed letter', 'Letter shown in this square', '', { maxlength: 1, okLabel: 'Set letter' });
        if (v && /^[a-zA-Z]$/.test(v.trim())) value = v.trim().toUpperCase();
        else next = 'none';
      }
      c.kind = next;
      c.value = value;
      paintCell(i);
      refreshCounts();
    }

    async function readMarks() {
      const jobs = [];
      st.cells.forEach((c, i) => {
        if (c.kind === 'none' && c.maybe) jobs.push(i);
      });
      if (!jobs.length) {
        toast('No printed numbers or letters were spotted. Tap a square to add one by hand.');
        return;
      }
      const capped = jobs.slice(0, 80);
      let done = 0;
      readBtn.disabled = true;
      try {
        for (const i of capped) {
          const c = st.cells[i];
          status.textContent = `Reading squares… ${done + 1} of ${capped.length}`;
          let got = false;
          if (c.maybe === 'number' || c.both) {
            const r = await recognize(cropCellRegion(st.warped, R, C, i, 'number'), { mode: 'digits' });
            const t = r.text.replace(/\D/g, '');
            if (t && +t > 0 && +t < 200 && r.confidence > 30) {
              c.kind = 'number';
              c.value = String(+t);
              got = true;
            }
          }
          if (!got && (c.maybe === 'letter' || c.both)) {
            const r = await recognize(cropCellRegion(st.warped, R, C, i, 'letter'), { mode: 'letter' });
            const t = r.text.replace(/[^A-Z]/g, '');
            if (t.length === 1 && r.confidence > 30) {
              c.kind = 'letter';
              c.value = t;
            }
          }
          paintCell(i);
          done++;
        }
        status.textContent = `Read ${capped.length} squares. Tap any square to correct it.`;
        refreshCounts();
      } catch (e) {
        status.textContent = '';
        toast(OCR_FAILED, 6000);
      } finally {
        readBtn.disabled = false;
      }
    }

    // changing the size re-reads the hints for the new grid
    function setDims(rows, cols) {
      st.rows = Math.min(25, Math.max(3, rows));
      st.cols = Math.min(25, Math.max(3, cols));
      applyAnalysis(analyseGrid(st.warped, st.rows, st.cols));
      stepGrid();
    }
    const readBtn = btn('Read printed numbers and letters', readMarks, '');
    const counts = h('span', { class: 'muted' });
    function refreshCounts() {
      const b = st.cells.filter((c) => c.kind === 'block').length;
      const n = st.cells.filter((c) => c.kind === 'number').length;
      const l = st.cells.filter((c) => c.kind === 'letter').length;
      counts.textContent = `${b} black, ${n} numbered, ${l} lettered`;
    }
    refreshCounts();
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
    shell(
      3,
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Check the grid'),
        h('p', null, 'Skeleton grids show just a few black squares, numbers or letters. Tap a square to cycle: blank, black, number, letter. A ? marks ink that needs reading.'),
        h('div', { class: 'size-row' }, stepper('Columns', C, (v) => setDims(R, v)), stepper('Rows', R, (v) => setDims(v, C)), counts),
        h('div', { class: 'size-row' }, h('span', null, 'Black squares are symmetric:'), symSeg, h('span', { class: 'muted' }, SYMMETRY[st.symmetry].split(': ')[1] || 'no pattern assumed')),
        h('div', { class: 'warp-wrap', style: `aspect-ratio:${st.warped.W} / ${st.warped.H}` }, cv, over),
        status,
        nav(btn('‹ Corners', () => go(2), 'quiet'), readBtn, btn('Clues ›', () => go(4), 'primary'))
      )
    );
  }

  // ---------------------------------------------------------------- 4. clues
  function stepClues() {
    const status = h('p', { class: 'status', 'aria-live': 'polite' });
    const ta = h('textarea', {
      id: 'clue-text',
      class: 'text-area',
      rows: 8,
      placeholder: 'Paste or type the clues here, for example:\nACROSS\n1 A student a lout brains\n3 Sap wanting a dated jet\nDOWN\n1 Clear clue contents cops',
      spellcheck: 'false',
      'aria-label': 'Clue text',
    });
    ta.value = st.clueText;
    ta.addEventListener('input', () => { st.clueText = ta.value; });

    // photo panel for reading text from the picture
    let srcPanel = null;
    if (st.src) {
      const cv = h('canvas', { class: 'src-canvas' });
      cv.width = st.src.width;
      cv.height = st.src.height;
      cv.getContext('2d').drawImage(st.src, 0, 0);
      const selbox = h('div', { class: 'selbox', hidden: true });
      const view = h('div', { class: 'src-view drawing' }, cv, selbox);
      let start = null;
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        return [Math.min(cv.width, Math.max(0, ((e.clientX - r.left) / r.width) * cv.width)), Math.min(cv.height, Math.max(0, ((e.clientY - r.top) / r.height) * cv.height))];
      };
      const showBox = () => {
        if (!st.box) {
          selbox.hidden = true;
          return;
        }
        selbox.hidden = false;
        selbox.style.left = (st.box.x / cv.width) * 100 + '%';
        selbox.style.top = (st.box.y / cv.height) * 100 + '%';
        selbox.style.width = (st.box.w / cv.width) * 100 + '%';
        selbox.style.height = (st.box.h / cv.height) * 100 + '%';
      };
      view.addEventListener('pointerdown', (e) => {
        if (!view.classList.contains('drawing')) return;
        e.preventDefault();
        view.setPointerCapture(e.pointerId);
        start = pos(e);
        st.box = { x: start[0], y: start[1], w: 0, h: 0 };
        showBox();
      });
      view.addEventListener('pointermove', (e) => {
        if (!start) return;
        const q = pos(e);
        st.box = { x: Math.min(start[0], q[0]), y: Math.min(start[1], q[1]), w: Math.abs(q[0] - start[0]), h: Math.abs(q[1] - start[1]) };
        showBox();
        readBtn.disabled = !(st.box.w > 20 && st.box.h > 20);
      });
      const end = () => { start = null; };
      view.addEventListener('pointerup', end);
      view.addEventListener('pointercancel', end);
      const drawBtn = btn('Drawing a box: on', () => {
        const on = view.classList.toggle('drawing');
        drawBtn.textContent = on ? 'Drawing a box: on' : 'Drawing a box: off (scroll and zoom)';
      }, 'quiet');
      const readBtn = btn('Read this area', async () => {
        if (!st.box || st.box.w < 20 || st.box.h < 20) return;
        readBtn.disabled = true;
        status.textContent = 'Loading the text reader…';
        try {
          const r = await recognize(cropRect(st.src, st.box.x, st.box.y, st.box.w, st.box.h), {
            mode: 'text',
            onProgress: (s, p) => { status.textContent = `Reading… ${Math.round(p * 100)}%`; },
          });
          st.clueText = (ta.value.trim() ? ta.value.trim() + '\n' : '') + r.text;
          ta.value = st.clueText;
          status.textContent = r.text ? 'Added the text below. Check it, then sort it into Across and Down.' : 'Nothing readable in that box. Try a tighter box around one column of clues.';
        } catch (e) {
          status.textContent = '';
          toast(OCR_FAILED, 6000);
        } finally {
          readBtn.disabled = false;
        }
      });
      readBtn.disabled = true;
      srcPanel = h(
        'div',
        { class: 'src-panel' },
        h('h3', null, 'Read the clues from the picture'),
        h('p', { class: 'muted' }, 'Draw a box around one column of clues, then read it. Repeat for each column. On iPad you can also press and hold the clue text in the original photo to copy it, then paste below.'),
        view,
        h('div', { class: 'row' }, drawBtn, readBtn)
      );
    }

    const tables = h('div', { class: 'clue-edit-wrap' });
    function renderTables() {
      tables.textContent = '';
      for (const dir of ['across', 'down']) {
        const list = st.clues[dir];
        const tbl = h('div', { class: 'clue-edit' }, h('h3', null, dir === 'across' ? 'Across' : 'Down'));
        list.forEach((c, idx) => {
          const row = h('div', { class: 'ce-row' });
          const num = h('input', { id: `ce-${dir}-${idx}-n`, class: 'text-input ce-n', value: c.number, inputmode: 'numeric', 'aria-label': 'Clue number' });
          const txt = h('input', { id: `ce-${dir}-${idx}-t`, class: 'text-input ce-t', value: c.text, 'aria-label': 'Clue text' });
          const en = h('input', { id: `ce-${dir}-${idx}-e`, class: 'text-input ce-e', value: c.enumeration, placeholder: 'letters', inputmode: 'text', 'aria-label': 'Letter count' });
          num.addEventListener('input', () => { c.number = parseInt(num.value, 10) || 0; });
          txt.addEventListener('input', () => { c.text = txt.value; });
          en.addEventListener('input', () => { c.enumeration = en.value.replace(/[()]/g, ''); c.length = parseEnumeration(en.value).length; });
          const del = h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Delete clue', onclick: () => { list.splice(idx, 1); renderTables(); } }, '×');
          row.append(num, txt, en, del);
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
      if (st.warnings.length) {
        tables.append(h('ul', { class: 'problems warn-list' }, st.warnings.slice(0, 10).map((w) => h('li', null, w))));
      }
    }
    function sortText() {
      const parsed = parseClues(ta.value);
      st.clues = { across: parsed.across, down: parsed.down };
      st.warnings = parsed.warnings;
      renderTables();
      status.textContent = `Found ${parsed.across.length} across and ${parsed.down.length} down clues. Fix anything that looks wrong below.`;
    }
    renderTables();

    shell(
      4,
      h(
        'div',
        { class: 'panel wide' },
        h('h2', null, 'Add the clues'),
        h('p', null, 'Each clue needs its number. Letter counts such as (5) or (3,4) are optional: when the paper does not print them, the app works out the black squares from the clue numbers alone, and you can add counts later as you solve answers.'),
        h('div', { class: 'clues-layout' }, srcPanel, h('div', { class: 'text-panel' }, h('label', { for: 'clue-text', class: 'lbl' }, 'Clue text'), ta, h('div', { class: 'row' }, btn('Sort into Across and Down', sortText, 'primary')), status)),
        tables,
        nav(
          btn('‹ Back', () => (blank ? onCancel() : go(3)), 'quiet'),
          btn('Finish ›', () => {
            if (!st.clues.across.length && !st.clues.down.length && ta.value.trim()) sortText();
            go(5);
          }, 'primary')
        )
      )
    );
  }

  // ---------------------------------------------------------------- 5. finish
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

  function stepFinish() {
    const titleIn = h('input', { id: 'puz-title', class: 'text-input', value: st.title, maxlength: 60, 'aria-label': 'Puzzle name' });
    titleIn.addEventListener('input', () => { st.title = titleIn.value; });
    const out = h('div', { class: 'result', 'aria-live': 'polite' });
    const nA = st.clues.across.length;
    const nD = st.clues.down.length;
    const given = st.cells.filter((c) => c.kind !== 'none').length;

    async function check() {
      out.textContent = '';
      if (!nA && !nD) {
        out.append(h('p', { class: 'error' }, 'There are no clues yet, so the layout cannot be checked.'));
        return;
      }
      out.append(h('p', { class: 'muted' }, 'Checking…'));
      const res = await runSolver(optionsFromPuzzle(buildPuzzle(), { maxSolutions: 500 }));
      out.textContent = '';
      if (res.count === 0 && res.capped) out.append(h('p', null, 'This is too open to check yet. That is normal when few squares are printed. You can still play.'));
      else if (res.count === 0) out.append(h('p', { class: 'error' }, 'No grid layout fits these clues and printed squares. Look for a missing or wrong clue number (every number from 1 up needs a clue), a wrong grid size or symmetry, or a printed square read in the wrong place.'));
      else if (res.unique) out.append(h('p', { class: 'ok-text' }, 'These clues fit exactly one layout. The app can give you the whole grid pattern.'));
      else if (res.complete) out.append(h('p', { class: 'ok-text' }, `${res.count} layouts fit these clues. The app can place the black squares they all share, and you can narrow it down by adding letter counts as you solve.`));
      else out.append(h('p', null, 'Many layouts fit so far. Hints will sharpen as you place squares and add letter counts.'));
    }

    shell(
      5,
      h(
        'div',
        { class: 'panel narrow' },
        h('h2', null, 'Ready to play'),
        h('label', { class: 'field', for: 'puz-title' }, h('span', null, 'Name'), titleIn),
        h(
          'ul',
          { class: 'summary' },
          h('li', null, `${st.cols} columns × ${st.rows} rows`),
          h('li', null, `Symmetry: ${SYMMETRY[st.symmetry].split(':')[0]}`),
          h('li', null, `${nA} across and ${nD} down clues`),
          h('li', null, `${given} printed square${given === 1 ? '' : 's'} (black, number or letter)`)
        ),
        h('div', { class: 'row' }, btn('Check clues against the grid', check, '')),
        out,
        nav(btn('‹ Back', () => go(4), 'quiet'), btn('Start puzzle', () => onDone(buildPuzzle()), 'primary'))
      )
    );
  }

  render();
}
