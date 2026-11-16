// src/engine/measure/measure-model.js — מדידה קנונית של מסמך שלם לפני שבירת שורות (שלב 3)
'use strict';

/**
 * **חוזה:** spec/00 §3.3 — "תמונות וטווחי גופן נמדדים לפני שבירת שורות, כחלק
 * מהזרם" + "כל סוג פריט במודל מקבל מדידה קנונית". שכבה זו מודדת את כל
 * פריטי ה-Inline Item Model של DocumentModel דרך measureItem היחיד —
 * טקסט רב-גופני לפי ריצה, תמונות דרך AssetResolver, סמני הערה אטומים.
 *
 * **שלב 4 יצרוך את הפלט הזה** למנוע השורות המאוחד; אין כאן שום החלטת
 * שבירה/תכנון — מדידה בלבד (גבול השלב נשמר).
 *
 * **טוהר:** המודל לא משתנה; הפלט — מפה immutable של itemId → MeasuredItem
 * + אבחנים. פריט שלא ניתן למדידה מקבל רשומת דחייה מפורשת — לא נעלם.
 */

const { measureItem, environmentFingerprint, deepFreeze } = require('../typography/measure-api');
const fontResolver = require('../typography/font-resolver');

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
  set() { throw new TypeError('measureDocumentModel: \u05de\u05e4\u05ea \u05d4\u05de\u05d3\u05d9\u05d3\u05d5\u05ea \u05d1\u05dc\u05ea\u05d9-\u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05d9\u05e0\u05d5\u05d9 (immutable)'); }
  delete() { throw new TypeError('measureDocumentModel: \u05de\u05e4\u05ea \u05d4\u05de\u05d3\u05d9\u05d3\u05d5\u05ea \u05d1\u05dc\u05ea\u05d9-\u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05d9\u05e0\u05d5\u05d9 (immutable)'); }
  clear() { throw new TypeError('measureDocumentModel: \u05de\u05e4\u05ea \u05d4\u05de\u05d3\u05d9\u05d3\u05d5\u05ea \u05d1\u05dc\u05ea\u05d9-\u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05d9\u05e0\u05d5\u05d9 (immutable)'); }
}

/**
 * measureDocumentModel — מודד את כל פריטי המסמך.
 * @param {object} model — פלט buildDocumentModel
 * @param {object} ctx — { settings, assetResolver, direction, language,
 *                         styleResolver?: (item, block) => style }
 * @returns {{ ok:boolean, measured:Map, rejected:Array, stats:object, environmentFingerprint:string }}
 */
