// src/engine/layout/candidate-generator.js — Split-candidate scoring with capacity evidence (S5.1.2 core, registered S4)
// עקרון אנטי־טלאי: overflow = HARD reject (לא ×2000 soft כ ב‑V1), כל דחייה נרשמת ל‑ledger עם נימוס.
'use strict';

const { blockGapPx } = require('./column-flow');
const {
  MIN_LINES_PER_SIDE, legalSplitWindow, orphanAtDestination, CONSTRAINT_POLICY
} = require('./constraint-matrix'); // **שלב 5 פרוסה 2:** החלון — מקור יחיד לטווח החוקי (הן ≥2/צד, הן maxFit)

/**
 * מחזיר מועמדי פיצול לבלוק בתוך טור:
 *  - נקודות שבירה = סוף שורה (L3 line boxes)
 *  - scoring = f(Δ height, capacityBefore/capacityAfter justify, next-block context)
 *  - ladder עונשין: whole-paragraph moves > line moves > leading > para-spacing
 *
 * **שלב 5 — תיקוני שורש מאוחדים (חילוץ מ-#16/#17):**
 *  - **מועמד מוגבל למקום הפנוי (#16):** פרמטר `cur` (maxFit — השורות שנכנסות
 *    במקום הפנוי) היה **מת**: המועמד המנצח נבחר לפי איזון בלבד ויכול היה
 *    לחרוג מהמקום הפנוי ⇒ pushLines פלט את העודף בפליטה מרומזת ⇒ עמוד
 *    כמעט-ריק באמצע הספר. כעת מועמד שחורג נדחה HARD עם רישום סיבה.
 *  - **FX-4 (#17, דוח 06):** עונש strict — כעת מוגדר כמדיניות רכה מוגדרת
 *    (CONSTRAINT_POLICY.strictDestMinimum): עונש על מועמד שמשאיר בדיוק את
 *    המינימום החוקי (2 שורות) בראש היעד; חיתוך שמשאיר פחות — בלתי-חוקי
 *    מיסודו ואינו מיוצר כלל (החלון חוסם אותו).
 *
 * **פרוסה 2 — יישוב הפער חוזה↔התנהגות (§2.4 בביקורת):** הטווח נגזר כולו
 * מ-`legalSplitWindow` — מקור האמת היחיד. אין עוד לולאת `cut < lines` עצמאית,
 * אין עוד בדיקת `cut > maxFit` משוכפלת (החלון כולל את הגבול), ואין עוד
 * מועמד lines−1 שמפר את החוזה. כל דחייה חוזרת גם in-band (`out.rejections`)
 * לצורך decision-trace — לא רק ל-ledger.
 *
 * @param {object} blk        בלוק עם .lines (נמדדו)
 * @param {number} cur        maxFit — שורות שנכנסות במקום הפנוי (גבול עליון חוקי למועמדים)
 * @param {number} colCapacityPx
 * @param {object} settings
 * @param {object} ledger     Ledger (core/ledger) — כתיבת סיבה לכל דחייה (S5.1.10)
 * @returns {Array<{cut, before, after, capacityBefore, capacityAfter, score}>} —
 *   ממוין לפי score עולה; `out.rejections` — דחיות קומפקטיות ל-trace.
 */
function generateCandidates(blk, cur, colCapacityPx, settings, ledger) {
  const maxFit = Number(cur) || 0;
  const out = [];
  out.rejections = [];
  const lineH = blk.lineHeightPx || 20;
  const gap = blockGapPx(settings, lineH);
  // **פרוסה 2:** החלון החוקי — מקור יחיד. null ⇒ אין פיצול חוקי כלל.
  const win = legalSplitWindow(blk.lines.length, maxFit);
  if (!win) {
    if (ledger) ledger.create('candidate-rejected', `${blk.tokenId}@window`, null, { why: 'no-legal-window', lines: blk.lines.length, maxFit }, 'candidate-gen');
    out.rejections.push({ why: 'no-legal-window', lines: blk.lines.length, maxFit });
    return out;
  }
  const strict = settings['widow-strictness'] === 'strict';
  const strictPenalty = CONSTRAINT_POLICY.strictDestMinimum.penalty;
  for (let cut = win.lo; cut <= win.hi; cut++) {
    const before = blk.lines.slice(0, cut).reduce((s, l) => s + (l.heightPx || lineH), 0) + gap;
    const after = blk.lines.slice(cut).reduce((s, l) => s + (l.heightPx || lineH), 0);
    // HARD reject: overflow אינו נענש במשקל אלא נפסל לחלוטין (D-11)
    if (before > colCapacityPx) {
      if (ledger) ledger.create('candidate-rejected', `${blk.tokenId}@${cut}`, null, { why: 'overflow-before', cut, before, cap: colCapacityPx }, 'candidate-gen');
      out.rejections.push({ cut, why: 'overflow-before', before: Math.round(before), cap: Math.round(colCapacityPx) });
      continue;
    }
    // justify capability: האם הטור שלפני יכול להצדיק (להגיע לקצה) — p376-class reasoning
    const capacityBefore = colCapacityPx - before;
    // **strict (מדיניות רכה, מוכרזת):** עונש על הסתפקות במינימום החוקי ביעד.
    const score = Math.abs(capacityBefore - (colCapacityPx - after))
      + (strict && orphanAtDestination(blk.lines.length, cut) ? strictPenalty : 0);
    out.push({ cut, before, after, capacityBefore, capacityAfter: colCapacityPx - after, score });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

module.exports = { generateCandidates };
