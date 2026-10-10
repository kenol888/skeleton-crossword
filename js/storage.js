// localStorage persistence. Every access is wrapped in try/catch; if storage is
// unavailable (private window, blocked site data) an in-memory fallback keeps the
// app working for the session.
import { progress } from './model.js';

const PUZZLE_PREFIX = 'skeleton:puzzle:';
const INDEX_KEY = 'skeleton:index';
const SETTINGS_KEY = 'skeleton:settings';

const memory = new Map();
let storageOk = null;

function ls() {
  try {
    const s = window.localStorage;
    if (storageOk === null) {
      s.setItem('skeleton:probe', '1');
      s.removeItem('skeleton:probe');
      storageOk = true;
    }
    return s;
  } catch (e) {
    storageOk = false;
    return null;
  }
}

export function storageAvailable() {
  ls();
  return storageOk === true;
}

function rawGet(key) {
  const s = ls();
  if (s) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch (e) { /* fall through to memory */ }
  }
  return memory.has(key) ? memory.get(key) : null;
}

/** @returns {{ok:boolean, quota:boolean}} */
function rawSet(key, value) {
  const s = ls();
  if (s) {
    try {
      s.setItem(key, value);
      memory.delete(key);
      return { ok: true, quota: false };
    } catch (e) {
      memory.set(key, value);
      const quota = !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      return { ok: false, quota };
    }
  }
  memory.set(key, value);
  return { ok: false, quota: false };
}

function rawRemove(key) {
  memory.delete(key);
  const s = ls();
  if (s) {
    try { s.removeItem(key); } catch (e) { /* ignore */ }
  }
}

export function loadIndex() {
  try {
    const v = JSON.parse(rawGet(INDEX_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function saveIndex(list) {
  return rawSet(INDEX_KEY, JSON.stringify(list));
}

export function savePuzzle(p) {
  p.updatedAt = Date.now();
  const res = rawSet(PUZZLE_PREFIX + p.id, JSON.stringify({ version: 1, ...p }));
  const idx = loadIndex().filter((e) => e.id !== p.id);
  idx.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, createdAt: p.createdAt, rows: p.rows, cols: p.cols, progress: progress(p) });
  saveIndex(idx);
  return res;
}

export function loadPuzzleRaw(id) {
  try {
    const v = rawGet(PUZZLE_PREFIX + id);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

export function deletePuzzle(id) {
  rawRemove(PUZZLE_PREFIX + id);
  saveIndex(loadIndex().filter((e) => e.id !== id));
}

const DEFAULT_SETTINGS = {
  layoutFeedback: false,
  skipFilled: false,
  moveSolvedDown: false,
  showTimer: true,
  keyboard: 'auto', // 'auto' shows it when you tap a square, 'always', or 'never'
};

export function loadSettings() {
  try {
    const saved = JSON.parse(rawGet(SETTINGS_KEY) || '{}');
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    // older versions had a plain on/off switch
    if (!('keyboard' in saved)) merged.keyboard = saved.showKeyboard === false ? 'never' : 'auto';
    return merged;
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

export function saveSettings(s) {
  return rawSet(SETTINGS_KEY, JSON.stringify(s));
}
