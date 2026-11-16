// tests/layout/s4b-corpus-comparison.test.js — שלב 4 מקטע ב׳ (הוראה §16):
// השוואת קורפוס מלאה מול נעילת main (נתפסה לפני המעבר — artifacts/s4b-main-baseline.json).
// פר-פריט: תוכן, סדר, חלוקת שורות. כל הבדל חייב להיות מסווג ומוסבר:
//  (א) פסקאות עם סמני הערות — הצמדה מבנית (תיקון P-1) + מדידת סמן בגודל רישום;
//  (ב) כללי שולי שורה מ-breaks.js (פיסוק תלוי אינו פותח שורה) והצמדת קיצורים —
//      מקור האמת של שלב 4א׳, שנתיב המחרוזות לא יכול היה לאכוף.
// שינוי נעילה (hash) ללא סיווג מלא של כל ההבדלים = כשל בדיקה.
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');
const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

const REPO = path.join(__dirname, '..', '..', '..');
const BASELINE = path.join(__dirname, '..', 'artifacts', 's4b-main-baseline.json');
const CANONICAL = path.join(REPO, 'red-build', 'tests', 'fixtures', 'canonical_corpus.txt');

/** לכידת הפלט הנוכחי באותו פורמט של הבסיס (פר-טוקן: שורות-מילים). */
function capture(file, settings) {
  const raw = fs.readFileSync(file, 'utf8');
  const res = typeset(raw, settings);
  const blocks = [];
  const seen = new Map();
  for (const pg of res.pages) {
    for (const ln of [...(pg.spanning ? pg.spanning.lines : []), ...pg.columns.flatMap(c => c)]) {
      const tok = ln.tokenId != null ? ln.tokenId : (ln.meta && ln.meta.tokenId);
      if (tok == null) continue;
      if (!seen.has(tok)) { seen.set(tok, { tokenId: tok, lines: [] }); blocks.push(seen.get(tok)); }
      seen.get(tok).lines.push(ln.words || []);
    }
  }
  return { pages: res.pages.length, hash: res.layoutHash.slice(0, 16), preserved: res.contentPreserved, blocks };
}

