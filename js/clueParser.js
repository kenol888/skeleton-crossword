// Free text (OCR output or a paste) -> { across, down, warnings }. Pure: no DOM.

const DIGITISH = '0-9lIOoSs';
// "(5)", "(3,4)", "(4-7)", "(l0)"; closing bracket optional at the end of a line
const ENUM_RE = new RegExp(`\\(\\s*([${DIGITISH}]+(?:\\s*[,\\-\\u2013.]\\s*[${DIGITISH}]+)*)\\s*(?:\\)|$)`, 'g');
const NUM_START_RE = /^\s*([0-9lIOo]{1,3})\s*[.):]?\s+(?=\S)/;

function fixDigits(s) {
  return s.replace(/[lI]/g, '1').replace(/[Oo]/g, '0').replace(/[Ss]/g, '5');
}

export function normaliseEnumeration(raw) {
  const fixed = fixDigits(raw).replace(/\s+/g, '').replace(/[–.]/g, (m) => (m === '.' ? ',' : '-'));
  // The comma in "(7,4)" is sometimes lost, leaving "74". No word is that long, so read it as separate
  // digits (7,4), which is what it nearly always was.
  if (/^\d{2,3}$/.test(fixed) && Number(fixed) > 30) return fixed.split('').join(',');
  return fixed;
}

function enumLength(en) {
  const parts = en.match(/\d+/g);
  return parts ? parts.reduce((a, b) => a + Number(b), 0) : 0;
}

function parseNumberToken(tok, hasEnum) {
  if (/\d/.test(tok)) {
    const n = Number(fixDigits(tok));
    return n > 0 && n < 200 ? n : null;
  }
  // only look-alike letters: accept l / I / II etc. when the segment has an enumeration
  if (hasEnum && /^[lI]{1,3}$/.test(tok)) return Number(fixDigits(tok));
  return null;
}

/** Split a line into segments, cutting after an enumeration if another numbered clue follows. */
function splitLine(line) {
  const segs = [];
  let start = 0;
  ENUM_RE.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = ENUM_RE.exec(line))) matches.push({ end: m.index + m[0].length });
  for (let k = 0; k < matches.length - 1; k++) {
    const rest = line.slice(matches[k].end);
    if (NUM_START_RE.test(rest)) {
      segs.push(line.slice(start, matches[k].end));
      start = matches[k].end;
    }
  }
  segs.push(line.slice(start));
  return segs.map((s) => s.trim()).filter(Boolean);
}

/** Pull "(enum)" off the end of a segment. */
function extractEnum(seg) {
  ENUM_RE.lastIndex = 0;
  let last = null;
  let m;
  while ((m = ENUM_RE.exec(seg))) last = m;
  if (!last) {
    // the opening bracket is sometimes lost: "... costume 5,5)" or "... town! 4,4)"
    const nm = seg.match(/(?:^|\s)([0-9]+(?:\s*[,\-\u2013]\s*[0-9]+)*)\s*\)\s*$/);
    if (nm) return { text: seg.slice(0, nm.index).trim(), en: normaliseEnumeration(nm[1]) };
    return { text: seg, en: '' };
  }
  const after = seg.slice(last.index + last[0].length).trim();
  const text = (seg.slice(0, last.index) + ' ' + after).trim();
  return { text, en: normaliseEnumeration(last[1]) };
}

