// src/ui/page-model-transport.js — קבלת PageModel מעבר לגבול ה-Worker (שלב 8 פרוסה 2, §4.3)
'use strict';

/**
 * **חוזה ההעברה (pagemodel-transport-v1):** ה-Worker בונה את המודל וסריאליזציית
 * הפרוטוקול (ui-result-v1) עוטפת אותו עם גרסת transport + ההאשים שחושבו
 * בצד הבונה. structured clone מפשיר הקפאות — לכן הצד המקבל:
 *   1. מאמת סכמה וגרסאות (transport/schema/pages).
 *   2. מאמת שההאשים שבמעטפת תואמים לאלה שעל המודל (שלמות ההעברה).
 *   3. מקפיא מחדש עמוק (אותה סמנטיקה כמו הבונה).
 *   4. מדווח מדדי העברה (גודל מוערך, עמודים, שורות).
 *
 * אין כאן ולידציה גאומטרית מחדש ואין חישוב מחדש — ההאשים הם הוכחת
 * השלמות שחושבה פעם אחת בצד המנוע; ה-UI אינו מפעיל מנוע שני.
 */

const TRANSPORT_VERSION = 'pagemodel-transport-v1';
const MODEL_SCHEMA = 'pagemodel-v1';

/** הקפאה עמוקה — ראי ההתנהגות של deepFreeze בבונה (core/page-model.js);
 * מוקדת כאן כי חבילת ה-UI אינה כוללת את מנוע הפייפליין. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/**
 * קבלת המודל מההודעה העוברת את גבול ה-Worker.
 * @param {object} envelope — {transport, schema, model, geometryHash, contentHash, bytesEstimate}
 * @returns {{ok:boolean, error?:string, model?:object, metrics?:object}}
 */
function receivePageModel(envelope) {
  if (envelope == null) return { ok: false, error: 'empty-envelope' };
  if (envelope.transport !== TRANSPORT_VERSION) {
    return { ok: false, error: `transport-version-mismatch:${envelope.transport}` };
  }
  const model = envelope.model;
  if (!model || typeof model !== 'object') return { ok: false, error: 'no-model' };
  if (model.schema !== MODEL_SCHEMA) {
    return { ok: false, error: `schema-mismatch:${model.schema}` };
  }
  if (!Array.isArray(model.pages) || !model.pages.length) {
    return { ok: false, error: 'no-pages' };
  }
  // שלמות: ההאשים שחושבו בצד הבונה חייבים להתאים לאלה שעל המודל שהגיע
  if (envelope.geometryHash !== model.geometryHash || envelope.contentHash !== model.contentHash) {
    return { ok: false, error: 'hash-mismatch' };
  }
  if (typeof model.geometryHash !== 'string' || model.geometryHash.length < 16 ||
      typeof model.contentHash !== 'string' || model.contentHash.length < 16) {
    return { ok: false, error: 'missing-hashes' };
  }
  // הקפאה מחדש — structured clone מפשיר; המודל שוב immutable בצד הצרכן
  deepFreeze(model);
  const lines = model.pages.reduce((a, p) => a + (p.lines ? p.lines.length : 0), 0);
  return {
    ok: true,
    model,
    metrics: {
      pages: model.pages.length,
      lines,
      bytesEstimate: envelope.bytesEstimate != null ? envelope.bytesEstimate : null,
      transport: TRANSPORT_VERSION
    }
  };
}

module.exports = { TRANSPORT_VERSION, receivePageModel, deepFreeze };
