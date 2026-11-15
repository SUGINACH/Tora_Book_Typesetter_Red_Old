// src/engine/line/line-items.js — LineItem contract קנוני + בנאי הרצף (שלב 4, §4.1-1..3)
'use strict';

/**
 * **חוזה:** spec/00 §4.1-1 — "Line Item contract אחיד: box/glue/penalty או ייצוג
 * שקול, עם קישור ל-MeasuredItem ול-source identity." §4.1-3 — "לשמר fragments
 * של מילה אחת כאשר היא כוללת כמה משפחות גופן או סגנונות. שבירה אינה רשאית
 * למזג אותם למחרוזת שטוחה."
 *
 * **LineItem** — יחידת הקלט של מנוע השורות המאוחד (kp-linebreak.breakItemSequence).
 * שדות חובה (§13 בהוראת הביצוע): itemId, sourceRange/sourceAnchor, kind, fontId,
 * styleRef, measuredAdvance, inkBounds, breakOpportunities, constraints, diagnostics.
 * מילה מרובת-גופנים = תיבה אחת עם fragments מרובים — לעולם לא מחרוזת שטוחה.
 *
 * **בניית הרצף:** DocumentModel (שלב 2) → פיצול למילים לפי breaks.splitWordsOfRun
 * (מקור האמת להזדמנויות) → מדידת כל תיבה דרך measureItem היחיד (שלב 3) → רצף
 * box/glue/penalty מוכן ל-KP. אין מדידה שנייה ואין API מקבילי.
 */

const { measureItem } = require('../typography/measure-api');
const { resolveStyleFor } = require('../measure/measure-model');
const fontResolver = require('../typography/font-resolver');
const { splitWordsOfRun, breakBetweenItems } = require('./breaks');

/** גרסת חוזה פריט-השורה — חלק מזהות הרצף ומהאבחון. */
const LINE_ITEM_CONTRACT_VERSION = 'line-item-v1(box/glue/penalty+fragments)';

/** קבועי כותרת 3 (D-S2H3, שלב 2 — התנהגות שנקבעה ותוקנה): פסיחה בין-שורות
 * 34px, הפס האחרון 38px, הרווח התחתון (38−34) שייך לפריט כולו ומופיע פעם אחת
 * אחרי ה-fragment האחרון. ה-renderer אינו מוסיף ואינו מתקן. */
const H3_LINE_PITCH_PX = 34;
const H3_LAST_BAND_PX = 38;

/**
 * בניית רצף פריטי-שורה של מסמך שלם.
 * @param {object} model — פלט buildDocumentModel
 * @param {object} ctx — { settings, assetResolver, direction, language }
 * @returns {{ok, sequences:[{blockId, blockKind, semantic, items}], rejected, stats, contractVersion }}
 */
