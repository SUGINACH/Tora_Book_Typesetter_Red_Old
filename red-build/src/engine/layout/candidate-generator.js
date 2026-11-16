// src/engine/layout/candidate-generator.js — Split-candidate scoring with capacity evidence (S5.1.2 core, registered S4)
// עקרון אנטי־טלאי: overflow = HARD reject (לא ×2000 soft כ ב‑V1), כל דחייה נרשמת ל‑ledger עם נימוס.
'use strict';

const { blockGapPx } = require('./column-flow');
const { MIN_LINES_PER_SIDE, orphanAtDestination } = require('./constraint-matrix'); // **שלב 5:** חלון הפיצול + עונש strict חי — מקור יחיד (חילוץ שורש מ-#16/#17)

/**
 * מחזיר מועמדי פיצול לבלוק בתוך טור:
 *  - נקודות שבירה = סוף שורה (L3 line boxes)
 *  - scoring = f(Δ height, capacityBefore/capacityAfter justify, next-block context)
 *  - ladder עונשין: whole-paragraph moves > line moves > leading > para-spacing
 *
 * **שלב 5 — שני תיקוני שורש מאוחדים (חילוץ מ-#16/#17):**
 *  - **מועמד מוגבל למקום הפנוי (#16):** פרמטר `cur` (maxFit — השורות שנכנסות
 *    במקום הפנוי) היה **מת**: המועמד המנצח נבחר לפי איזון בלבד ויכול היה
 *    לחרוג מהמקום הפנוי ⇒ pushLines פלט את העודף בפליטה מרומזת ⇒ עמוד
 *    כמעט-ריק באמצע הספר (נמדד: עמוד עם 4+4 שורות בלבד; מקורו cut=16 מול
 *    maxFit≈8). כעת מועמד שחורג מ-maxFit נדחה HARD עם רישום סיבה (D-11).
 *  - **FX-4 (#17, דוח 06):** העונש ההיסטורי `cut < 2` היה בלתי-ספיק לעולם
 *    (הלולאה מתחילה ב-cut = 2) — widow-strictness=strict לא שינה דבר
 *    (מדיניות שקרית כלפי המשתמש). התנאי הנכון: החלק השני קצר מהמינימום ⇒
 *    יתום בראש היעד (orphanAtDestination).
 *
 * @param {object} blk        בלוק עם .lines (נמדדו)
 * @param {number} cur        maxFit — שורות שנכנסות במקום הפנוי (גבול עליון חוקי למועמדים)
 * @param {number} colCapacityPx
 * @param {object} settings
 * @param {object} ledger     Ledger (core/ledger) — כתיבת סיבה לכל דחייה (S5.1.10)
 */
function generateCandidates(blk, cur, colCapacityPx, settings, ledger) {
  const maxFit = Number(cur) || 0; // **שלב 5:** maxFit חי — גבול עליון חוקי למועמדים
  const out = [];
  const lineH = blk.lineHeightPx || 20;
  const gap = blockGapPx(settings, lineH);
  for (let cut = MIN_LINES_PER_SIDE; cut < blk.lines.length; cut++) {
    // HARD reject: חיתוך שחורג מהמקום הפנוי — החלק הראשון לא ייכנס לעמוד (#16)
    if (cut > maxFit) {
      if (ledger) ledger.create('candidate-rejected', `${blk.tokenId}@${cut}`, null, { why: 'exceeds-free-space', cut, maxFit }, 'candidate-gen');
      continue;
    }
    const before = blk.lines.slice(0, cut).reduce((s, l) => s + (l.heightPx || lineH), 0) + gap;
    const after = blk.lines.slice(cut).reduce((s, l) => s + (l.heightPx || lineH), 0);
    // HARD reject: overflow אינו נענש במשקל אלא נפסל לחלוטין (D-11)
    if (before > colCapacityPx) {
      if (ledger) ledger.create('candidate-rejected', `${blk.tokenId}@${cut}`, null, { why: 'overflow-before', before, cap: colCapacityPx }, 'candidate-gen');
      continue;
    }
    // justify capability: האם הטור שלפני יכול להצדיק (להגיע לקצה) — p376-class reasoning
    const capacityBefore = colCapacityPx - before;
    const score = Math.abs(capacityBefore - (colCapacityPx - after))
      + (settings['widow-strictness'] === 'strict' && orphanAtDestination(blk.lines.length, cut) ? 1e9 : 0); // **FX-4:** התנאי הנכון
    out.push({ cut, before, after, capacityBefore, capacityAfter: colCapacityPx - after, score });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

module.exports = { generateCandidates };