function measureDocumentModel(model, ctx = {}) {
  if (!model || !Array.isArray(model.blocks)) {
    return { ok: false, measured: new ReadOnlyMeasuredMap(new Map()), rejected: deepFreeze([{ code: 'no-model', message: 'measureDocumentModel: מודל חסר' }]), stats: deepFreeze({ items: 0, measured: 0, rejected: 0 }), environmentFingerprint: environmentFingerprint() };
  }
  const settings = ctx.settings || {};
  const dir = ctx.direction || 'rtl';
  const lang = ctx.language || 'he';
  const env = environmentFingerprint(ctx.environmentExtra || '');
  const measured = new Map();
  const rejected = [];
  const bodySize = Number.isFinite(settings['body-font-size-pt']) ? settings['body-font-size-pt'] : 12;
  const lineHeight = Number.isFinite(settings['body-line-height']) ? settings['body-line-height'] : 1.34;
  const fnSize = Number.isFinite(settings['f-note-body-size-pt']) ? settings['f-note-body-size-pt'] : 8;
  const defaultFamily = settings['body-font'] || null;
  const constraints = ctx.constraints || null;
  const constraintsKey = constraints ? `w${constraints.availableWidthPx || 'auto'}` : '';

  let count = 0;
  for (const blk of model.blocks) {
    for (const item of (blk.items || [])) {
      count++;
      // פתרון סגנון לפריט: גודל/גובה-שורה/גופנים לפי ריצה — דרך ה-resolver היחיד
      const style = resolveStyleFor(item, blk, { bodySize, lineHeight, fnSize, defaultFamily });
      const res = measureItem(item, style, {
        direction: dir, language: lang,
        assetResolver: ctx.assetResolver || null,
        environmentFingerprint: env,
        constraints, constraintsKey
      });
      if (res.ok) measured.set(item.id, res);
      else rejected.push({ itemId: item.id, kind: item.kind, blockId: blk.id, code: res.code, message: res.message });
    }
  }
  // גופי הערות — נמדדים כפריטי טקסט בגודל הרישום (אותו זרם, אותו חוזה).
  // **תיקון דיוק דוח שלב 3 (2.11 בתיקון שלב 4):** גוף הערה במודל שלב 2 הוא פריט
  // noteBody עם runs ב-payload שלו עצמו — לא `note.items`. הלולאה שלאותו עברה על רשימה ריקה ולא מדדה כלום; כעת הוא נמדד במפורש
  // (מוזר לפריט טקסט עם הריצות שלו, בסגנון רישום, עם זיווח אדרתי לשורת ההדרה).
  for (const note of (model.notes || [])) {
    const noteBase = { bodySize: fnSize, lineHeight: 1.2, fnSize, defaultFamily: settings['f-note-body-font'] || defaultFamily };
    const noteStyle = resolveStyleFor({ kind: 'noteBody' }, note, noteBase);
    if (note.kind === 'noteBody' && note.payload && Array.isArray(note.payload.runs) && note.payload.runs.length) {
      count++;
      const res = measureItem({ id: note.id, kind: 'text', payload: { runs: note.payload.runs } }, noteStyle, {
        direction: dir, language: lang,
        assetResolver: ctx.assetResolver || null,
        environmentFingerprint: env,
        constraints, constraintsKey
      });
      if (res.ok) measured.set(note.id, res);
      else rejected.push({ itemId: note.id, kind: 'noteBody', blockId: note.parentId || note.id, code: res.code, message: res.message });
    }
    for (const item of (note.items || [])) {
      count++;
      const style = resolveStyleFor(item, note, noteBase);
      const res = measureItem(item, style, {
        direction: dir, language: lang,
        assetResolver: ctx.assetResolver || null,
        environmentFingerprint: env,
        constraints, constraintsKey
      });
      if (res.ok) measured.set(item.id, res);
      else rejected.push({ itemId: item.id, kind: item.kind, blockId: note.id, code: res.code, message: res.message });
    }
  }

  // **תיקון ביקורת PR #22:** הפלט כוולו בלתי-ניתן לשינוי — המפה בתצוגה
  // קריאה-בלבד, הדחיות והסטטיסטיקה הוקפאו עמוקות (הערות
  // הדחיה הן מחרוזות/מספרים בלבד).
  return {
    ok: rejected.length === 0,
    measured: new ReadOnlyMeasuredMap(measured),
    rejected: deepFreeze(rejected),
    stats: deepFreeze({ items: count, measured: measured.size, rejected: rejected.length }),
    environmentFingerprint: env
  };
}

/** פתרון סגנון פריט: מזהי גופן לפי ריצה (מה-resolver), גודל לפי סוג הפריט. */
function resolveStyleFor(item, container, base) {
  const sizePt = item.kind === 'noteMarker' ? base.fnSize : base.bodySize;
  const fontIds = [];
  if (item.kind === 'text' && item.payload && Array.isArray(item.payload.runs)) {
    for (const run of item.payload.runs) {
      const fid = fontResolver.fontIdOfAlias(run.fontFamily) || fontResolver.fontIdOfAlias(base.defaultFamily);
      fontIds.push(fid);
    }
  } else if (base.defaultFamily) {
    fontIds.push(fontResolver.fontIdOfAlias(base.defaultFamily));
  }
  return {
    sizePt,
    lineHeight: item.kind === 'noteMarker' ? 1.2 : base.lineHeight,
    fontIds,
    family: (item.payload && item.payload.runs && item.payload.runs[0] && item.payload.runs[0].fontFamily) || base.defaultFamily,
    defaultFamily: base.defaultFamily
  };
}

/** פתרון סגנון פריט — מיוצא גם לשלב 4 (מנוע השורות משתמש באותו פתרון — מקור אחד, לא שכפול). */
module.exports = { measureDocumentModel, resolveStyleFor };
