// Run this before each push: node tools/stamp.mjs
// Raises the version number and records the time, in the three places that need to agree:
//   version.json   fetched fresh by the home screen to learn the latest published version
//   js/version.js  the version this copy of the code is
//   sw.js          the offline cache name, so installed copies refresh instead of mixing old and new files
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const write = (p, s) => writeFileSync(new URL(p, root), s);

const current = JSON.parse(read('version.json'));
const version = current.version + 1;
const built = new Date().toISOString();

write('version.json', JSON.stringify({ version, built }, null, 2) + '\n');
write('js/version.js', `// Written by tools/stamp.mjs. Do not edit by hand.\nexport const VERSION = ${version};\nexport const BUILT = '${built}';\n`);

const sw = read('sw.js');
if (!/const CACHE = 'skeleton-v\d+';/.test(sw)) throw new Error('could not find the CACHE line in sw.js');
write('sw.js', sw.replace(/const CACHE = 'skeleton-v\d+';/, `const CACHE = 'skeleton-v${version}';`));

console.log(`stamped version ${version} at ${built}`);
