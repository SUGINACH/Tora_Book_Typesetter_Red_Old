// src/engine/model/validate.js — אימות סכמה קשיח של המודל הקנוני (שלב 2)
// **חוזה:** spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §2.1-10 — "סוג לא מוכר,
// asset חסר, טווח פונט פגום, עוגן יתום או מבנה היררכי לא תקין אינם נעלמים
// בשקט". כל הפרה מדווחת במפורש {code, severity, where, message} — אין תיקון
// שקט ואין השמטה. הבדיקה טהורה: אין שינוי של המודל.
'use strict';

const { isBlockKind, isItemKind } = require('./kinds');
const { descriptorOf, registeredKinds } = require('./registry');

const BUILTIN_ITEM_SHAPE = {
  text: { requires: ['payload.text', 'payload.runs'], forbidden: ['payload.noteRef', 'payload.assetId'] },
  noteMarker: { requires: ['payload.noteRef'], forbidden: ['payload.assetId'] },
  image: { requires: ['payload.assetId', 'payload.resourcePath'], forbidden: ['payload.noteRef'] },
  anchor: { requires: [], forbidden: ['payload.noteRef'] },
  atomicToken: { requires: ['payload.text'], forbidden: [] },
  glue: { requires: [], forbidden: [] },
  penalty: { requires: [], forbidden: [] },
  custom: { requires: [], forbidden: [] }
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * validateDocumentModel — מחזיר { ok, errors, warnings }.
 * ok=false רק על הפרות מבנה (שגיאות); אזהרות מתועדות אך אינן פוסלות.
 */
function validateDocumentModel(model) {
  const errors = [];
  const warnings = [];
  const err = (code, where, message) => errors.push({ code, where, message, severity: 'error' });
  const warn = (code, where, message) => warnings.push({ code, where, message, severity: 'warning' });

  if (!model || typeof model !== 'object') {
    return { ok: false, errors: [{ code: 'model-missing', where: 'model', message: 'המודל אינו אובייקט.', severity: 'error' }], warnings };
  }
  if (!model.docId) err('doc-id-missing', 'model', 'חסר מזהה מסמך.');
  if (!Array.isArray(model.blocks)) err('blocks-missing', 'model', 'חסר מערך בלוקים.');

  const seenIds = new Map();
  const noteIds = new Set();
  for (const n of model.notes || []) noteIds.add(n.id);
  const blockIds = new Set((model.blocks || []).map(b => b.id));

  // ── בלוקים ──
  let lastWasHeading = false;  // שתי כותרות רצופות מאותה רמה בלי טקסט ביניהן — מבנה לא תקין (תנאי המשתמש)
  let lastHeadingLevel = null;
  for (const b of model.blocks || []) {
    const where = `block[${b && b.order}]`;
    if (!b || typeof b !== 'object') { err('block-invalid', where, 'בלוק אינו אובייקט.'); continue; }
    if (!b.id) err('block-id-missing', where, 'בלוק ללא מזהה.');
    else if (seenIds.has(b.id)) err('block-id-duplicate', where, `מזהה בלוק כפול: ${b.id} (ראשון: ${seenIds.get(b.id)}).`);
    else seenIds.set(b.id, where);
    if (!isBlockKind(b.kind)) err('block-kind-unknown', where, `סוג בלוק לא מוכר: ${String(b.kind)}.`);
    if (!Number.isInteger(b.order)) err('block-order-missing', where, 'בלוק ללא order.');
    if (!b.sourceRange || !Number.isInteger(b.sourceRange.start) || !Number.isInteger(b.sourceRange.end) || b.sourceRange.end < b.sourceRange.start) {
      err('block-source-range-invalid', where, 'טווח מקור של בלוק שגוי או חסר.');
    }
    if (b.kind === 'heading') {
      if (!Number.isInteger(b.level) || b.level < 0 || b.level > 7) {
        err('heading-level-invalid', where, `רמת כותרת שגויה: ${String(b.level)} (חובה 0–7).`);
      }
      const hasText = (b.items || []).some(it => it.kind === 'text' && it.payload && it.payload.text && it.payload.text.trim().length > 0);
      if (!hasText) err('heading-without-text', where, 'כותרת ללא טקסט ממשי — מבנה לא תקין (כותרת שתוכנה ריק אינה חוקית).');
      // שתי כותרות רצופות מאותה רמה ללא תוכן ביניהן — מבנה לא תקין מבחינת המשתמש.
      if (lastWasHeading && lastHeadingLevel === b.level) {
        err('consecutive-headings-no-text', where, `שתי כותרות רצופות מרמה ${b.level} ללא טקסט ביניהן — מסמך הבדיקה חייב מבנה תקין.`);
      }
    }
    if (b.parentId != null && !blockIds.has(b.parentId)) {
      err('block-parent-orphan', where, `parentId לא קיים כבלוק: ${b.parentId}.`);
    }
    lastWasHeading = b.kind === 'heading';
    if (lastWasHeading) lastHeadingLevel = b.level;

    // ── פריטים ──
    let prevOrder = -1;
    for (const it of b.items || []) {
      const iwhere = `${where}→item[${it && it.order}]`;
      if (!it || typeof it !== 'object') { err('item-invalid', iwhere, 'פריט אינו אובייקט.'); continue; }
      if (!it.id) err('item-id-missing', iwhere, 'פריט ללא מזהה.');
      else if (seenIds.has(it.id)) err('item-id-duplicate', iwhere, `מזהה פריט כפול: ${it.id} (ראשון: ${seenIds.get(it.id)}).`);
      else seenIds.set(it.id, iwhere);
      if (!isItemKind(it.kind)) err('item-kind-unknown', iwhere, `סוג פריט לא מוכר ולא רשום: ${String(it.kind)}.`);
      else if (it.kind.startsWith('custom:') && !descriptorOf(it.kind)) {
        err('custom-kind-unregistered', iwhere, `סוג מותאם לא רשום ב-registry: ${it.kind}.`);
      }
      if (it.parentId !== b.id) err('item-parent-mismatch', iwhere, `parentId של פריט (${it.parentId}) אינו הבלוק המכיל (${b.id}).`);
      if (!Number.isInteger(it.order)) err('item-order-missing', iwhere, 'פריט ללא order.');
      else if (it.order !== prevOrder + 1) err('item-order-gap', iwhere, `רצף order שבור: ציפה ${prevOrder + 1}, קיבל ${it.order}.`);
      else prevOrder = it.order;
      if (!it.sourceRange || !Number.isInteger(it.sourceRange.start) || !Number.isInteger(it.sourceRange.end) || it.sourceRange.end < it.sourceRange.start) {
        err('item-source-range-invalid', iwhere, 'טווח מקור של פריט שגוי או חסר — אובדן מיפוי מקור.');
      }
      if (typeof it.sourceText !== 'string') err('item-source-text-missing', iwhere, 'פריט ללא sourceText — לא ניתן להוכיח שימור.');
      // צורה לפי סוג
      const shape = BUILTIN_ITEM_SHAPE[it.kind];
      if (shape) {
        for (const req of shape.requires) if (getPath(it, req) == null) err('item-shape-missing-field', iwhere, `פריט ${it.kind} חסר שדה חובה ${req}.`);
        for (const fbd of shape.forbidden) if (getPath(it, fbd) != null) err('item-shape-forbidden-field', iwhere, `פריט ${it.kind} אינו רשאי לשאת ${fbd}.`);
      }
      if (it.kind === 'noteMarker') {
        if (!noteIds.has(it.payload.noteRef)) err('note-marker-orphan', iwhere, `סמן הערה מקשר לגוף הערה שאינו קיים: ${it.payload.noteRef}.`);
      }
      if (it.kind === 'text') {
        const runs = it.payload.runs;
        if (!Array.isArray(runs) || runs.length === 0) err('text-item-runs-empty', iwhere, 'פריט טקסט ללא מקטעים.');
        else {
          for (const r of runs) {
            if (typeof r.text !== 'string') err('run-text-missing', iwhere, 'מקטע ללא טקסט.');
            if (r.sourceStart == null || r.sourceEnd == null || r.sourceEnd < r.sourceStart) err('run-source-invalid', iwhere, 'מקטע עם טווח מקור שגוי — טווח גופן פגום.');
          }
        }
      }
      if (it.kind === 'image') {
        if (!it.payload.assetId || typeof it.payload.assetId !== 'string' || !it.payload.assetId.startsWith('ast-')) {
          err('image-asset-id-invalid', iwhere, 'תמונה ללא assetId תקין — זהות נכס חסרה.');
        }
        if (it.payload.naturalWidth == null || it.payload.naturalHeight == null) {
          // שלב 3 ימלא — עדיין מתועד במפורש, לא נבלע
          warn('image-dimensions-pending', iwhere, 'מידות טבעיות של התמונה ייפתרו בשלב 3 (AssetResolver).');
        }
      }
    }
  }

  // ── גופי הערות ──
  const markerRefs = new Set();
  for (const b of model.blocks || []) for (const it of b.items || []) if (it.kind === 'noteMarker') markerRefs.add(it.payload.noteRef);
  for (const n of model.notes || []) {
    const where = `note[${n && n.order}]`;
    if (!n || !n.id) { err('note-id-missing', where, 'גוף הערה ללא מזהה.'); continue; }
    if (seenIds.has(n.id)) err('note-id-duplicate', where, `מזהה הערה כפול: ${n.id}.`);
    else seenIds.set(n.id, where);
    if (!markerRefs.has(n.id)) err('note-body-orphan', where, `גוף הערה ללא סמן מקשר: ${n.id}.`);
    if (n.payload && n.payload.markerRef && !seenIds.has(n.payload.markerRef) && !model.blocks.some(b => (b.items || []).some(it => it.id === n.payload.markerRef))) {
      err('note-marker-ref-invalid', where, `markerRef אינו מצביע על סמן קיים: ${n.payload.markerRef}.`);
    }
    if (!n.sourceRange) err('note-source-range-missing', where, 'גוף הערה ללא טווח מקור.');
    if (!n.continuation || !n.continuation.sharedId) err('note-continuation-identity-missing', where, 'גוף הערה ללא זהות המשך — פיצול עתידי יאבד קישור.');
  }

  // ── עוגנים ──
  for (const a of model.anchors || []) {
    const where = `anchor[${a && a.id}]`;
    if (!a || !a.id) { err('anchor-id-missing', where, 'עוגן ללא מזהה.'); continue; }
    if (a.targetBlockId && !blockIds.has(a.targetBlockId)) err('anchor-target-block-orphan', where, `עוגן מצביע לבלוק שאינו קיים: ${a.targetBlockId}.`);
    if (a.targetItemId && !seenIds.has(a.targetItemId)) err('anchor-target-item-orphan', where, `עוגן מצביע לפריט שאינו קיים: ${a.targetItemId}.`);
  }

  // ── שלד המקור ──
  const covered = new Set();
  for (const sk of (model.source && model.source.skeleton) || []) covered.add(sk.lineIndex);
  const lineCount = (model.source && model.source.lineMap || []).length;
  for (let i = 0; i < lineCount; i++) {
    if (!covered.has(i)) err('skeleton-line-uncovered', `line[${i}]`, 'שורת מקור שאינה מסווגת בשלד — אובדן מיפוי מקור אפשרי.');
  }

  return { ok: errors.length === 0, errors, warnings, stats: { blocks: (model.blocks || []).length, notes: (model.notes || []).length, items: (model.blocks || []).reduce((s, b) => s + (b.items || []).length, 0), anchors: (model.anchors || []).length, registeredCustomKinds: registeredKinds() } };
}

module.exports = { validateDocumentModel };
