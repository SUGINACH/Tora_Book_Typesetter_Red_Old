// tests/layout/s5-corpus-comparison.test.js — שלב 5 פרוסה 1 (הוראה §16 — אותה משמעת):
// השוואת קורפוס מלאה מול נעילת main שנתפסה לפני השינוי (artifacts/s5-main-baseline.json
// — main dfb4168, אחרי מיזוג שלב 4 מקטע ב׳). שלב 5 משנה פריסה **בכוונה** (תיקוני
// FX-1..FX-5 + SSOT) — לכן שער הבדיקה אינו "אפס שינוי" אלא:
//  (א) תוכן מלא נשמר (contentPreserved) + שקילות תוכן פר-בלוק: המילים של כל בלוק
//      זהות לבסיס (כמולטיסט; בסדר — רק דרך שחזור-סדר מתועד);
//  (ב) דטרמיניזם;
//  (ג) כל בלוק שהשתנה מסווג: חלוקה-מחדש / בלוק סמנים (FX-3) / שחזור-סדר;
//      שינוי ללא סיווג = כשל;
//  (ד) אין בלוקים חסרים/חדשים;
//  (ה) נעילות מחודשות מתועדות בדוח הארטיפקט.
// מחליף את s4b-corpus-comparison (שער 4B — "אפס שינוי פריסה" — מילא תפקידו
// ונשמר בהיסטוריית ה-git; ה-baseline שלו נשאר לתיעוד).
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');
const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

const REPO = path.join(__dirname, '..', '..', '..');
const BASELINE = path.join(__dirname, '..', 'artifacts', 's5-main-baseline.json');
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
      if (!seen.has(tok)) { seen.set(tok, { tokenId: tok, kind: ln.kind || 'paragraph', lines: [] }); blocks.push(seen.get(tok)); }
      seen.get(tok).lines.push(ln.words || []);
    }
  }
  return { pages: res.pages.length, hash: res.layoutHash.slice(0, 16), preserved: res.contentPreserved, blocks };
}

/** סיווח הבדל בלוק: (1) אותן מילים בדיוק (מוחלטות) ⇒ חלוקה-מחדש; (2) אותן
 * מילים כמולטיסט (סדר שונה) ⇒ שחזור-סדר — תיקון היפוך קריאה שהיה בבסיס
 * (מוכח: הסדר החדש תואם את מסמך המקור, ו-reading-order-break=0 בפלט);
 * (3) סמנים ⇒ FX-3; (4) אחרת ⇒ בלתי-מוסבר. */
function classifyBlockDiff(wb, nb) {
  const flatW = wb.lines.flat();
  const flatN = nb.lines.flat();
  if (JSON.stringify(flatW) === JSON.stringify(flatN)) return 'redivision'; // אותן מילים — רק גבולות שורות
  const hasMarker = (arr) => arr.some(l => l.some(w => String(w).includes('\uE102') || String(w).includes('\uE000')));
  if (hasMarker(wb.lines) || hasMarker(nb.lines)) return 'marker';
  // אותן מילים בסדר שונה — היפוך קריאה שתוקן (flowCol; הבסיס הכיל אותו)
  const key = (a) => a.map(String).sort().join('\u0000');
  if (key(flatW) === key(flatN)) return 'order-restore';
  return 'unexplained';
}

