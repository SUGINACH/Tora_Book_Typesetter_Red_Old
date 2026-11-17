// tests/e2e/s9b-shadow-compare.test.js — בדיקות שליליות לכלי השוואת הצללים (9b.1, §2.2)
// מוכיחות שהכלי מזהה: העברת טקסט בין הערות, החלפת עוגן, מחיקה, כפילות זהה,
// שינוי סמן בלבד, שינוי סדר, פיצול להמשך, שינוי wordRange של המשך — וששתי
// הערות בעלות טקסט זהה נשארות שתי זהויות. בדיקות יחידה ממוקדות בלבד (לא תחליף
// למסמך האמיתי — הרצת הכלי עצמו על הקורפוסים היא בדיקת האמת).
'use strict';

const core = require('../../../tools/stage9/compare-core');
const { diffNoteSets, matchNoteSets, tocExpectation, diffToc, gateSummary, reconstructLegacyNotes, normWords } = core;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('s9b-shadow-compare: בדיקות שליליות לליבת ההשוואה (§2.2)');

// ---------- בסיס: שתי הערות בעלות טקסט זהה נשארות שתי זהויות ----------
{
  const a = [
    { key: 'n1', text: 'טקסט זהה לחלוטין', anchorId: 't5', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט זהה לחלוטין', anchorId: 't9', marker: 'ב.', order: 1 },
  ];
  const b = [
    { key: 'n1', text: 'טקסט זהה לחלוטין', anchorId: 't5', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט זהה לחלוטין', anchorId: 't9', marker: 'ב.', order: 1 },
  ];
  const d = diffNoteSets(a, b);
  check('טקסט זהה ×2: שתי זהויות נפרדות — התאמה 2', d.matched === 2 && !d.missingInA.length && !d.missingInB.length, JSON.stringify({ matched: d.matched }));
  check('טקסט זהה ×2: אפס הפרש מילים', d.wordDiffAtoB.length === 0 && d.wordDiffBtoA.length === 0);
}

// ---------- 1. העברת טקסט מהערה אחת לאחרת ----------
{
  const a = [
    { key: 'n1', text: 'טקסט ראשון', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט שני', anchorId: 't2', marker: 'ב.', order: 1 },
  ];
  const b = [
    { key: 'n1', text: 'טקסט שני', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט ראשון', anchorId: 't2', marker: 'ב.', order: 1 },
  ];
  const d = diffNoteSets(a, b);
  // multiset זהה — אבל הזהויות החליפו טקסט
  check('החלפת טקסט בין שתי הערות: מזוהה (textMoved)', d.textMoved.length === 2, `textMoved=${d.textMoved.length}`);
  check('החלפת טקסט: multiset לבד לא היה תופס (הפרש מילים 0)', d.wordDiffAtoB.length === 0 && d.wordDiffBtoA.length === 0);
}

// ---------- 2. החלפת עוגן בין שתי הערות ----------
{
  const a = [
    { key: 'n1', text: 'טקסט א', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט ב', anchorId: 't2', marker: 'ב.', order: 1 },
  ];
  const b = [
    { key: 'n1', text: 'טקסט א', anchorId: 't2', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט ב', anchorId: 't1', marker: 'ב.', order: 1 },
  ];
  const d = diffNoteSets(a, b);
  check('החלפת עוגן בין שתי הערות: מזוהה (anchorChanged=2)', d.anchorChanged.length === 2, `anchorChanged=${d.anchorChanged.length}`);
}

// ---------- 3. מחיקת הערה ----------
{
  const a = [
    { key: 'n1', text: 'טקסט א', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט ב', anchorId: 't2', marker: 'ב.', order: 1 },
    { key: 'n3', text: 'טקסט ג', anchorId: 't3', marker: 'ג.', order: 2 },
  ];
  const b = [
    { key: 'n1', text: 'טקסט א', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n3', text: 'טקסט ג', anchorId: 't3', marker: 'ג.', order: 2 },
  ];
  const d = diffNoteSets(a, b);
  check('מחיקת הערה: חסרה ב-B מזוהה', d.missingInB.length === 1 && d.missingInB[0].key === 'n2');
  check('מחיקת הערה: המילים החסרות מדווחות בכיוון A→B', d.wordDiffAtoB.some(x => x.w === 'טקסט' || x.w === 'ב'));
}

// ---------- 4. כפילות הערה זהה ----------
{
  const a = [{ key: 'n1', text: 'טקסט יחיד', anchorId: 't1', marker: 'א.', order: 0 }];
  const b = [
    { key: 'n1', text: 'טקסט יחיד', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n1b', text: 'טקסט יחיד', anchorId: 't1', marker: 'ב.', order: 1 },
  ];
  const d = diffNoteSets(a, b);
  check('כפילות הערה: העותק העודף מדווח כחסר-מקור ב-A', d.missingInA.length === 1 && d.missingInA[0].key === 'n1b');
  check('כפילות הערה: המילים העודפות מדווחות בכיוון B→A', d.wordDiffBtoA.length > 0);
}

// ---------- 5. שינוי סמן בלבד ----------
{
  const a = [{ key: 'n1', text: 'אותו טקסט', anchorId: 't1', marker: 'א.', order: 0 }];
  const b = [{ key: 'n1', text: 'אותו טקסט', anchorId: 't1', marker: 'ב.', order: 0 }];
  const d = diffNoteSets(a, b);
  check('שינוי סמן בלבד: מזוהה (markerChanged)', d.markerChanged.length === 1, `markerChanged=${d.markerChanged.length}`);
  check('שינוי סמן: הטקסט עצמו שווה (אפס הפרש מילים)', d.wordDiffAtoB.length === 0 && d.wordDiffBtoA.length === 0);
}

// ---------- 6. שינוי סדר ----------
{
  const a = [
    { key: 'n1', text: 'טקסט א', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n2', text: 'טקסט ב', anchorId: 't2', marker: 'ב.', order: 1 },
    { key: 'n3', text: 'טקסט ג', anchorId: 't3', marker: 'ג.', order: 2 },
  ];
  const b = [
    { key: 'n1', text: 'טקסט א', anchorId: 't1', marker: 'א.', order: 0 },
    { key: 'n3', text: 'טקסט ג', anchorId: 't3', marker: 'ג.', order: 1 },
    { key: 'n2', text: 'טקסט ב', anchorId: 't2', marker: 'ב.', order: 2 },
  ];
  const d = diffNoteSets(a, b);
  check('שינוי סדר: אינברסיה מזוהה', d.orderInversions.length >= 1, `inversions=${d.orderInversions.length}`);
  check('שינוי סדר: multiset לבד לא היה תופס', d.wordDiffAtoB.length === 0 && d.wordDiffBtoA.length === 0);
}

// ---------- 7. פיצול הערה להמשך ----------
{
  const a = [{ key: 'n1', text: 'חלק ראשון של ההערה חלק שני של ההערה', anchorId: 't1', marker: 'א.', order: 0 }];
  const b = [
    { key: 'n1', text: 'חלק ראשון של ההערה', anchorId: 't1', marker: 'א.', order: 0, kind: 'body' },
    { key: 'n1|f1', text: 'חלק שני של ההערה', anchorId: 't1', marker: null, order: 1, kind: 'continuation', continuationOf: 'n1' },
  ];
  const d = diffNoteSets(a, b);
  // המילים שלמות (שני החלקים יחד) — אבל סוג הפריט השתנה ונוצר המשך
  check('פיצול להמשך: המילים שלמות בסך הכול', d.wordDiffAtoB.length === 0 && d.wordDiffBtoA.length === 0);
  check('פיצול להמשך: נוצר פריט continuation עם continuationOf', b[1].kind === 'continuation' && b[1].continuationOf === 'n1');
  const m = matchNoteSets(a, b);
  check('פיצול להמשך: ההערה המקורית מותאמת, ההמשך מדווח כעודף זהות', m.onlyInB.length === 1 && m.onlyInB[0].continuationOf === 'n1');
}

// ---------- 8. שינוי wordRange של המשך ----------
{
  const cont1 = { key: 'n1|f1', text: 'המשך ההערה', anchorId: 't1', order: 1, kind: 'continuation', continuationOf: 'n1', wordRange: { from: 5, to: 9 } };
  const cont2 = { key: 'n1|f1', text: 'המשך ההערה', anchorId: 't1', order: 1, kind: 'continuation', continuationOf: 'n1', wordRange: { from: 6, to: 9 } };
  check('wordRange שונה מזוהה כשינוי', JSON.stringify(cont1.wordRange) !== JSON.stringify(cont2.wordRange));
  check('המשך בלי wordRange מדווח (חוזה notes-model: continuation חייב טווח)', !cont1.wordRange === false && (cont2.wordRange = null, !cont2.wordRange));
}

// ---------- 9. הכיוונים נפרדים (תיקון הכפלת mDiff של גרסה 4) ----------
{
  const a = [
    { key: 'n1', text: 'משותפת ייחודית-ל-A', anchorId: 't1', order: 0 },
    { key: 'n2', text: 'משותפת', anchorId: 't2', order: 1 },
  ];
  const b = [
    { key: 'n1', text: 'משותפת', anchorId: 't1', order: 0 },
    { key: 'n2', text: 'משותפת ייחודית-ל-B', anchorId: 't2', order: 1 },
  ];
  const d = diffNoteSets(a, b);
  const aOnly = d.wordDiffAtoB.map(x => x.w);
  const bOnly = d.wordDiffBtoA.map(x => x.w);
  check('כיוון A→B: רק מילות A החסרות', aOnly.includes('ייחודית-ל-A') && !aOnly.includes('ייחודית-ל-B'), JSON.stringify(aOnly));
  check('כיוון B→A: רק מילות B החסרות', bOnly.includes('ייחודית-ל-B') && !bOnly.includes('ייחודית-ל-A'), JSON.stringify(bOnly));
}

// ---------- 10. שחזור הערות מורשת (סמנים/המשכים/יתומים) ----------
{
  const mkW = (t, mk) => ({ t, mk: !!mk });
  const areas = [
    { page: 3, lines: [{ words: [mkW('א.', true), mkW('טקסט'), mkW('הערה'), mkW('ראשונה'), mkW('ב.', true), mkW('טקסט'), mkW('שנייה')] }] },
    { page: 4, lines: [{ words: [mkW('(המשך)'), mkW('של'), mkW('השנייה'), mkW('ג.', true), mkW('שלישית')] }] },
  ];
  const r = reconstructLegacyNotes(areas);
  check('שחזור: 3 הערות מ-2 אזורים (continuous)', r.notes.length === 3, `notes=${r.notes.length}`);
  check('שחזור: הערה ראשונה שלמה', r.notes[0].text === 'טקסט הערה ראשונה', `"${r.notes[0].text}"`);
  check('שחזור: המשך מתחבר להערה השנייה (בלי "(המשך)")', r.notes[1].text === 'טקסט שנייה של השנייה', `"${r.notes[1].text}"`);
  check('שחזור: מונה המשכים', r.continuationFragments === 1);
  check('שחזור: סמנים נשמרים', r.notes[2].marker === 'ג.');
  const r2 = reconstructLegacyNotes([{ page: 1, lines: [{ words: [mkW('יתום', false)] }] }]);
  check('שחזור: מילה לפני כל סמן = ממצא יתום (לא נזרקת בשקט)', r2.orphans.length === 1 && r2.notes.length === 0);
}

// ---------- 11. TOC לפי D-107 (§2.5) ----------
{
  const headings = [
    { level: 1, text: 'חלק ראשון', key: 'h1' },
    { level: 2, text: 'סימן א', key: 'h2' },
    { level: 3, text: 'ענף א', key: 'h3' },
    { level: 6, text: 'פרט קטן', key: 'h6' },
    { level: 7, text: 'ביאור צד', key: 'h7' },
    { level: 0, text: 'הקדמה', key: 'h0' },
  ];
  const gen = tocExpectation(headings, { minLevel: 1, maxLevel: 6 });
  const det = tocExpectation(headings, { minLevel: 2, maxLevel: 6 });
  check('TOC כללי: רמות 1–6, בלי H7 ובלי H0', gen.length === 4 && gen.every(g => g.level >= 1 && g.level <= 6), JSON.stringify(gen.map(g => g.level)));
  check('TOC מפורט: רמות 2–6, בלי H1', det.length === 3 && det.every(d => d.level >= 2), JSON.stringify(det.map(d => d.level)));
  const d1 = diffToc(gen, gen.map(g => ({ level: g.level, text: g.text })));
  check('TOC: התאמה מלאה עוברת', d1.missing.length === 0 && d1.extra.length === 0 && d1.duplicates.length === 0);
  const d2 = diffToc(gen, [{ level: 1, text: 'חלק ראשון' }, { level: 2, text: 'סימן א' }]);
  check('TOC: חסרות מדווחות לפי רמה', d2.missing.length === 2 && d2.missing.some(m => m.level === 6));
  const d3 = diffToc(gen, [...gen.map(g => ({ level: g.level, text: g.text })), { level: 3, text: 'ענף א' }]);
  check('TOC: כפילות (עודף על הציפייה) מדווחת', d3.duplicates.length === 1 && d3.duplicates[0].level === 3);
  const d3b = diffToc([...gen, { level: 3, text: 'ענף א', key: 'h3b' }], [...gen.map(g => ({ level: g.level, text: g.text })), { level: 3, text: 'ענף א' }]);
  check('TOC: כותרות שונות בעלות אותו טקסט (בשני הצדדים) אינן כפילות', d3b.duplicates.length === 0 && d3b.missing.length === 0 && d3b.extra.length === 0);
  const d4 = diffToc(gen, [{ level: 4, text: 'רשומה זרה' }]);
  check('TOC: עודפת מדווחת', d4.extra.length === 1 && d4.extra[0].level === 4);
}

// ---------- 12. §2.7: ספירת שערים נגזרת מרשימה אחת ----------
{
  const defs = [
    { id: 'A', group: 'x', desc: 'ד' },
    { id: 'B', group: 'x', desc: 'ד' },
    { id: 'C', group: 'y', desc: 'ד' },
  ];
  const s1 = gateSummary(defs, { A: { ok: true }, B: { ok: true }, C: { ok: true } });
  check('סיכום: 3/3', s1.total === 3 && s1.passed === 3 && s1.failed === 0 && s1.ok === true);
  const s2 = gateSummary(defs, { A: { ok: true }, C: { ok: false, detail: 'כשל' } });
  check('סיכום: 1/3 עם B לא מוגדר', s2.passed === 1 && s2.failed === 2 && s2.ok === false);
  const s3 = gateSummary(defs, {});
  check('סיכום: אפס תוצאות ⇒ הכול נכשלו (לא "10/12" ידני)', s3.passed === 0 && s3.failed === 3);
}

// ---------- 13. סיווג ירידות (§2.6 — תקציבים מוגדרים בלבד) ----------
{
  const { classifyDrops, buildBudgets } = core;
  const budgets = buildBudgets({ grammarWords: ['כותרת'], metaValues: ['שם-ספר'], h7InstructionWords: ['מספר'], citationWords: ['הוצאה,'] });
  const drops = [{ w: 'כותרת', miss: 2 }, { w: 'שם-ספר', miss: 1 }, { w: 'מספר', miss: 1 }, { w: 'הוצאה,', miss: 1 }, { w: 'מילה-זרה', miss: 3 }];
  const cls = classifyDrops(drops, budgets);
  check('סיווג: מילה זרה נשארת unexplained במלואה', cls.unexplained.some(x => x.w === 'מילה-זרה' && x.miss === 3), JSON.stringify(cls.unexplained));
  check('סיווג: חריגה חלקית מעל תקציב מדווחת בשאריתה בלבד', (() => {
    const b2 = buildBudgets({ grammarWords: ['כותרת'] });
    const c2 = classifyDrops([{ w: 'כותרת', miss: 5 }], b2);
    return c2.unexplained.length === 1 && c2.unexplained[0].miss === 4;
  })());
}

// ---------- 14. normWords — נרמול מוגדר ----------
{
  const w = normWords('שלום\u200f [הערה] \uE001עולם');
  check('normWords: מסיר תווי כיוון/תוחמים/PUA', w.length === 3 && w[0] === 'שלום' && w[1] === 'הערה' && w[2] === 'עולם', JSON.stringify(w));
}

console.log(`\ns9b-shadow-compare: ${passed} עברו, ${failed} נכשלו`);
if (failed) process.exit(1);
