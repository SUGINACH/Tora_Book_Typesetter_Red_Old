// src/engine/measure/measure-model.js — מדידה קנונית של פריטי השורה לפני שבירתן (שלב 3; גבול מדידה יחיד — שלב 4 מקטע ב׳)
'use strict';

/**
 * **חוזה:** spec/00 §3.3 — "תמונות וטווחי גופן נמדדים לפני שבירת שורות, כחלק
 * מהזרם" + "כל סוג פריט במודל מקבל מדידה קנונית".
 *
 * **גבול המדידה היחיד (הוראת שלב 4 מקטע ב׳, §5):** measureDocumentModel הוא
 * כעת **מתזמר המדידה של פריטי השורה הקנוניים** — אותן יחידות שה-LineBreaker
 * באמת צורך. הוא קורא לאותם שלבי הכנה+מדידה של buildLineSequences (שלב 4)
 * ומחזיר מפה immutable של itemId → MeasuredItem לכל box/glue ברצפים.
 * אין כאן מדידה שנייה של הפריטים המקוריים (פסקה-ואז-מילה — אסור), ואין
 * API מדידה שני: מנוע השורות ו-measureDocumentModel חולקים מנגנון אחד.
 *
 * **טוהר:** המודל לא משתנה; הפלט — מפה immutable + אבחנים. פריט שלא ניתן
 * למדידה מקבל רשומת דחייה מפורשת — לא נעלם.
 */

const { environmentFingerprint, deepFreeze } = require('../typography/measure-api');
const { buildLineSequences, resolveStyleFor } = require('../line/line-items');

/** **תיקון ביקורת PR #22 (immutability):** תצוגת Map קריאה-בלבד של תוצאות
 * המדידה. Object.freeze על Map אינו חוסם set/delete/clear — כאן הם זורקים.
 * ממשק הקריאה זהה לבדיקות ולצרכנים (שלב 4): get/has/size/keys/values/
 * entries/forEach/[Symbol.iterator]. בלי עלות יצירה — עטיפה דקה על המפה הפנימית. */
class ReadOnlyMeasuredMap {
  constructor(map) {
    this._map = map || new Map();
    Object.freeze(this);
  }
  get size() { return this._map.size; }
  get(key) { return this._map.get(key); }
  has(key) { return this._map.has(key); }
  keys() { return this._map.keys(); }
  values() { return this._map.values(); }
  entries() { return this._map.entries(); }
  forEach(fn, thisArg) { return this._map.forEach(fn, thisArg); }
  [Symbol.iterator]() { return this._map[Symbol.iterator](); }
  set() { throw new TypeError('measureDocumentModel: מפת המדידות בלתי-ניתן לשינוי (immutable)'); }
  delete() { throw new TypeError('measureDocumentModel: מפת המדידות בלתי-ניתן לשינוי (immutable)'); }
  clear() { throw new TypeError('measureDocumentModel: מפת המדידות בלתי-ניתן לשינוי (immutable)'); }
}

/**
 * measureDocumentModel — מודד את כל פריטי השורה הקנוניים של המסמך.
 * מתזמר על buildLineSequences (אותו מנגנון של מנוע השורות — הוראה §5,
 * מימוש "א"): הכנת רצפים → מדידה אחת לכל פריט → הקפאה.
 * @param {object} model — פלט buildDocumentModel
 * @param {object} ctx — { settings, assetResolver, direction, language }
 * @returns {{ok:boolean, measured:Map, rejected:Array, stats:object, environmentFingerprint:string, sequences:Array}}
 */
function measureDocumentModel(model, ctx = {}) {
  if (!model || !Array.isArray(model.blocks)) {
    return { ok: false, measured: new ReadOnlyMeasuredMap(new Map()), rejected: deepFreeze([{ code: 'no-model', message: 'measureDocumentModel: מודל חסר' }]), stats: deepFreeze({ items: 0, measured: 0, rejected: 0 }), environmentFingerprint: environmentFingerprint(), sequences: [] };
  }
  const env = environmentFingerprint(ctx.environmentExtra || '');
  // אותם שלבי הכנה+מדידה של מנוע השורות — מנגנון אחד, לא שניים (הוראה §5).
  const built = buildLineSequences(model, {
    settings: ctx.settings || {},
    assetResolver: ctx.assetResolver || null,
    direction: ctx.direction || 'rtl',
    language: ctx.language || 'he',
    constraints: ctx.constraints || null
  });
  const measured = new Map();
  const rejected = [];
  for (const r of (built.rejected || [])) rejected.push({ itemId: r.itemId != null ? r.itemId : '-', kind: r.kind || 'sequence', blockId: r.blockId || null, code: r.code, message: r.message });
  let count = 0;
  for (const seq of built.sequences) {
    for (const it of seq.items) {
      if (it.role === 'penalty') continue; // אין לו מדידה מטבעו — לא נספר
      count++;
      if (it.measured && it.measured.ok) {
        measured.set(it.itemId, it.measured);
      } else {
        rejected.push({ itemId: it.itemId, kind: it.kind, blockId: seq.blockId, code: (it.measured && it.measured.code) || 'measure-failed', message: (it.measured && it.measured.message) || 'מדידת פריט-שורה נכשלה' });
      }
    }
  }
  return {
    ok: rejected.length === 0,
    measured: new ReadOnlyMeasuredMap(measured),
    rejected: deepFreeze(rejected),
    stats: deepFreeze({ items: count, measured: measured.size, rejected: rejected.length }),
    environmentFingerprint: env,
    sequences: built.sequences
  };
}

/** פתרון סגנון פריט — מיוצא הלאה מ-line-items (מקור יחיד; נותר כאן לצרכנים
 * קיימים — אותה פונקציה, לא עותק). */
module.exports = { measureDocumentModel, resolveStyleFor };