function buildLineSequences(model, ctx = {}) {
  if (!model || !Array.isArray(model.blocks)) {
    return { ok: false, sequences: [], rejected: [{ code: 'no-model', message: 'buildLineSequences: מודל חסר' }], stats: { blocks: 0, items: 0 }, contractVersion: LINE_ITEM_CONTRACT_VERSION };
  }
  const settings = ctx.settings || {};
  const dir = ctx.direction || 'rtl';
  const lang = ctx.language || 'he';
  const constraints = ctx.constraints || null;
  const constraintsKey = constraints ? `w${constraints.availableWidthPx || 'auto'}` : '';
  const base = {
    bodySize: Number.isFinite(settings['body-font-size-pt']) ? settings['body-font-size-pt'] : 12,
    lineHeight: Number.isFinite(settings['body-line-height']) ? settings['body-line-height'] : 1.34,
    fnSize: Number.isFinite(settings['f-note-body-size-pt']) ? settings['f-note-body-size-pt'] : 8,
    defaultFamily: settings['body-font'] || null
  };
  const sequences = [];
  const rejected = [];
  let itemCount = 0;

  const pushSeq = (blockId, blockKind, semantic, containers, baseOf) => {
    const items = [];
    for (const cont of containers) {
      const b = baseOf || base;
      const contStyle = resolveStyleFor(cont.item0Kind || 'text', cont, b);
      buildContainerItems(cont, contStyle, { dir, lang, constraints, constraintsKey, ctx }, items, rejected, () => itemCount++);
    }
    if (!items.length) return;
    items.push({ role: 'penalty', penaltyType: 'final', cost: 0, itemId: `${blockId}#end` });
    sequences.push({ blockId, blockKind, semantic: semantic || null, items });
  };

  for (const blk of model.blocks) {
    // סגנטיקה של כותרת 3 (§21 בהוראה): פריט סמנטי אחד — הרווח התחתון שייך לכולו.
    let semantic = null;
    if (blk.kind === 'heading' && blk.level === 3) {
      semantic = {
        kind: 'heading3', itemId: blk.id,
        linePitchPx: H3_LINE_PITCH_PX, lastBandPx: H3_LAST_BAND_PX,
        trailingSpacePx: H3_LAST_BAND_PX - H3_LINE_PITCH_PX,
        rule: 'bottom-space-once-after-last-fragment'
      };
    }
    pushSeq(blk.id, blk.kind, semantic, [{ ...blk, item0Kind: blk.items && blk.items[0] ? blk.items[0].kind : 'text' }]);
  }
  // גופי הערות שוברים באותו מנוע (§4.1-2: אין breaker נוסף להערות)
  // במודל שלב 2 גוף ההערה = פריט noteBody עם runs ב-payload; מוזר לכרטוס טקסט בסגנון רישום.
  const fnBase = {
    bodySize: Number.isFinite(settings['f-note-body-size-pt']) ? settings['f-note-body-size-pt'] : 8,
    lineHeight: 1.2,
    fnSize: Number.isFinite(settings['f-note-body-size-pt']) ? settings['f-note-body-size-pt'] : 8,
    defaultFamily: settings['f-note-body-font'] || settings['body-font'] || null
  };
  for (const note of (model.notes || [])) {
    const noteItems = (note.items && note.items.length)
      ? note.items
      : (note.kind === 'noteBody' && note.payload && Array.isArray(note.payload.runs) && note.payload.runs.length
        ? [{ id: `${note.id}#body`, kind: 'text', payload: { runs: note.payload.runs }, sourceRange: note.sourceRange, constraints: note.constraints }]
        : []);
    if (!noteItems.length) continue;
    pushSeq(note.id, 'note', null, [{ id: note.id, kind: 'note', items: noteItems, item0Kind: 'text' }], fnBase);
  }
  return {
    ok: rejected.length === 0,
    sequences, rejected,
    stats: { blocks: model.blocks.length + (model.notes || []).length, items: itemCount },
    contractVersion: LINE_ITEM_CONTRACT_VERSION
  };
}

