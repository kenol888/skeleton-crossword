// Across / Down clue lists with automatic and manual crossing off.
import { h } from './dom.js';
import { slotFilled } from '../model.js';

/** A clue is done when ticked by hand, or when its word is filled in and the length fits. */
export function entryDone(puzzle, entry) {
  if (entry.clue.manualDone) return true;
  return !!entry.slot && entry.status === 'ok' && slotFilled(puzzle, entry.slot);
}

const CHIP = {
  ok: ['ok', 'Placed'],
  'length-mismatch': ['bad', 'Length differs'],
  missing: ['none', 'No number yet'],
  misplaced: ['bad', 'Not a word start'],
};

export function createClueLists({ onSelect, onToggle }) {
  const root = h('div', { class: 'clue-lists' });
  const cols = {};
  for (const dir of ['across', 'down']) {
    const title = h('h3', { class: 'clue-head' });
    const list = h('ol', { class: 'clue-list', 'aria-label': dir });
    cols[dir] = { title, list, box: h('section', { class: 'clue-col' }, title, list) };
    root.append(cols[dir].box);
  }

  function update({ puzzle, matches, activeKey, settings }) {
    for (const dir of ['across', 'down']) {
      const col = cols[dir];
      let entries = matches[dir].map((e) => ({ ...e, done: entryDone(puzzle, e) }));
      const doneCount = entries.filter((e) => e.done).length;
      col.title.textContent = '';
      col.title.append(h('span', null, dir === 'across' ? 'Across' : 'Down'), h('span', { class: 'count' }, `${doneCount}/${entries.length}`));
      if (settings.moveSolvedDown) entries = [...entries.filter((e) => !e.done), ...entries.filter((e) => e.done)];
      const prevScroll = col.list.scrollTop;
      col.list.textContent = '';
      let activeEl = null;
      for (const e of entries) {
        const key = dir + ':' + e.clue.number;
        const active = key === activeKey;
        const li = h(
          'li',
          { class: 'clue' + (e.done ? ' done' : '') + (active ? ' active' : '') + (settings.layoutFeedback && e.status === 'length-mismatch' ? ' warn' : '') },
          h('button', {
            class: 'tick',
            type: 'button',
            'aria-label': (e.clue.manualDone ? 'Mark not done: ' : 'Mark done: ') + e.clue.number + ' ' + dir,
            'aria-pressed': e.clue.manualDone ? 'true' : 'false',
            onclick: () => onToggle(dir, e.clue.number),
          }),
          h(
            'button',
            { class: 'clue-main', type: 'button', onclick: () => onSelect(dir, e.clue.number) },
            h('span', { class: 'cn' }, e.clue.number),
            h('span', { class: 'ct' }, e.clue.text),
            h('span', { class: 'ce' }, e.clue.enumeration ? `(${e.clue.enumeration})` : '')
          ),
          settings.layoutFeedback ? h('span', { class: 'chip ' + CHIP[e.status][0] }, CHIP[e.status][1]) : null
        );
        if (active) activeEl = li;
        col.list.append(li);
      }
      col.list.scrollTop = prevScroll;
      if (activeEl) {
        const top = activeEl.offsetTop;
        const bottom = top + activeEl.offsetHeight;
        if (top < col.list.scrollTop) col.list.scrollTop = top - 8;
        else if (bottom > col.list.scrollTop + col.list.clientHeight) col.list.scrollTop = bottom - col.list.clientHeight + 8;
      }
    }
  }

  return { root, update };
}
