// src/engine/core/pua-text.js — סימוני ה-PUA הפנימיים וה-scrub הקנוני (BRZ-13 / S2.2)
'use strict';

/**
 * **מקור יחיד לתווי הבקרה הפנימיים** (מודל neutral — ללא תלות בשכבה כלשהי):
 * הליבה (materialize), המקרינים (dom-renderer) וההטבעות (structural-stamps)
 * צורכים את אותם קבועים ואת אותה פונקציית ניקוי — עד שלב 8 פרוסה 1 הפונקציה
 * חיה ב-dom-renderer והליבה ייבאה אותה משם (תלות core→output הפוכה); כאן
 * היא במודול טהור שכולם מייבאים ממנו.
 *
 * תווי ה-PUA אינם יוצאים לעולם ל-DOM/HTML/PDF: כל טקסט מוצג עובר scrub
 * לפני הפלט. הקבועים משמשים את הפענוח/הסמנים לסימון פנימי בלבד.
 */

const ATOMIC_SPACE = '\uE000'; // רווח אטומי (מילה בלתי-ניתנת-לשבירה)
const PAREN_MARK = '\uE101';   // סוגריים גרשיים פנימיים
const MARK_TAG = '\uE102';     // תג סמן הערה (בסמנים/בפרגמנטים)

/** scrub חובה: אף תו PUA פנימי לא יוצא החוצה (BRZ-13 / S2.2). */
function scrubPUAText(s) {
  return String(s).split(ATOMIC_SPACE).join(' ').split(PAREN_MARK).join('').split(MARK_TAG).join('');
}

module.exports = { ATOMIC_SPACE, PAREN_MARK, MARK_TAG, scrubPUAText };
