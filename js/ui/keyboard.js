// On-screen keyboard so the iPad system keyboard never covers the grid. It switches between
// letters and a number pad, depending on what the selected square is being given.
import { h } from './dom.js';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const PAD = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];

export function createKeyboard(cb) {
  const root = h('div', { class: 'kb', role: 'group', 'aria-label': 'Keyboard' });
  root.append(h('div', { class: 'kb-head' }, h('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Hide keyboard', onclick: () => cb.hide() }, 'Hide keyboard ⌄')));
  // pointerdown + preventDefault keeps focus where it is and reacts instantly on touch
  const press = (fn) => (e) => {
    e.preventDefault();
    fn();
  };
  const key = (label, cls, fn, aria) =>
    h('button', { class: 'key ' + cls, type: 'button', 'aria-label': aria || label, onpointerdown: press(fn), onclick: (e) => e.detail === 0 && fn() }, label);

  const letters = h('div', { class: 'kb-letters' });
  ROWS.forEach((row, r) => {
    const line = h('div', { class: 'kb-row' });
    for (const ch of row) line.append(key(ch, 'letter', () => cb.letter(ch)));
    if (r === 2) line.append(key('⌫', 'wide', cb.backspace, 'Backspace'));
    letters.append(line);
  });

  const numbers = h('div', { class: 'kb-numbers' });
  PAD.forEach((row) => numbers.append(h('div', { class: 'kb-row' }, row.map((d) => key(d, 'letter', () => cb.digit(d))))));
  numbers.append(h('div', { class: 'kb-row' }, key('⌫', 'letter', cb.backspace, 'Backspace'), key('0', 'letter', () => cb.digit('0')), key('Done', 'tool', cb.done, 'Done typing the number')));

  const dirKey = key('Across', 'tool dir', cb.toggleDir, 'Switch direction');
  const pencilKey = key('Pencil', 'tool', cb.togglePencil, 'Pencil');
  const prevKey = key('‹ Clue', 'tool', cb.prev, 'Previous clue');
  const nextKey = key('Clue ›', 'tool', cb.next, 'Next clue');
  const tools = h('div', { class: 'kb-row tools' }, prevKey, dirKey, pencilKey, nextKey);
  root.append(letters, numbers, tools);

  function setState({ dir, pencil, input }) {
    letters.hidden = input === 'number';
    numbers.hidden = input !== 'number';
    tools.hidden = input === 'number'; // the number pad has its own Done key
    dirKey.textContent = dir === 'across' ? 'Across →' : 'Down ↓';
    pencilKey.classList.toggle('on', !!pencil);
    pencilKey.setAttribute('aria-pressed', pencil ? 'true' : 'false');
  }

  return { el: root, setState };
}