/** בניית פריטי מיכל אחד (פסקה/כותרת/גוף הערה) — מילים, דבקות, אטומים, תמונות. */
function buildContainerItems(cont, style, env, out, rejected, bump) {
  const items = cont.items || [];
  // מעבר ראשון: פריטי מילים + יחסי צמידה (סמן הערה ⇄ עוגן)
  const boxes = []; // {box, joinedToPrev}
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'text') {
      splitTextItem(it, env, style, boxes, rejected, bump);
    } else if (it.kind === 'noteMarker' || it.kind === 'image' || it.kind === 'atomicToken' || it.kind === 'anchor' || it.kind === 'glue' || it.kind === 'penalty' || (it.kind && (it.kind === 'custom' || it.kind.startsWith('custom:')))) {
      boxes.push({ source: it, word: null, joinedToPrev: false });
    } else {
      rejected.push({ itemId: it.id, kind: it.kind, code: 'unsupported-in-line-sequence', message: `פריט לא נתמך ברצף שורות: ${it.kind}` });
    }
  }
  // צמידת סמן ⇄ עוגן (P1-3/BRZ-11): סמן בסוף שורה אסור — הסמן נצמד למילה שלפניו;
  // סמן בפתיחת הרצף נצמד למילה שאחריו. יחידה חורגת מהרוחב ⇒ הצמדה מתבטלת (כלל §6.2(5)).
  applyMarkerJoins(boxes, env, style);
  // מעבר שני: הזרמה לרצף — glue רגיל בין תיבות; יחידה צמודה = glue פנימי
  // (רוחב רווח, כמו NBSP במנוע הקיים) + penalty אסור — מבנית, לא עונש רך.
  let prev = null;
  for (const b of boxes) {
    if (prev && !b.joinedToPrev) {
      out.push(glueItemFor(prev, b, env, style, bump));
    } else if (prev && b.joinedToPrev) {
      out.push(internalGlueFor(prev, b, env, style, bump));
      out.push({ role: 'penalty', penaltyType: 'forbidden', cost: Number.POSITIVE_INFINITY, itemId: `${b.source.id}#join`, kind: 'penalty', contractVersion: LINE_ITEM_CONTRACT_VERSION, sourceItemId: b.source.id, sourceRange: null, measured: null, measuredAdvance: 0, fragments: [], breakOpportunities: [], constraints: null, diagnostics: [] });
    }
    out.push(boxItemFor(b, style, env, bump));
    prev = b;
  }
}

/** פיצול פריט טקסט למילים — כל מילה שומרת fragments פר-ריצה (§4.1-3). */
function splitTextItem(item, env, style, boxes, rejected, bump) {
  const runs = (item.payload && item.payload.runs) || [];
  if (!runs.length) { rejected.push({ itemId: item.id, kind: 'text', code: 'text-no-runs', message: 'פריט טקסט ללא ריצות' }); return; }
  // מילים לפי מקור האמת של הגבולות; מילה חוצת-ריצות = fragments מרובים
  const words = []; // {fragments:[{runIndex,text,start,end,fontFamily}], sepAfter, firstRunIndex}
  let runWordStart = null; // {wordIdx} של המילה הפתוחה בריצה הקודמת
  let carry = null; // מילה שנמשכת מריצה קודמת (גבול ריצה בתוך מילה)
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    const parts = splitWordsOfRun(String(run.text));
    if (!parts.length) continue;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      if (pi === 0 && carry !== null) {
        // המשך מילה מריצה קודמת — fragment נוסף של אותה מילה
        words[carry].fragments.push({ runIndex: ri, text: p.text, start: p.start, end: p.end, fontFamily: run.fontFamily || null });
        words[carry].sepAfter = p.sepAfter;
        carry = null;
        continue;
      }
      words.push({ fragments: [{ runIndex: ri, text: p.text, start: p.start, end: p.end, fontFamily: run.fontFamily || null }], sepAfter: p.sepAfter });
      if (p.sepAfter === null && pi === parts.length - 1) carry = words.length - 1; // המילה נמשכת לריצה הבאה
    }
    void runWordStart;
  }
  for (const w of words) {
    boxes.push({
      source: item,
      word: w,
      joinedToPrev: false,
      wordIndex: bump()
    });
  }
}

