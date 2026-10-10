import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// tools/stamp.mjs writes these three together. If someone edits one by hand the home screen
// would lie about the version, or installed copies would not refresh.
test('version.json, js/version.js and the service worker cache name agree', () => {
  const json = JSON.parse(read('version.json'));
  const js = read('js/version.js');
  const sw = read('sw.js');
  assert.ok(Number.isInteger(json.version) && json.version >= 1);
  assert.ok(!Number.isNaN(Date.parse(json.built)), 'built is a date');
  assert.match(js, new RegExp(`VERSION = ${json.version};`));
  assert.ok(js.includes(`BUILT = '${json.built}'`));
  assert.match(sw, new RegExp(`const CACHE = 'skeleton-v${json.version}';`));
});

test('the service worker caches js/version.js but never version.json', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'js/version.js'"));
  assert.ok(sw.includes("endsWith('/version.json')"));
  assert.ok(!sw.includes("'version.json'"), 'version.json must not be in the precache list');
});
