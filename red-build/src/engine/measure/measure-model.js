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

const { measureItem, environmentFingerprint } = require('../typography/measure-api');
const fontResolver = require('../typography/font-resolver');

/**
 * measureDocumentModel — מודד את כל פריטי המסמך.
 * @param {object} model — פלט buildDocumentModel
 * @param {object} ctx — { settings, assetResolver, direction, language,
 *                         styleResolver?: (item, block) => style }
 * @returns {{ ok:boolean, measured:Map, rejected:Array, stats:object, environmentFingerprint:string }}
 */
function measureDocumentModel(model, ctx = {}) {
  if (!model || !Array.isArray(model.blocks)) {
    return { ok: false, measured: new Map(), rejected: [{ code: 'no-model', message: 'measureDocumentModel: מודל חסר' }], stats: { items: 0, measured: 0, rejected: 0 }, environmentFingerprint: environmentFingerprint() };
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
  // גופי הערות — נמדדים כפריטי טקסט בגודל הרישום (אותו זרם, אותו חוזה)
  for (const note of (model.notes || [])) {
    for (const item of (note.items || [])) {
      count++;
      const style = resolveStyleFor(item, note, { bodySize: fnSize, lineHeight: 1.2, fnSize, defaultFamily: settings['f-note-body-font'] || defaultFamily });
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

  return {
    ok: rejected.length === 0,
    measured, rejected,
    stats: { items: count, measured: measured.size, rejected: rejected.length },
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

module.exports = { measureDocumentModel };