/** הזרמת תיבה אחת לרצף: בניית פריט-מילה קנוני + מדידה דרך measureItem היחיד. */
function boxItemFor(b, style, env, bump) {
  const src = b.source;
  if (b.word) {
    // פריט-מילה: kind 'text' עם ריצות-הפרגמנטים — נמדד כמכלול (advance = Σ פרגמנטים)
    const wordItemId = `${src.id}#w${b.wordIndex}`;
    const runsPayload = b.word.fragments.map((f) => ({ text: f.text, fontFamily: f.fontFamily || (style && style.family) || undefined }));
    const measureStyle = wordStyleFor(style, b.word.fragments);
    const m = measureItem({ id: wordItemId, kind: 'text', payload: { runs: runsPayload } }, measureStyle, env.ctx);
    const fragments = b.word.fragments.map((f, k) => ({
      itemId: wordItemId,
      runIndex: f.runIndex,
      text: f.text,
      start: f.start, end: f.end,
      fontId: (m.ok && m.segments && m.segments[k] && m.segments[k].fontId) || null,
      fontFamily: f.fontFamily || null,
      advancePx: (m.ok && m.segments && m.segments[k] && m.segments[k].advancePx) || 0
    }));
    return lineItemOf({
      role: 'box', kind: 'text', itemId: wordItemId, sourceItemId: src.id,
      fragments,
      measured: m,
      sourceRange: { blockId: null, itemId: src.id, runIndex: b.word.fragments[0].runIndex, start: b.word.fragments[0].start, end: b.word.fragments[b.word.fragments.length - 1].end },
      constraints: (src.constraints && { ...src.constraints }) || null,
      sepAfter: b.word.sepAfter
    });
  }
  // פריט מודל שלם (noteMarker/image/atomic/...) — תיבה בפני עצמה
  const m = measureItem(src, style, env.ctx);
  return lineItemOf({
    role: 'box', kind: src.kind, itemId: src.id, sourceItemId: src.id,
    fragments: (m.ok && m.segments ? m.segments.map((s) => ({ itemId: src.id, runIndex: 0, text: s.text, start: 0, end: String(s.text || '').length, fontId: s.fontId, fontFamily: s.family || null, advancePx: s.advancePx })) : []),
    measured: m,
    sourceRange: { blockId: null, itemId: src.id, runIndex: 0, start: 0, end: null },
    sourceAnchor: (src.payload && src.payload.noteRef) || null,
    constraints: (src.constraints && { ...src.constraints }) || null,
    atomic: src.kind !== 'text' // כל פריט שאינו מילת-טקסט — אטום ברצף (§4.1-5)
  });
}

/** glue בין שתי תיבות — המפריד המקורי המדויק (sepAfter) נשמר לשחזור מלא. */
function glueItemFor(prevBox, nextBox, env, style, bump) {
  const sep = (prevBox.word && prevBox.word.sepAfter) || ' ';
  const glueItemId = `${prevBox.source.id}#g${bump()}`;
  const m = measureItem({ id: glueItemId, kind: 'glue', payload: { text: sep } }, style, env.ctx);
  return lineItemOf({
    role: 'glue', kind: 'glue', itemId: glueItemId, sourceItemId: prevBox.source.id,
    sep,
    measured: m,
    sourceRange: { blockId: null, itemId: prevBox.source.id, runIndex: prevBox.word ? prevBox.word.fragments[prevBox.word.fragments.length - 1].runIndex : 0, start: null, end: null },
    constraints: null
  });
}

/** glue פנימי של יחידה צמודה (מקביל פנימי ל-NBSP במנוע הקיים): רוחב רווח, פנימי —
 * אסור לדלג בפתיחת שורה ואסור לחתוך בו (ה-penalty האסור שאחריו מבטיח זאת). */
function internalGlueFor(prevBox, nextBox, env, style, bump) {
  const sep = '\u00A0';
  const glueItemId = `${prevBox.source.id}#j${bump()}`;
  // המדידה ברוחב רווח (כמו המנוע הקיים: NBSP מוצג ברוחב רווח); sep=NBSP לזהות/שחזור
  const m = measureItem({ id: glueItemId, kind: 'glue', payload: { text: ' ' } }, style, env.ctx);
  return lineItemOf({
    role: 'glue', kind: 'glue', itemId: glueItemId, sourceItemId: prevBox.source.id,
    sep, internal: true,
    measured: m,
    sourceRange: { blockId: null, itemId: prevBox.source.id, runIndex: prevBox.word ? prevBox.word.fragments[prevBox.word.fragments.length - 1].runIndex : 0, start: null, end: null },
    constraints: null
  });
}

