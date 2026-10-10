// Light mode is the default. Dark mode is a setting, not something that follows the device.
import { loadSettings, saveSettings } from './storage.js';
import { h, dialog } from './ui/dom.js';

const BAR = { light: '#e9edf2', dark: '#11151b' };

export function currentTheme() {
  return loadSettings().theme === 'dark' ? 'dark' : 'light';
}

/** Puts the theme on the page. index.html does the same on its own first to avoid a flash. */
export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BAR[t]);
}

/**
 * The Appearance row for a settings dialog. Pass the settings object the caller keeps (so a
 * later save of it does not bring back the old theme); without one it loads and saves its own.
 */
export function themeRow(settings = loadSettings()) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Appearance' });
  [['light', 'Light'], ['dark', 'Dark']].forEach(([k, label]) => {
    const b = h('button', { type: 'button', class: 'seg-btn' + ((settings.theme === 'dark' ? 'dark' : 'light') === k ? ' on' : ''), onclick: () => {
      settings.theme = k;
      saveSettings(settings);
      applyTheme(k);
      [...seg.children].forEach((x) => x.classList.toggle('on', x === b));
    } }, label);
    seg.append(b);
  });
  return h('div', { class: 'switch-row stack' }, h('span', { class: 'sw-text' }, h('strong', null, 'Appearance'), h('small', null, 'Light is the default.')), seg);
}

/** The settings available from the home screen. */
export function openAppSettings() {
  return dialog({ title: 'Settings', body: h('div', { class: 'settings' }, themeRow()), buttons: [{ label: 'Done', value: true, primary: true }] });
}