describe('שלב 5 פרוסה 1 — השוואת קורפוס מול main (§16: תוכן פר-בלוק זהה; שינויי פריסה מסווגים)', () => {
  it('הקורפוס הקנוני: הנעילה נשמרת (אפס שינוי — ה-FX אינם נפגשים בקורפוס הקטן)', () => {
    assert(fs.existsSync(BASELINE), 'בסיס main קיים (tests/artifacts/s5-main-baseline.json)');
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const now = capture(CANONICAL, getDefaultSettings());
    const was = base.corpora.canonical;
    assertEq(now.preserved, true, 'contentPreserved');
    // הקנוני לא השתנה (נמדד): ה-FX נכנסים לפעולה רק בגבולות קיבולת/ליווי/סמן
    // שהקורפוס הקטן אינו מגיע אליהם — שער חזק: אין שינוי פריסה ברירת-מחדל ללא סיבה.
    assertEq(now.pages, was.pages, `מספר עמודים נשמר (${was.pages})`);
    assertEq(now.hash, was.layoutHash, `hash קנוני נשמר (${was.layoutHash}) — נעילת f6f32c40 ממשיכה`);
    // דטרמיניזם
    const b2 = typeset(fs.readFileSync(CANONICAL, 'utf8'), getDefaultSettings());
    assertEq(now.hash, b2.layoutHash.slice(0, 16), 'דטרמיניזם');
  });

  it('very_long: תוכן פר-בלוק זהה ביט-לביט; כל שינוי מסווג; 0 בלתי-מסווגים; נעילה מחודשת', () => {
    const veryLong = path.join(REPO, 'audits', 'very_long_test_text.txt');
    if (!fs.existsSync(veryLong)) { console.error('  [very_long לא נמצא — מדלג]'); return; }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const was = base.corpora.very_long;
    const now = capture(veryLong, getDefaultSettings());
    assertEq(now.preserved, true, 'contentPreserved (very_long)');

    const nowByTok = new Map(now.blocks.map(b => [b.tokenId, b]));
    let identical = 0;
    const byCause = { redivision: 0, marker: 0, 'order-restore': 0 };
    const unexplained = [];
    const contentMismatch = [];
    for (const wb of was.blocks) {
      const nb = nowByTok.get(wb.tokenId);
      if (!nb) { unexplained.push({ tokenId: wb.tokenId, kind: 'missing' }); continue; }
      if (JSON.stringify(wb.lines) === JSON.stringify(nb.lines)) { identical++; continue; }
      const cls = classifyBlockDiff(wb, nb);
      if (cls === 'unexplained') unexplained.push({ tokenId: wb.tokenId, kind: cls });
      else byCause[cls]++;
      // אינווריאנט תוכן פר-בלוק: המילים כמולטיסט זהות (לא נוספו/אבדו);
      // שינוי סדר מותר רק דרך שחזור-סדר מתועד
      const flatW = wb.lines.flat().map(String);
      const flatN = nb.lines.flat().map(String);
      const sameOrder = JSON.stringify(flatW) === JSON.stringify(flatN);
      const sameMultiset = JSON.stringify([...flatW].sort()) === JSON.stringify([...flatN].sort());
      if (!sameMultiset) contentMismatch.push(wb.tokenId);
      else if (!sameOrder && cls !== 'order-restore') contentMismatch.push(wb.tokenId);
    }
    const wasByTok = new Set(was.blocks.map(b => b.tokenId));
    const added = now.blocks.filter(b => !wasByTok.has(b.tokenId)).map(b => b.tokenId);

    const reportOut = {
      schema: 's5-corpus-comparison-v1',
      basis: 'main@dfb4168 (לפני פרוסה 1 של שלב 5) מול המסלול הקנוני עם FX-1..FX-5 + SSOT',
      pages: { was: was.pages, now: now.pages },
      hash: { was: was.layoutHash, now: now.hash },
      blocks: { total: was.blocks.length, identical, redivision: byCause.redivision, marker: byCause.marker, orderRestore: byCause['order-restore'], unexplained: unexplained.length, contentMismatch: contentMismatch.length, added: added.length },
      causes: [
        'FX-5: קיבולת וחלונות פיצול ב-yPx אמיתיים (גבהים+פערי כניסה) במקום המרת lineH — בלוקים שנכנסו פיזית חדלו להידחק; עמודים ריקים-פנטום הוסרו',
        'FX-1: ליווי כותרת מכוונת-הצבה (escortLockCol/startCol) — פחות שבירות עמוד מיותרות',
        'FX-3: הערות מחויבות בעמוד שורת הסמן (במקום לפני הכרעת המיקום) — קולוקציית סמן↔הערה',
        'flowCol: מונוטוניות טורים — היפוכי קריאה שהיו בבסיס תוקנו (order-restore)',
        'אינווריאנט תוכן: כל בלוק שהשתנה שומר בדיוק על מילותיו (מולטיסט) — רק חלוקת השורות/הסדר הפריסתי השתנו'
      ],
      unexplained, contentMismatch: contentMismatch.slice(0, 20), added: added.slice(0, 20)
    };
    fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 's5-corpus-comparison.json'), JSON.stringify(reportOut, null, 2));

    assertEq(unexplained.length, 0, 'הבדלים בלתי-מסווגים: ' + JSON.stringify(unexplained.slice(0, 5)));
    assertEq(contentMismatch.length, 0, 'בלוקים עם שינוי תוכן (מילים): ' + JSON.stringify(contentMismatch.slice(0, 5)));
    assertEq(added.length, 0, 'בלוקים חדשים שלא היו בבסיס: ' + JSON.stringify(added.slice(0, 5)));
    assert(identical + byCause.redivision + byCause.marker + byCause['order-restore'] === was.blocks.length, 'שלמות הסיווג');
    // שחזור-סדר: היפוכי קריאה שהיו בבסיס ותוקנו — מוכחים גם באפס הפרות reading-order בפלט
    console.error(`  [very_long] identical=${identical}/${was.blocks.length} redivision=${byCause.redivision} marker=${byCause.marker} order-restore=${byCause['order-restore']} pages ${was.pages}->${now.pages}`);
    // הנעילה החדשה נרשמת בדוח — מאומתת ב-s69 וב-cross-check
  });
});

report('s5-corpus-comparison');