/** צמידת סמני הערה לעוגן — לפי הכללים התקפים (P1-3/BRZ-11), מנוסח פעם אחת. */
function applyMarkerJoins(boxes, env, style) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b.source || b.source.kind !== 'noteMarker') continue;
    const prev = i > 0 ? boxes[i - 1] : null;
    const next = i + 1 < boxes.length ? boxes[i + 1] : null;
    if (prev && !prev.joinedToPrev && !(prev.source && prev.source.kind === 'noteMarker')) {
      if (unitFits(prev, b, env, style)) { b.joinedToPrev = true; continue; }
    }
    if (!prev && next) {
      if (unitFits(b, next, env, style)) { next.joinedToPrev = true; continue; }
    }
  }
}

/** בדיקת התאמת יחידה צמודה לרוחב — יחידה חורגת ⇒ הצמדה מתבטלת (לא גלישה). */
function unitFits(a, b, env, style) {
  const maxW = env.constraints && Number.isFinite(env.constraints.availableWidthPx) ? env.constraints.availableWidthPx : null;
  if (maxW == null) return true; // אין אילוץ ידוע — הצמדה נשמרת (ההחלטה הסופית ב-KP)
  const wa = advanceOf(a, style, env);
  const wb = advanceOf(b, style, env);
  const space = 0; // יחידת צמידה: ללא רווח בין-מילים (מקביל ל-NBSP)
  return (wa + space + wb) <= maxW;
}

function advanceOf(b, style, env) {
  if (b._adv != null) return b._adv;
  const it = boxItemFor(b, style, env, () => 0);
  b._adv = it.measured && it.measured.ok ? it.measured.advance : 0;
  return b._adv;
}

/** סגנון מילה: fontIds לפי הריצות של אותה מילה בלבד. */
function wordStyleFor(style, fragments) {
  return { ...style, fontIds: fragments.map((f) => fontResolver.fontIdOfAlias(f.fontFamily || (style && style.family) || '') || (style && style.fontIds && style.fontIds[0]) || null) };
}

/** הרכבת LineItem סופי — כל שדות החוזה מולאו; הקישור ל-MeasuredItem שלם. */
function lineItemOf(base) {
  const m = base.measured;
  const ok = !!(m && m.ok);
  return {
    contractVersion: LINE_ITEM_CONTRACT_VERSION,
    role: base.role,                 // 'box' | 'glue' | 'penalty'
    kind: base.kind,                 // text/noteMarker/image/atomicToken/anchor/glue/penalty
    itemId: base.itemId,
    sourceItemId: base.sourceItemId != null ? base.sourceItemId : base.itemId,
    sourceRange: base.sourceRange || null,
    sourceAnchor: base.sourceAnchor || null,
    fontId: ok && m.segments && m.segments[0] ? (m.segments[0].fontId || null) : null,
    styleRef: base.styleRef || null,
    atomic: !!base.atomic,
    // קישור למדידה (§4.1-1): ה-MeasuredItem הקפוא עצמו + השדות שחייבים להישמר ישירות
    measured: m || null,
    measuredAdvance: ok ? m.advance : 0,
    inkBounds: ok ? m.inkBounds : null,
    breakOpportunities: ok ? m.breakOpportunities : [],
    constraints: base.constraints || null,
    diagnostics: ok ? (m.diagnostics || []) : [{ code: m && m.code, message: m && m.message, measureFailed: true }],
    // פרגמנטים (§4.1-3): מילה מרובת גופנים — לעולם לא מחרוזת שטוחה
    fragments: base.fragments || [],
    // glue/penalty semantics
    sep: base.sep != null ? base.sep : null,
    internal: !!base.internal,
    penaltyType: base.penaltyType || null,
    cost: base.cost != null ? base.cost : 0
  };
}

module.exports = {
  LINE_ITEM_CONTRACT_VERSION, buildLineSequences,
  H3_LINE_PITCH_PX, H3_LAST_BAND_PX
};
