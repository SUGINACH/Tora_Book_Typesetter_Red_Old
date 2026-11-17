// src/engine/output/geometry-projector.js — **שלב 8 (§4.1): facade מעבר** ל-materialization
'use strict';

/**
 * **מצב ביניים מתועד (הוראת שלב 8 §4.1):** מנוע יצירת המיקומים הסופיים עבר
 * למנגנון הפנימי הטהור — `core/materialize.js` — שמופעל פעם אחת בבניית
 * ה-PageModel וצורך את חותמות התוכן המבני (`layout/structural-stamps.js`)
 * שהוטבעו בזמן התכנון. הקובץ הזה נשאר כ-facade לשני צרכנים קיימים:
 *  1. נתיב ה-PDF הוותיק (export-api) — עד שלב 8 פרוסה 5 (PDF מה-PageModel);
 *  2. בדיקות שמייבאות projectPage/projectLine.
 *
 * ה-facade מבטיח שהחותמות קיימות לפני ההקרנה: אם הקלט הגיע מה-pipeline —
 * הן כבר הוטבעו שם (מונה הנפילות יישאר 0); אם זה קלט סינתטי בלי חותמות —
 * הן מוטבעות כאן חד-פעמית **ומסומנות ב-materializeFallbacks הגלוי של הפלט**
 * (אין נפילה שקטה). בשלב 9, לאחר הוכחת parity מלאה, ה-facade ונתיב ה-PDF
 * הוותיק יוסרו — materialize פועל רק מבניית ה-PageModel.
 */

const { stampStructuralGeometry } = require('../layout/structural-stamps');
const materialize = require('../core/materialize');

/**
 * הקרנת מסמך שלם — מבטיח חותמות ואז מנגנון ה-materialization היחיד.
 * @param {object} result — תוצר typeset (עמודי התוכנית)
 * @param {object} settings — הגדרות ממוזגות
 * @param {MeasureAPI} [api] — מדידה להטבעת-נפילה בלבד (קלט סינתטי בלי חותמות)
 */
function projectDocument(result, settings, api) {
  const missing = (result.pages || []).some(p =>
    (p.type === 'toc-general' || p.type === 'toc-detail') && (p.toc && p.toc.rows || []).length > 0 && !p.tocLayout)
    || (result.pages || []).some(p => /^shaar-/.test(p.type) && !p.shaarLayout)
    || (result.pages || []).some(p => (p.header && p.header.slots && !p.headerSlotGeo))
    || (result.pages || []).some(p => (p.folioDisplay && !p.folioGeo))
    || (result.pages || []).some(p => (p.footnotes && p.footnotes.length && !p.footnoteLanes))
    || (result.pages || []).some(p => (p.type === 'endnotes' && p.heading && !p.endnoteTitleGeo));
  if (missing) {
    // קלט ללא חותמות (בדיקות/נתיב ישן): הטבעה חד-פעמית כאן — והיא תסומן
    // בפלט דרך materializeFallbacks של ההקרנה עצמה (אין השתקה).
    const { MeasureAPI } = require('../typography/measure-api');
    stampStructuralGeometry(result.pages || [], settings, api || new MeasureAPI(settings, 'table'));
  }
  return materialize.projectDocument(result, settings, api);
}

function projectPage(page, settings, api) {
  // עמוד בודד: אותו אינווריאנט — חותמות קיימות או מוטבעות חד-פעמית.
  const pages = [page];
  const needs = ((page.type === 'toc-general' || page.type === 'toc-detail') && (page.toc && page.toc.rows || []).length > 0 && !page.tocLayout)
    || (/^shaar-/.test(page.type) && !page.shaarLayout)
    || (page.header && page.header.slots && !page.headerSlotGeo)
    || (page.folioDisplay && !page.folioGeo)
    || (page.footnotes && page.footnotes.length && !page.footnoteLanes)
    || (page.type === 'endnotes' && page.heading && !page.endnoteTitleGeo);
  if (needs) {
    const { MeasureAPI } = require('../typography/measure-api');
    stampStructuralGeometry(pages, settings, api || new MeasureAPI(settings, 'table'));
  }
  return materialize.projectPage(page, settings, api);
}

module.exports = {
  projectDocument,
  projectPage,
  projectLine: materialize.projectLine,
  lineFontSizePt: materialize.lineFontSizePt,
  attachBaselines: materialize.attachBaselines,
  materializeDocument: materialize.materializeDocument
};
