// Grid view: renders cells and reports pointer activity. Holds no puzzle logic.
import { h } from './dom.js';

export function createGridView(cb) {
  const el = h('div', { class: 'grid', role: 'application', 'aria-label': 'Crossword grid' });
  let dims = '';
  let cells = [];
  let down = false;
  let lastIdx = -1;

  function build(rows, cols) {
    dims = rows + 'x' + cols;
    el.textContent = '';
    cells = [];
    el.style.setProperty('--rows', rows);
    el.style.setProperty('--cols', cols);
    for (let i = 0; i < rows * cols; i++) {
      const c = h('div', { class: 'cell', 'data-i': i }, h('span', { class: 'num' }), h('span', { class: 'ch' }));
      c._num = c.firstChild;
      c._ch = c.lastChild;
      cells.push(c);
      el.append(c);
    }
  }

  function idxAt(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const c = t && t.closest ? t.closest('.cell') : null;
    return c && el.contains(c) ? Number(c.dataset.i) : -1;
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const i = idxAt(e);
    if (i < 0) return;
    e.preventDefault();
    down = true;
    lastIdx = i;
    cb.down(i);
  });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const i = idxAt(e);
    if (i >= 0 && i !== lastIdx) {
      lastIdx = i;
      cb.move(i);
    }
  });
  const end = () => {
    if (!down) return;
    down = false;
    cb.up();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  /**
   * ctx: { puzzle, numbering, sel, wordCells:Set, mirrors:Set, warn:Set, flash:Set }
   */
  function update(ctx) {
    const { puzzle } = ctx;
    if (dims !== puzzle.rows + 'x' + puzzle.cols) build(puzzle.rows, puzzle.cols);
    puzzle.cells.forEach((cell, i) => {
      const el2 = cells[i];
      let cls = 'cell';
      if (cell.block) cls += ' block';
      if (cell.givenBlock) cls += ' locked';
      if (i === ctx.sel) cls += ' sel';
      else if (ctx.wordCells.has(i)) cls += ' word';
      if (ctx.mirrors.has(i) && i !== ctx.sel) cls += ' mirror';
      if (ctx.warn.has(i)) cls += ' warn';
      if (ctx.flash.has(i)) cls += ' flash';
      if (cell.givenLetter) cls += ' given';
      else if (cell.letter && cell.pencil) cls += ' pencil';
      let numText = '';
      if (!cell.block) {
        // Only the numbers printed in the puzzle and the ones the player typed. Nothing is
        // numbered automatically: working out where the numbers go is part of the puzzle.
        if (cell.givenNumber) {
          numText = String(cell.givenNumber);
          cls += ' printed-num';
        } else if (cell.userNumber) {
          numText = String(cell.userNumber);
          cls += ' user-num';
        }
      }
      if (el2.className !== cls) el2.className = cls;
      if (el2._num.textContent !== numText) el2._num.textContent = numText;
      const ch = cell.block ? '' : cell.letter;
      if (el2._ch.textContent !== ch) el2._ch.textContent = ch;
    });
  }

  return { el, build, update };
}
