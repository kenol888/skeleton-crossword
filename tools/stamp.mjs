// Run this before each push: node tools/stamp.mjs   (add --keep to keep the current number)
// Raises the version number and records the time, and lists the files the app needs, in:
//   version.json   fetched fresh by the home screen and by the offline worker: version, time, files
//   js/version.js  the version this copy of the code is
//   sw.js          the offline cache name, so installed copies refresh instead of mixing old and new files
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const write = (p, s) => writeFileSync(new URL(p, root), s);

// everything the running app loads. Not in the list: the worker itself (the browser handles
// that), version.json (always fetched fresh), and development files.
const SKIP_DIRS = new Set(['.git', '.local-test', '.claude', 'node_modules', 'tests', 'tools', 'samples']);
const SKIP_FILES = new Set(['sw.js', 'version.json', 'PLAN.md', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore', '.nojekyll', 'package.json']);

function listFiles(dir = '') {
  const out = [];
  for (const name of readdirSync(new URL(dir, root)).sort()) {
    const rel = dir + name;
    if (statSync(new URL(rel, root)).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...listFiles(rel + '/'));
    } else if (!SKIP_FILES.has(name)) out.push(rel);
  }
  return out;
}

const current = JSON.parse(read('version.json'));
// --keep refreshes the time and file list without raising the number (to re-stamp just before a push)
const version = process.argv.includes('--keep') ? current.version : current.version + 1;
const built = new Date().toISOString();
const files = listFiles();

// version.js must be on the list and must say the new version before the list is written
write('js/version.js', `// Written by tools/stamp.mjs. Do not edit by hand.\nexport const VERSION = ${version};\nexport const BUILT = '${built}';\n`);
write('version.json', JSON.stringify({ version, built, files }, null, 2) + '\n');

const sw = read('sw.js');
if (!/const CACHE = 'skeleton-v\d+';/.test(sw)) throw new Error('could not find the CACHE line in sw.js');
write('sw.js', sw.replace(/const CACHE = 'skeleton-v\d+';/, `const CACHE = 'skeleton-v${version}';`));

console.log(`stamped version ${version} at ${built} (${files.length} files)`);