export function parseClues(input) {
  const warnings = [];
  const out = { across: [], down: [], warnings };
  const lines = String(input || '').replace(/\r/g, '').split('\n');
  let section = null; // 'across' | 'down'
  let columns = null; // ['across','down'] or ['down','across'] for merged two-column text
  let pending = null; // clue being built (no enumeration yet)
  let last = null; // last completed/pending clue
  const lastNum = { across: 0, down: 0 };

  function finish() {
    pending = null;
  }
  function addClue(dir, number, text, en) {
    const clue = { number, text: text.trim(), enumeration: en, length: enumLength(en) };
    out[dir].push(clue);
    lastNum[dir] = number;
    last = clue;
    pending = en ? null : clue;
    return clue;
  }

  for (let raw of lines) {
    let line = raw.replace(/\t/g, ' ').trim();
    if (!line) continue;

    // headings
    const hasA = /\bacross\b/i.test(line);
    const hasD = /\bdown\b/i.test(line);
    const headingOnly = /^(clues\s+)?(across|down)(\s+(across|down))?\s*:?$/i.test(line);
    if (hasA && hasD && headingOnly) {
      columns = line.search(/across/i) < line.search(/down/i) ? ['across', 'down'] : ['down', 'across'];
      section = null;
      finish();
      continue;
    }
    const hm = line.match(/^(?:clues\s+)?(across|down)\b\s*:?\s*/i);
    if (hm) {
      section = hm[1].toLowerCase();
      columns = null;
      finish();
      line = line.slice(hm[0].length).trim();
      if (!line) continue;
    }

    const segs = splitLine(line);
    segs.forEach((seg, segIndex) => {
      const nm = seg.match(NUM_START_RE);
      let number = null;
      let body = seg;
      if (nm) {
        const hasEnum = extractEnum(seg).en !== '' && !pending;
        number = parseNumberToken(nm[1], hasEnum);
        if (number !== null) body = seg.slice(nm[0].length);
      }
      if (number === null) {
        // continuation of a wrapped clue
        const { text, en } = extractEnum(seg);
        if (pending) {
          const joiner = /-$/.test(pending.text) ? '' : ' ';
          pending.text = (pending.text + joiner + text).trim();
          if (en) {
            pending.enumeration = en;
            pending.length = enumLength(en);
            pending = null;
          }
        } else {
          warnings.push(`Unattached text ignored: "${seg.slice(0, 40)}"`);
        }
        return;
      }
      const { text, en } = extractEnum(body);
      let dir = section;
      if (columns) {
        if (segs.length > 1) dir = columns[Math.min(segIndex, 1)];
        else {
          // single segment in a two-column layout: pick the column this number continues
          const [c0, c1] = columns;
          const d0 = number - lastNum[c0];
          const d1 = number - lastNum[c1];
          if (d0 > 0 && (d1 <= 0 || d0 <= d1)) dir = c0;
          else if (d1 > 0) dir = c1;
          else dir = c0;
        }
      }
      if (!dir) {
        // no heading seen: switch to Down when numbering resets
        if (out.across.length && number < lastNum.across && !out.down.length) {
          warnings.push('No DOWN heading found; assumed Down starts at clue ' + number + '.');
          section = 'down';
          dir = 'down';
        } else {
          dir = out.down.length ? 'down' : 'across';
          if (!out.across.length && !out.down.length) warnings.push('No ACROSS heading found; assumed Across.');
        }
      }
      finish();
      addClue(dir, number, text, en);
    });
  }

  const anyCounts = [...out.across, ...out.down].some((c) => c.enumeration);
  for (const dir of ['across', 'down']) {
    out[dir].sort((a, b) => a.number - b.number);
    const seen = new Set();
    for (const c of out[dir]) {
      if (seen.has(c.number)) warnings.push(`Duplicate ${dir} clue ${c.number}.`);
      seen.add(c.number);
      // letter counts are optional (some papers do not print them), so only point out gaps
      if (!c.enumeration && anyCounts) warnings.push(`${c.number} ${dir === 'across' ? 'Across' : 'Down'} has no letter count.`);
      if (!c.text) warnings.push(`${c.number} ${dir === 'across' ? 'Across' : 'Down'} has no clue text.`);
    }
  }
  // numbers missing from both lists
  const all = new Set([...out.across, ...out.down].map((c) => c.number));
  const max = Math.max(0, ...all);
  const missing = [];
  for (let n = 1; n <= max; n++) if (!all.has(n)) missing.push(n);
  if (missing.length) warnings.push(`Clue number${missing.length > 1 ? 's' : ''} missing from both lists: ${missing.join(', ')}.`);
  return out;
}
