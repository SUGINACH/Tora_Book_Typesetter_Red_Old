// src/engine/typography/units.js — יחידות ומדיניות rounding אחת לכל המנוע (שלב 3, §3.1-9)
'use strict';

/**
 * **חוזה:** spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §3.1-9 — "להגדיר יחידות
 * קבועות ומדיניות rounding אחת. כל המרות px/pt/mm נעשות בגבור מוגדר; אין
 * rounding עצמאי בכל מודול."
 *
 * **ההחלטה הקנונית (זהה להתנהגות המנוע כיום — נעול, לא נגרע):**
 * - יחידת המדידה הפנימית: **px CSS** (96 לאינץ').
 * - pt = 1/72 אינץ'; ההמרה pt→px = ×(96/72) = ×(4/3).
 * - mm = 1/25.4 אינץ'; mm→px = ×(96/25.4).
 * - **מדיניות rounding:** המדידה הקנונית אינה מעגלת כלל (מספר ממשי מלא —
 *   "בלי Math.round" כמו S5.1); עיגול שלם מתבצע **רק בגבול ההקרנה**
 *   (render-round) ובחוזה שדורש זאת במפורש (legacy px שלמים). כל עיגול
 *   עובר דרך כאן — מונע עיגול עצמאי מפוזר.
 */

const PX_PER_IN = 96;
const PT_PER_IN = 72;
const MM_PER_IN = 25.4;

/** pt → px (ההמרה היחידה במנוע; 12pt = 16px בדיוק). */
function ptToPx(pt) { return (pt * PX_PER_IN) / PT_PER_IN; }
/** px → pt. */
function pxToPt(px) { return (px * PT_PER_IN) / PX_PER_IN; }
/** mm → px. */
function mmToPx(mm) { return (mm * PX_PER_IN) / MM_PER_IN; }
/** px → mm. */
function pxToMm(px) { return (px * MM_PER_IN) / PX_PER_IN; }

/**
 * מדיניות העיגול היחידה.
 * - 'none' (ברירת המחדל הקנונית): מחזיר כמו שהוא.
 * - 'render': עיגול לשלם בגבול ההקרנה בלבד (CSS/folio מקבלים px שלם).
 * - 'up'/'down'/'half-up': נדרשים במפורש בלבד (למשל תקציבי שורות).
 */
function roundPx(px, policy = 'none') {
  switch (policy) {
    case 'none': return px;
    case 'render': return Math.round(px);
    case 'up': return Math.ceil(px);
    case 'down': return Math.floor(px);
    case 'half-up': return Math.floor(px + 0.5);
    default: throw new Error(`units: מדיניות עיגול לא מוכרת: ${policy}`);
  }
}

/** טביעת יחידות — חלק מ-environment fingerprint של המדידה. */
const UNITS_VERSION = 'units-v1(px=96dpi;pt=72/in;mm=25.4/in;round=none-canonical,render-at-boundary)';

module.exports = { ptToPx, pxToPt, mmToPx, pxToMm, roundPx, UNITS_VERSION, PX_PER_IN, PT_PER_IN, MM_PER_IN };
