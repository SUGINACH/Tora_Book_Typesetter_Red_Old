// tools/audit-note-anchors.js — §3.2 בדיקת הצמדת הערות לעוגנים על main (ממצא ייחודי מ-PR #16)
'use strict';
/**
 * בודק על קורפוס נתון שכל הערת-שוליים מוצגת בעמוד שבו נמצא הסמן שלה — או מאוחר
 * יותר ממנו (העברה קדימה אסורה: הערה לפני העוגן — שורש PR #16).
 *
 * שיטה: לכל הערה ב-page.footnotes מוצאים את שורת הסמן שלה בפועל — השורה שמילותיה
 * מכילות את תג הסמן (MARK_TAG \uE102) עם הסמן של אותה הערה, בטוקן העוגן שלה —
 * ומשווים אינדקסי עמודים. כולל המשכים (continuationOf) ופיצולי פסקה.
 *
 * שימוש: node tools/audit-note-anchors.js [corpus-path ...]
 * ברירת מחדל: audits/canonical_corpus + long_test_text + very_long_test_text.
 */
const path = require('path');
const fs = require('fs');
const { typeset } = require('../red-build/src/engine/core/pipeline');
const { getDefaultSettings } = require('../red-build/src/engine/core/settings-registry');
const { MARK_TAG } = require('../red-build/src/engine/notes/markers');

const REPO = path.resolve(__dirname, '..');

/** שורת הסמן של הערה: שורה בטוקן העוגן שמילותיה מכילות anchor+NBSP+MARK_TAG+סמן. */
function markerLineIndexOf(pages, note) {
  const anchorTok = note.tokenId != null ? String(note.tokenId)
    : (note.anchorId != null ? String(note.anchorId) : null);
  const marker = String(note.marker != null ? note.marker : '');
  if (!anchorTok) return null;
  for (const page of pages) {
    for (const col of (page.columns || [])) {
      for (let li = 0; li < col.length; li++) {
        const ln = col[li];
        const tok = ln.tokenId != null ? String(ln.tokenId) : (ln.meta && ln.meta.tokenId != null ? String(ln.meta.tokenId) : null);
        if (tok !== anchorTok) continue;
        for (const w of (ln.words || [])) {
          const s = String(w);
          if (!s.includes(MARK_TAG)) continue;
          // הסמן של הערה זו בדיוק (אחרי התג) — או כל סמן בטוקן כשאין סמן ידוע
          if (!marker || s.includes(MARK_TAG + marker) || s.split(MARK_TAG).pop() === marker) {
            return { page: page.index, line: li };
          }
        }
      }
    }
  }
  return null;
}

function auditCorpus(name, text, settings) {
  const r = typeset(text, settings, { noRecommendations: true });
  const violations = [];
  let notes = 0, continuations = 0, matched = 0;
  for (const page of r.pages) {
    for (const n of (page.footnotes || [])) {
      notes++;
      if (n.isContinuation === true || n.mode === 'split-rest' || n.continuationOf) continuations++;
      const markerAt = markerLineIndexOf(r.pages, n);
      if (!markerAt) { violations.push({ kind: 'marker-not-found', note: n.noteId || n.tokenId, notePage: page.index }); continue; }
      matched++;
      if (page.index < markerAt.page) {
        violations.push({ kind: 'note-before-anchor', note: n.noteId || String(n.tokenId), marker: n.marker, notePage: page.index, markerPage: markerAt.page, continuationOf: n.continuationOf || null });
      }
    }
  }
  return { name, pages: r.pages.length, notes, continuations, matched, violations, layoutHash: r.layoutHash };
}

const corpora = [];
const args = process.argv.slice(2);
if (args.length) {
  for (const a of args) corpora.push({ name: path.basename(a), text: fs.readFileSync(a, 'utf8') });
} else {
  const defaults = [
    'red-build/tests/fixtures/canonical_corpus.txt',
    'audits/long_test_text.txt',
    'audits/very_long_test_text.txt'
  ];
  for (const d of defaults) {
    const p = path.join(REPO, d);
    if (fs.existsSync(p)) corpora.push({ name: d, text: fs.readFileSync(p, 'utf8') });
    else console.log(`(skip — not found: ${d})`);
  }
}

let totalViolations = 0;
for (const c of corpora) {
  const res = auditCorpus(c.name, c.text, getDefaultSettings());
  totalViolations += res.violations.length;
  console.log(`\n== ${res.name} ==`);
  console.log(`pages: ${res.pages}, footnotes: ${res.notes} (continuations: ${res.continuations}), marker-matched: ${res.matched}`);
  console.log(`violations: ${res.violations.length}`);
  for (const v of res.violations.slice(0, 20)) console.log('  ', JSON.stringify(v));
  if (res.violations.length > 20) console.log(`   … +${res.violations.length - 20} more`);
}
console.log(`\nTOTAL violations: ${totalViolations}`);
process.exit(totalViolations ? 1 : 0);
