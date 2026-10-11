// Tiny DOM helpers, toast and in-page dialogs (never alert/confirm/prompt).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let toastTimer = null;
export function toast(message, ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, ms);
}

export function clearToast() {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.classList.remove('show');
  el.hidden = true;
}

/**
 * In-page modal dialog.
 * buttons: [{label, value, primary, danger}]. Resolves with the pressed value (or null on dismiss).
 * `body` may be a Node or string. Returns { promise, close(value), el }.
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], dismissible = true, wide = false }) {
  const root = document.getElementById('modal-root');
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const previouslyFocused = document.activeElement;
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const bodyEl = h('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.textContent = body;
  else if (body) bodyEl.append(body);
  const foot = h('div', { class: 'modal-foot' });
  function close(value = null) {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (previouslyFocused && previouslyFocused.focus) {
      try { previouslyFocused.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    resolve(value);
  }
  function onKey(e) {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      close(null);
    }
  }
  buttons.forEach((b) => {
    foot.append(
      h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), type: 'button', onclick: () => close(b.value) }, b.label)
    );
  });
  box.append(title ? h('h2', { class: 'modal-title' }, title) : null, bodyEl, buttons.length ? foot : null);
  overlay.append(box);
  if (dismissible) overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(null); });
  root.append(overlay);
  document.addEventListener('keydown', onKey, true);
  const first = foot.querySelector('.primary') || foot.querySelector('button');
  if (first) first.focus({ preventScroll: true });
  return { promise, close, el: box, bodyEl };
}

/** A list of big tappable actions in a dialog. items: [{ label, hint?, run, danger? }] */
export function actionSheet(title, items) {
  const body = h('div', { class: 'sheet' });
  const d = dialog({ title, body, buttons: [{ label: 'Close', value: null }] });
  items.forEach((it) =>
    body.append(
      h(
        'button',
        { class: 'sheet-item' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { d.close(); it.run(); } },
        h('span', { class: 'si-label' }, it.label),
        it.hint ? h('span', { class: 'si-hint' }, it.hint) : null
      )
    )
  );
  return d;
}

export function modalOpen() {
  return !!document.querySelector('#modal-root .modal-overlay');
}

/** Yes/no confirmation. Resolves true/false. */
export function confirmDialog(title, message, confirmLabel = 'OK', danger = false) {
  return dialog({
    title,
    body: message,
    buttons: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, value: true, primary: !danger, danger },
    ],
  }).promise.then((v) => v === true);
}

/** Single-line text input dialog. Resolves with the string or null. */
export function inputDialog(title, label, value = '', { inputmode, maxlength, okLabel = 'OK' } = {}) {
  const input = h('input', { type: 'text', class: 'text-input', value, inputmode, maxlength, 'aria-label': label });
  const body = h('label', { class: 'field' }, h('span', null, label), input);
  const d = dialog({
    title,
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: okLabel, value: 'ok', primary: true },
    ],
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') d.close('ok');
  });
  // focus straight away, still inside the tap that opened the dialog: iPad only shows the keyboard for that
  input.focus({ preventScroll: true });
  input.select();
  setTimeout(() => { if (document.activeElement !== input) { input.focus(); input.select(); } }, 30);
  return d.promise.then((v) => (v === 'ok' ? input.value : null));
}