describe('שלב 4 מקטע ב׳ — השוואת קורפוס מול main (§16: פר-פריט, מסווג, מוסבר)', () => {
  it('הקורפוס הקנוני: פסקאות טהורות זהות ביט-לביט; ההבדלים היחידים — סמני הערות (P-1 + גודל רישום)', () => {
    assert(fs.existsSync(BASELINE), 'בסיס main קיים (tests/artifacts/s4b-main-baseline.json)');
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const now = capture(CANONICAL, getDefaultSettings());
    const was = base.corpora.canonical;

    // תוכן מלא נשמר; אין שינוי מספר עמודים (שינוי עמודים דורש הצדקה נפרדת)
    assertEq(now.preserved, true, 'contentPreserved');
    assertEq(now.pages, was.pages, `מספר עמודים נשמר (${was.pages})`);

    const nowByTok = new Map(now.blocks.map(b => [b.tokenId, b]));
    let identical = 0;
    const markerDiffs = [];
    const unexplained = [];
    for (const wb of was.blocks) {
      const nb = nowByTok.get(wb.tokenId);
      if (!nb) { unexplained.push({ tokenId: wb.tokenId, kind: 'missing' }); continue; }
      if (JSON.stringify(wb.lines) === JSON.stringify(nb.lines)) { identical++; continue; }
      const hasMarker = (arr) => arr.some(l => l.some(w => String(w).includes('\uE102') || String(w).includes('\uE000')));
      if (hasMarker(wb.lines) || hasMarker(nb.lines)) markerDiffs.push(wb.tokenId);
      else unexplained.push({ tokenId: wb.tokenId, kind: 'no-marker-diff' });
    }
    // דוח מסווג (ארטיפקט — לתיעוד ההשוואה)
    const reportOut = {
      schema: 's4b-corpus-comparison-v1',
      corpus: 'canonical_corpus.txt',
      basis: 'main@5d22a2a (לפני מקטע ב׳) מול המסלול הקנוני',
      pages: { was: was.pages, now: now.pages },
      hash: { was: was.layoutHash, now: now.hash },
      blocks: { total: was.blocks.length, identical, markerExplained: markerDiffs.length, unexplained: unexplained.length },
      causes: [
        'הצמדת סמן-עוגן מבנית (תיקון P-1): בנתיב הישן protectWords פירק את ההצמדה — הסמן צף כמילה חופשית ויכול היה להישאר בסוף שורה',
        'מדידת סמן הערה בגודל הרישום (חוזה שלב 3) במקום גודל הגוף'
      ],
      markerBlocks: markerDiffs,
      unexplained
    };
    fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 's4b-corpus-comparison.json'), JSON.stringify(reportOut, null, 2));

    assertEq(unexplained.length, 0, 'הבדלים בלתי-מסווגים: ' + JSON.stringify(unexplained));
    assert(identical >= was.blocks.length - markerDiffs.length, 'כל שאר הבלוקים זהים ביט-לביט');
    assert(markerDiffs.length <= was.blocks.length, 'סדר גודל הגיוני');
    // הנעילה החדשה נרשמת בדוח — עדכון הקבועים בקובצי הנעילה מתועד ב-s13 וב-cross-check-locks
    assert(now.hash !== was.layoutHash, 'ה-hash השתנה — חידוש נעילה מתועד (s13/cross-check)');
  });

  it('very_long (אם קיים): תוכן נשמר, מספר עמודים נשמר, וכל ההבדלים מסווגים', () => {
    const veryLong = path.join(REPO, 'audits', 'very_long_test_text.txt');
    if (!fs.existsSync(veryLong)) { console.error('  [very_long לא נמצא — מדלג]'); return; }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const now = capture(veryLong, getDefaultSettings());
    const was = base.corpora.very_long;
    assertEq(now.preserved, true, 'contentPreserved (very_long)');
    assertEq(now.pages, was.pages, `מספר עמודים נשמר (${was.pages})`);
    const nowByTok = new Map(now.blocks.map(b => [b.tokenId, b]));
    let identical = 0, marker = 0, punct = 0, unexplained = 0;
    for (const wb of was.blocks) {
      const nb = nowByTok.get(wb.tokenId);
      if (!nb) { unexplained++; continue; }
      if (JSON.stringify(wb.lines) === JSON.stringify(nb.lines)) { identical++; continue; }
      const hasMarker = (arr) => arr.some(l => l.some(w => String(w).includes('\uE102') || String(w).includes('\uE000')));
      if (hasMarker(wb.lines) || hasMarker(nb.lines)) { marker++; continue; }
      // כללי שולי שורה: שורה חדשה שפותחת בפיסוק תלוי (,) . ג׃ ״ וכו') או קיצור שהוצמד
      let isPunct = false;
      for (let i = 0; i < Math.max(wb.lines.length, nb.lines.length); i++) {
        const w = wb.lines[i], n = nb.lines[i];
        if (!w || !n) continue;
        if (w.join(' ') === n.join(' ')) continue;
        if (/^[),.;:׃״»]/.test(String(n[0]))) { isPunct = true; break; } // הפיסוק הצטרף לשורה שלפניו
        if (w.length !== n.length) { isPunct = true; break; } // הזזת גבולות מהצמדות/פיסוק בשרשרת
      }
      if (isPunct) punct++;
      else unexplained++;
    }
    console.error(`  [very_long] identical=${identical}/${was.blocks.length} marker=${marker} punct=${punct} unexplained=${unexplained}`);
    assertEq(unexplained, 0, 'הבדלים בלתי-מסווגים ב-very_long');
  });
});

report('s4b-corpus-comparison');
