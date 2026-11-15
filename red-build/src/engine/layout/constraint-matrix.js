// src/engine/layout/constraint-matrix.js — Unified layout-policy constraint matrix
// (Forensic audit 2026-11-15, Chapter 5 Stage A — audits/06_FORENSIC_UNIFICATION_AUDIT_2026-11-15.md)
'use strict';

/**
 * **מקור האמת המספרי היחיד לאילוצי מדיניות הפריסה.**
 *
 * לפני המודול הזה, אותם פרמטרים מספריים היו מפוזרים כ-literals בחמישה
 * קבצים ללא קישור ביניהם (dp-planner: ensureRoom/findSplit, balancing:
 * cleanBoundary, protections-matrix: headingEscort/widowOrphan,
 * candidate-generator: עונש strict מת — ראה FX-4). כל צרכן עבר לקרוא מכאן.
 *
 * עקרונות:
 *  - **אין שינוי ערכים** בשלב A — רק סילוק כפילות (ערכי ברירת המחדל זהים
 *    ל-literals שהוחלפו; השוואת hash לפני/אחרי בבדיקות הרגרסיה).
 *  - **יחידות yPx אמיתיות** בלבד: כל פונקציית גובה כאן מקבלת שורות עם
 *    heightPx ומחזירה סכום פיזי — לא המרות lineH (שורש FX-5: עמוד ריק
 *    פנטום מפער יחידות בין ensureRoom ל-pushLines).
 *  - **אילוץ מוכרז כקשה או כעדין**: hard ⇒ פוסל פיצול/הצבה; soft ⇒ עונש
 *    סופי. ההכרזה חיה כאן, לא בראש של הצרכן.
 */

/** מינימום שורות ליווי אחרי כותרת H1-H6 באותו טור (REQ-BAL-10). */
const ESCORT_MIN_LINES = 2;

/** מינימום שורות מכל צד של גבול פיצול פסקה (widow/orphan קלאסי). */
const WIDOW_ORPHAN_MIN = 2;

/** סבילות השוואת קיבולת (px) — כמו ב-dp-planner.flushPage/pushLines. */
const CAPACITY_EPS = 0.5;

/**
 * האם חיתוך במקום `cut` משאיר יתום בראש היעד (שורת המשך בודדת)?
 * תיקון FX-4: התנאי ההיסטורי `cut < 2` היה בלתי-ספיק לעולם (הלולאה
 * ב-candidate-generator מתחילה ב-cut = 2) — עונש strict מעולם לא נשרף.
 */
function orphanAtDestination(lineCount, cut) {
  return lineCount - cut < WIDOW_ORPHAN_MIN;
}

/**
 * גובה מחסנית אמיתי (yPx) של קבוצת שורות, כולל פער הכניסה של הבלוק.
 * זהו ניפוץ הכפילוּת "יחידות lineH מול heightPx" (FX-1/FX-5): הבדיקה
 * וההצבה מודדות מעתה באותה יחידה — הגובה הפיזי שייצרך בפועל.
 *
 * @param {Array<{heightPx:number}>} lines
 * @param {number} [admissionGapPx=0] — blockGapPx של הבלוק (שער כניסה בלבד —
 *   כמקובל עד שלב B; ראה FX-6 בדוח).
 */
function stackHeightPx(lines, admissionGapPx = 0) {
  let h = admissionGapPx;
  for (const ln of lines) h += (ln && ln.heightPx) || 0;
  return h;
}

/**
 * גובה המחסנית שחייבת להיכנס **בטור אחד** כדי לקיים ליווי כותרת:
 * כל שורות הכותרת + פער הכניסה שלה + min(escort, following) שורות הליווי
 * + פער הכניסה של בלוק הליווי. (הבדיקה ההיסטורית מדדה 1+2 ביחידות lineH —
 * והתעלמה מגובה הכותרת האמיתי ומפער הליווי.)
 *
 * @param {object} headBlock — בלוק הכותרת {lines}
 * @param {object|null} nextBlock — הבלוק העוקב {lines}
 * @param {(block)=>number} gapOf — פער כניסה פר-בלוק (blockGapPx(settings,lineH))
 */
function escortStackHeightPx(headBlock, nextBlock, gapOf) {
  const following = nextBlock && nextBlock.lines ? nextBlock.lines.length : 0;
  if (following < 1) return stackHeightPx(headBlock.lines, gapOf(headBlock));
  const escortN = Math.min(ESCORT_MIN_LINES, following);
  return stackHeightPx(headBlock.lines, gapOf(headBlock))
    + stackHeightPx(nextBlock.lines.slice(0, escortN), gapOf(nextBlock));
}

/**
 * האם גבול פיצול (מקום k ברצף הקריאה) משאיר כותרת ללא ליווי מספק בטור
 * המקור (col0 = seq[0..k))? תיקון הסתירה שהוכחה בפרק 4: optimalSplit סימן
 * גבול "נקי" גם כשהוא מותיר כותרת בתחתית הטור עם <2 שורות אחריה —
 * heading-escort שאין לו תיקון. מעתה גבול כזה איננו "clean" (עדיפות
 * לקסיקוגרפית קיימת: clean קודם ל-|Δ|).
 */
function escortCleanBoundary(seq, k) {
  // סריקה לאחור מסוף col0: כותרת בטווח של ESCORT_MIN_LINES+1 שורות אחרונות
  for (let i = Math.max(0, k - (ESCORT_MIN_LINES + 1)); i < k; i++) {
    const ln = seq[i];
    if (!ln || ln.kind !== 'heading') continue;
    let nonHeadingAfter = 0;
    for (let j = i + 1; j < k; j++) {
      if (seq[j] && seq[j].kind !== 'heading') nonHeadingAfter++;
    }
    if (nonHeadingAfter < ESCORT_MIN_LINES) return false;
  }
  return true;
}

module.exports = {
  ESCORT_MIN_LINES,
  WIDOW_ORPHAN_MIN,
  CAPACITY_EPS,
  orphanAtDestination,
  stackHeightPx,
  escortStackHeightPx,
  escortCleanBoundary,
};
