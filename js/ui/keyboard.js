// On-screen keyboard so the iPad system keyboard never covers the grid.
import { h } from './dom.js';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function createKeyboard(cb) {
  const root = h('div', { class: 'kb', role: 'group', 'aria-label': 'Keyboard' });
  // pointerdown + preventDefault keeps focus where it is and reacts instantly on touch
  const press = (fn) => (e) => {
    e.preventDefault();
    fn();
  };
  const key = (label, cls, fn, aria) =>
    h('button', { class: 'key ' + cls, type: 'button', 'aria-label': aria || label, onpointerdown: press(fn), onclick: (e) => e.detail === 0 && fn() }, label);

  ROWS.forEach((row, r) => {
    const line = h('div', { class: 'kb-row' });
    for (const ch of row) line.append(key(ch, 'letter', () => cb.letter(ch)));
    if (r === 2) line.append(key('⌫', 'wide', cb.backspace, 'Backspace'));
    root.append(line);
  });

  const dirKey = key('Across', 'tool dir', cb.toggleDir, 'Switch direction');
  const pencilKey = key('Pencil', 'tool', cb.togglePencil, 'Pencil');
  const modeKey = key('Squares', 'tool', cb.toggleMode, 'Edit black squares');
  const prevKey = key('‹ Clue', 'tool', cb.prev, 'Previous clue');
  const nextKey = key('Clue ›', 'tool', cb.next, 'Next clue');
  root.append(h('div', { class: 'kb-row tools' }, prevKey, dirKey, pencilKey, modeKey, nextKey));

  function setState({ dir, pencil, mode }) {
    dirKey.textContent = dir === 'across' ? 'Across →' : 'Down ↓';
    pencilKey.classList.toggle('on', !!pencil);
    pencilKey.setAttribute('aria-pressed', pencil ? 'true' : 'false');
    modeKey.classList.toggle('on', mode === 'blocks');
    modeKey.setAttribute('aria-pressed', mode === 'blocks' ? 'true' : 'false');
  }

  return { el: root, setState };
}
