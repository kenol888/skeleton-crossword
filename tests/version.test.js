import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// tools/stamp.mjs writes these together. If someone edits one by hand the home screen
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

test('the file list in version.json is complete and every file exists', () => {
  const { files } = JSON.parse(read('version.json'));
  assert.ok(Array.isArray(files) && files.length > 10);
  for (const f of files) assert.ok(existsSync(new URL('../' + f, import.meta.url)), `${f} exists`);
  for (const must of ['index.html', 'manifest.webmanifest', 'css/styles.css', 'js/main.js', 'js/version.js', 'js/play.js', 'js/importFlow.js']) {
    assert.ok(files.includes(must), `${must} is listed`);
  }
  // every module the app imports from js/ must be listed, or it would be missing offline
  const importRe = /from '\.\/([\w./-]+\.js)'/g;
  for (const f of files.filter((x) => x.startsWith('js/') && x.endsWith('.js'))) {
    const dir = f.includes('/ui/') ? 'js/ui/' : 'js/';
    for (const m of read(f).matchAll(importRe)) {
      const target = m[1].startsWith('../') ? m[1].slice(3) : dir + m[1];
      assert.ok(files.includes(target.replace('js/ui/../', 'js/')), `${f} imports ${m[1]} which must be in the list`);
    }
  }
  assert.ok(!files.includes('sw.js') && !files.includes('version.json'), 'the worker and version.json are never cached');
});

test('the service worker takes its file list from version.json and skips the browser cache', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'version.json?t='"), 'install reads the published file list');
  assert.ok(sw.includes("cache: 'reload'"), 'install bypasses the browser cache');
  assert.ok(sw.includes("endsWith('/version.json')"), 'version.json is never answered from the store');
  assert.ok(!sw.includes('SHELL'), 'no hand-kept file list to forget to update');
});
