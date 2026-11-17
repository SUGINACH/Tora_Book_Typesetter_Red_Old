// tools/s5-capture-baseline.js — capture per-block line division of the CURRENT
// path (main, after Stage 4b merge) for the Stage 5 corpus comparison (הוראה §16
// — אותה משמעת: בסיס נתפס לפני השינוי, דוח פר-פריט אחריו).
// Usage: node tools/s5-capture-baseline.js <out.json>
'use strict';
const fs = require('fs');
const path = require('path');
const { typeset } = require('../red-build/src/engine/core/pipeline');
const { getDefaultSettings } = require('../red-build/src/engine/core/settings-registry');

const ROOT = path.join(__dirname, '..');

function capture(file, settings) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const t0 = Date.now();
  const res = typeset(raw, settings);
  const blocks = [];
  const seen = new Map(); // tokenId -> block record
  const lineOf = (pg) => [
    ...(pg.spanning ? pg.spanning.lines : []),
    ...pg.columns.flatMap(c => c)
  ];
  for (const pg of res.pages) {
    for (const ln of lineOf(pg)) {
      const tok = ln.tokenId != null ? ln.tokenId : (ln.meta && ln.meta.tokenId);
      if (tok == null) continue;
      if (!seen.has(tok)) { seen.set(tok, { tokenId: tok, kind: ln.kind || 'paragraph', lines: [] }); blocks.push(seen.get(tok)); }
      const b = seen.get(tok);
      b.lines.push((ln.words || []).map(w => String(w).replace(/\u00A0/g, '\u00A0')));
    }
  }
  return {
    file,
    pages: res.pages.length,
    layoutHash: res.layoutHash.slice(0, 16),
    contentPreserved: res.contentPreserved,
    blocks,
    ms: Date.now() - t0
  };
}

const corpora = [
  { file: 'red-build/tests/fixtures/canonical_corpus.txt', key: 'canonical' },
  { file: 'audits/very_long_test_text.txt', key: 'very_long' }
];
const out = { schema: 's5-main-baseline-v1', note: 'נלכד מ-main (dfb4168 — אחרי מיזוג שלב 4 מקטע ב׳) לפני פרוסה 1 של שלב 5 — בסיס ההשוואה פר-פריט (הוראה §16)', corpora: {} };
for (const c of corpora) {
  if (!fs.existsSync(path.join(ROOT, c.file))) { console.error('missing:', c.file); continue; }
  out.corpora[c.key] = capture(c.file, getDefaultSettings());
  console.log(`${c.key}: pages=${out.corpora[c.key].pages} hash=${out.corpora[c.key].layoutHash} blocks=${out.corpora[c.key].blocks.length} (${out.corpora[c.key].ms}ms)`);
}
fs.writeFileSync(process.argv[2] || path.join(ROOT, 'red-build', 'tests', 'artifacts', 's5-main-baseline.json'), JSON.stringify(out));
console.log('written:', process.argv[2] || path.join(ROOT, 'red-build', 'tests', 'artifacts', 's5-main-baseline.json'));
