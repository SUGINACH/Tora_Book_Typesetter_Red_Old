// src/engine/line/line-items.js — LineItem contract קנוני + בנאי הרצף (שלב 4, §4.1-1..3)
'use strict';

/**
 * **חוזה:** spec/00 §4.1-1 — "Line Item contract אחיד: box/glue/penalty או ייצוג
 * שקול, עם קישור ל-MeasuredItem ול-source identity." §4.1-3 — "לשמר fragments
 * של מילה אחת כאשר היא כוללת כמה משפחות גופן או סגנונות. שבירה אינה רשאית
 * למזג אותם למחרוזת שטוחה."
 *
 * **LineItem** — יחידת הקלט של מנוע השורות המאוחד (kp-linebreak.breakItemSequence).
 * שדות חוזה (§13 בהוראת הביצוע): itemId, sourceRange/sourceAnchor, kind, fontId,
 * styleRef, measuredAdvance, inkBounds, breakOpportunities, constraints, diagnostics.
 * מילה מרובת-גופנים = תיבה אחת עם fragments מרובים — לעולם לא מחרוזת שטוחה.
 *
 * **זהות נגזרת-מקור (§3.5 בהוראה, תיקון שורש):** מזהי מילים/רווחים נגזרים
 * מזהות פריט המקור ומטווח המקור המוחלט שלהם — `#w@<docStart>-<docEnd>` /
 * `#g@<docStart>-<docEnd>` — ולא ממונה רץ. אותו מסמך ⇒ אותם מזהים בכל בנייה;
 * שינוי תוכן באותו טווח אינו יוצר התנגשות (מפתח המדידה של שלב 3 כולל טביעת
 * payload מלאה). sourceRange ממופה לקואורדינטות המסמך הקנוניות (לא אינדקס
 * מקומי בריצה), ו-blockId ממולא תמיד כשהוא ידוע.
 *
 * **בניית הרצף:** DocumentModel (שלב 2) → פיצול למילים לפי breaks.splitWordsOfRun
 * (מקור האמת להזדמנויות) → מדידת כל תיבה דרך measureItem היחיד (שלב 3) → רצף
 * box/glue/penalty מוכן ל-KP. אין מדידה שנייה ואין API מקבילי.
 */

const { measureItem } = require('../typography/measure-api');
const { resolveStyleFor } = require('../measure/measure-model');
const fontResolver = require('../typography/font-resolver');
const { splitWordsOfRun } = require('./breaks');

/** גרסת חוזה פריט-השורה — חלק מזהות הרצף ומהאבחון.
 * v2: זהות נגזרת-מקור (ביטול המונה הרץ), sourceRange מוחלט + blockId,
 * מפרידים מדויקים בין פריטים (פער מקור), תיקון carry חוצה-ריצות. */
const LINE_ITEM_CONTRACT_VERSION = 'line-item-v2(source-derived-identity)';

/** קבועי כותרת 3 (D-S2H3, שלב 2 — התנהגות שנקבעה ותוקנה): פסיחה בין-שורות
 * 34px, הפס האחרון 38px, הרווח התחתון (38−34) שייך לפריט כולו ומופיע פעם אחת
 * אחרי ה-fragment האחרון. ה-renderer אינו מוסיף ואינו מתקן. */
const H3_LINE_PITCH_PX = 34;
const H3_LAST_BAND_PX = 38;

/**
 * בניית רצף פריטי-שורה של מסמך שלם.
 * @param {object} model — פלט buildDocumentModel
 * @param {object} ctx — { settings, assetResolver, direction, language, constraints }
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
      buildContainerItems(cont, contStyle, { dir, lang, constraints, constraintsKey, ctx, blockId }, items, rejected);
    }
    if (!items.length) return;
    itemCount += items.length;
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
function buildContainerItems(cont, style, env, out, rejected) {
  const items = cont.items || [];
  // מעבר ראשון: פריטי מילים + יחסי צמידה (סמן הערה ⇄ עוגן)
  const boxes = []; // {source, word, joinedToPrev, trailingSep}
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'text') {
      splitTextItem(it, env, style, boxes, rejected);
    } else if (it.kind === 'noteMarker' || it.kind === 'image' || it.kind === 'atomicToken' || it.kind === 'anchor' || it.kind === 'glue' || it.kind === 'penalty' || (it.kind && (it.kind === 'custom' || it.kind.startsWith('custom:')))) {
      boxes.push({ source: it, word: null, joinedToPrev: false });
    } else {
      rejected.push({ itemId: it.id, kind: it.kind, code: 'unsupported-in-line-sequence', message: `פריט לא נתמך ברצף שורות: ${it.kind}` });
    }
  }
  // צמידת סמן ⇄ עוגן (P1-3/BRZ-11): הקישור מבוסס על noteRef — זהות העוגן
  // במודל המקור, לא על סמיכות מקרית של תיבות. סמן בסוף שורה אסור — הסמן נצמד
  // למילה שלפניו; סמן בפתיחת הרצף נצמד למילה שאחריו. יחידה חורגת מהרוחב ⇒
  // הצמדה מתבטלת ומטופלת בערוץ ה-overflow המפורש (כלל §6.2(5)).
  applyMarkerJoins(boxes, env, style);
  // מעבר שני: הזרמה לרצף — glue המפריד המדויק בין תיבות; יחידה צמודה =
  // glue פנימי (רוחב רווח, כמו NBSP במנוע הקיים) + penalty אסור — מבנית.
  let prev = null;
  for (const b of boxes) {
    if (prev && !b.joinedToPrev) {
      out.push(glueItemFor(prev, b, env, style));
    } else if (prev && b.joinedToPrev) {
      out.push(internalGlueFor(prev, b, env, style));
      out.push({
        role: 'penalty', penaltyType: 'forbidden', cost: Number.POSITIVE_INFINITY,
        itemId: `${b.source.id}#join@${boxDocStart(b)}-${boxDocEnd(b)}`,
        kind: 'penalty', contractVersion: LINE_ITEM_CONTRACT_VERSION,
        sourceItemId: b.source.id, sourceRange: null, measured: null, measuredAdvance: 0,
        fragments: [], breakOpportunities: [], constraints: null, diagnostics: []
      });
    }
    out.push(boxItemFor(b, style, env));
    prev = b;
  }
}

/**
 * פיצול פריט טקסט למילים — כל מילה שומרת fragments פר-ריצה (§4.1-3).
 * **תיקון שורש (§3.5):** מילה חוצת-ריצות ממשיכה רק כשהריצה הבאה פותחת
 * בהמשך המילה עצמו (תו ראשון, בלי רווח מוביל ובלי מפריד שנצבר). ריצה
 * שפותחת ברווח — סוגרת את המילה הפתוחה עם המפריד המדויק; בעבר המילים
 * התמזגו והרווח ביניהן אבד ("אחר בסוף" ⇒ "אחרבסוף" — הפרת §22).
 */
function splitTextItem(item, env, style, boxes, rejected) {
  void style;
  const runs = (item.payload && item.payload.runs) || [];
  if (!runs.length) { rejected.push({ itemId: item.id, kind: 'text', code: 'text-no-runs', message: 'פריט טקסט ללא ריצות' }); return; }
  // היסט מוחלט של כל ריצה בקואורדינטות המסמך הקנוניות: sourceRange של הפריט
  // = canonicalBase + הריצה הראשונה; כל ריצה מוסטת לפי sourceStart שלה עצמה.
  const run0 = runs[0];
  const itemAbsStart = item.sourceRange && Number.isFinite(item.sourceRange.start) ? item.sourceRange.start : 0;
  const runDocOffset = (ri) => itemAbsStart + (Number.isFinite(runs[ri].sourceStart) ? runs[ri].sourceStart : 0) - (Number.isFinite(run0.sourceStart) ? run0.sourceStart : 0);
  const words = []; // {fragments, sep, sepRange} — sep = המפריד אחרי המילה (מדויק)
  let carry = null;        // מילה פתוחה שנמשכת לריצה הבאה
  let pendingSep = null;   // {text, fromRun, fromStart, toRun, toEnd} — מפריד שנצבר מסוף המילה האחרונה
  const addPending = (text, ri, start, end) => {
    if (!text) return;
    if (pendingSep) { pendingSep.text += text; pendingSep.toRun = ri; pendingSep.toEnd = end; }
    else pendingSep = { text, fromRun: ri, fromStart: start, toRun: ri, toEnd: end };
  };
  const flushSepToLastWord = () => {
    if (pendingSep && words.length) {
      const w = words[words.length - 1];
      w.sep = pendingSep.text; w.sepRange = pendingSep;
      pendingSep = null;
    }
  };
  for (let ri = 0; ri < runs.length; ri++) {
    const runText = String(runs[ri].text == null ? '' : runs[ri].text);
    const parts = splitWordsOfRun(runText);
    if (!parts.length) {
      // ריצת רווחים בלבד (או ריקה): רווחים שבה נצברים למפריד — לא אובדים.
      if (runText.length) addPending(runText, ri, 0, runText.length);
      continue;
    }
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      // מפריד בתוך הריצה: בין חלק k לחלק k+1 עומד בדיוק ה-sepAfter של חלק k
      // (splitWordsOfRun מבטיח רצף) — אין חישוב נוסף ואין ספירה כפולה.
      // רק בפתיחת ריצה (pi===0) ייתכנו רווחים מובילים של הריצה עצמה — הם
      // נצברים למפריד שבין המילים (מצטברים עם סוף-הריצה הקודמת, בלי כפילות).
      if (pi === 0 && p.start > 0) {
        addPending(runText.slice(0, p.start), ri, 0, p.start);
      }
      if (pi === 0 && carry !== null && p.start === 0 && pendingSep === null) {
        // המשך מילה מריצה קודמת — fragment נוסף של אותה מילה (גופן שונה באמצע מילה)
        words[carry].fragments.push({
          runIndex: ri, text: p.text, start: p.start, end: p.end,
          docStart: runDocOffset(ri) + p.start, docEnd: runDocOffset(ri) + p.end,
          fontFamily: runs[ri].fontFamily || null
        });
        if (p.sepAfter != null) {
          addPending(p.sepAfter, ri, p.end, p.end + p.sepAfter.length);
          carry = null;
        }
        // p.sepAfter === null ⇒ המילה ממשיכה גם לריצה הבאה — ה-carry נשאר פתוח
        continue;
      }
      if (carry !== null) {
        // מילה פתוחה שלא הומשכה (רווח מוביל/מפריד שנצבר) — נסגרת עם המפריד שנצבר
        if (pendingSep) { words[carry].sep = pendingSep.text; words[carry].sepRange = pendingSep; pendingSep = null; }
        carry = null;
      }
      if (words.length === 0 && pendingSep) {
        // רווחים מובילים של הפריט לפני המילה הראשונה — הטוקנייזר מסיר אותם
        // (blk.source.rawLead); אין לייחס אותם כמפריד שאחרי המילה הראשונה.
        pendingSep = null;
      }
      flushSepToLastWord();
      words.push({
        fragments: [{
          runIndex: ri, text: p.text, start: p.start, end: p.end,
          docStart: runDocOffset(ri) + p.start, docEnd: runDocOffset(ri) + p.end,
          fontFamily: runs[ri].fontFamily || null
        }],
        sep: null, sepRange: null // יוקצו כשהמילה הבאה תיפתח (המפריד המדויק שנצבר)
      });
      if (p.sepAfter != null) {
        addPending(p.sepAfter, ri, p.end, p.end + p.sepAfter.length);
      } else if (pi === parts.length - 1) {
        carry = words.length - 1; // המילה נמשכת לריצה הבאה
      }
    }
  }
  // המפריד שנצבר בסוף הפריט ולא נצרך — שייך בין תיבה אחרונה לבאה אחריה (מועבר ב-trailingSep)
  for (const w of words) {
    boxes.push({ source: item, word: w, joinedToPrev: false });
  }
  if (words.length && pendingSep) {
    boxes[boxes.length - 1].trailingSep = pendingSep; // בין פריט זה לפריט הבא (רווחי סוף-ריצה)
  }
}

/** הזרמת תיבה אחת לרצף: בניית פריט-מילה קנוני + מדידה דרך measureItem היחיד. */
function boxItemFor(b, style, env) {
  const src = b.source;
  if (b.word) {
    // פריט-מילה: kind 'text' עם ריצות-הפרגמנטים — נמדד כמכלול (advance = Σ פרגמנטים)
    const f0 = b.word.fragments[0];
    const fN = b.word.fragments[b.word.fragments.length - 1];
    const docStart = f0.docStart, docEnd = fN.docEnd;
    const wordItemId = `${src.id}#w@${docStart}-${docEnd}`;
    const runsPayload = b.word.fragments.map((f) => ({ text: f.text, fontFamily: f.fontFamily || (style && style.family) || undefined }));
    const measureStyle = wordStyleFor(style, b.word.fragments);
    const m = measureItem({ id: wordItemId, kind: 'text', payload: { runs: runsPayload } }, measureStyle, env.ctx);
    const fragments = b.word.fragments.map((f, k) => ({
      itemId: wordItemId,
      runIndex: f.runIndex,
      text: f.text,
      start: f.start, end: f.end,
      docStart: f.docStart, docEnd: f.docEnd,
      fontId: (m.ok && m.segments && m.segments[k] && m.segments[k].fontId) || null,
      fontFamily: f.fontFamily || null,
      advancePx: (m.ok && m.segments && m.segments[k] && m.segments[k].advancePx) || 0
    }));
    return lineItemOf({
      role: 'box', kind: 'text', itemId: wordItemId, sourceItemId: src.id,
      fragments,
      measured: m,
      sourceRange: {
        blockId: env.blockId, itemId: src.id,
        runIndex: f0.runIndex,
        start: docStart, end: docEnd,
        runLocal: { start: f0.start, end: fN.end }
      },
      constraints: (src.constraints && { ...src.constraints }) || null
    });
  }
  // פריט מודל שלם (noteMarker/image/atomic/...) — תיבה בפני עצמה
  const m = measureItem(src, style, env.ctx);
  const sr = src.sourceRange || null;
  const itemNoteRef = (src.payload && src.payload.noteRef) || null;
  return lineItemOf({
    role: 'box', kind: src.kind, itemId: src.id, sourceItemId: src.id,
    fragments: (m.ok && m.segments ? m.segments.map((s) => ({ itemId: src.id, runIndex: 0, text: s.text, start: 0, end: String(s.text || '').length, docStart: sr ? sr.start : null, docEnd: sr ? sr.end : null, fontId: s.fontId, fontFamily: s.family || null, advancePx: s.advancePx })) : []),
    measured: m,
    sourceRange: { blockId: env.blockId, itemId: src.id, runIndex: 0, start: sr ? sr.start : null, end: sr ? sr.end : null },
    sourceAnchor: itemNoteRef,
    noteRef: itemNoteRef,
    constraints: (src.constraints && { ...src.constraints }) || null,
    atomic: src.kind !== 'text' // כל פריט שאינו מילת-טקסט — אטום ברצף (§4.1-5)
  });
}

/**
 * המפריד המדויק בין שתי תיבות עוקבות (§3.1/§22 — שחזור מלא של המקור):
 * (א) שתי מילים מאותו פריט טקסט — ה-sep שנצבר בפיצול (מחרוזת מדויקת, כולל
 *     רווחים מרובים וריצות-רווח שלמות שביניהן).
 * (ב) תיבות מפריטים שונים — רווחי סוף-הפריט שנצברו + הפער המוחלט במקור
 *     (nextStart − prevEnd ברווחים; תחביר סמנים שייך לטווח הפריט עצמו ואינו
 *     נכנס לפער). מדויק לחלוטין עבור המודל הקנוני של שלב 2.
 */
function separatorOf(prevBox, nextBox) {
  const prevSrc = prevBox.source, nextSrc = nextBox.source;
  const sameItem = prevSrc === nextSrc || (prevSrc.id != null && prevSrc.id === nextSrc.id);
  if (sameItem && prevBox.word && nextBox.word && prevBox.word.sep != null) {
    const r = prevBox.word.sepRange || { fromRun: 0, fromStart: 0, toRun: 0, toEnd: prevBox.word.sep.length };
    return { sep: prevBox.word.sep, range: r, owner: prevSrc };
  }
  // בין פריטים (או מילה-אחרונה בפריט): רווחי סוף + הפער המוחלט
  const tail = (prevBox.word && prevBox.trailingSep) ? prevBox.trailingSep.text : '';
  const prevEnd = boxDocEnd(prevBox);
  const nextStart = boxDocStart(nextBox);
  const gap = (Number.isFinite(prevEnd) && Number.isFinite(nextStart)) ? Math.max(0, nextStart - prevEnd) : 1;
  const sep = tail + ' '.repeat(gap);
  const r = (prevBox.word && prevBox.trailingSep) ? prevBox.trailingSep : { fromRun: 0, fromStart: 0, toRun: 0, toEnd: 0 };
  return {
    sep, owner: prevSrc,
    range: { fromRun: r.fromRun, fromStart: r.fromStart, toRun: r.toRun, toEnd: r.toEnd + gap },
    crossItem: !sameItem
  };
}

/** המיקום המוחלט של תחילת/סיום תיבה בקואורדינטות המסמך הקנוניות. */
function boxDocStart(b) {
  if (b.word && b.word.fragments[0]) return b.word.fragments[0].docStart;
  const sr = b.source && b.source.sourceRange;
  return sr && Number.isFinite(sr.start) ? sr.start : 0;
}
function boxDocEnd(b) {
  if (b.word) {
    const fN = b.word.fragments[b.word.fragments.length - 1];
    return fN ? fN.docEnd : 0;
  }
  const sr = b.source && b.source.sourceRange;
  return sr && Number.isFinite(sr.end) ? sr.end : 0;
}

/** היסט מוחלט של טווח מפריד (מריצות הפריט שבבעלותו). */
function sepRangeAbs(range, owner) {
  const runs = (owner.payload && owner.payload.runs) || [];
  const run0 = runs[0];
  const itemAbsStart = owner.sourceRange && Number.isFinite(owner.sourceRange.start) ? owner.sourceRange.start : 0;
  const off = (ri) => itemAbsStart + (runs[ri] && Number.isFinite(runs[ri].sourceStart) ? runs[ri].sourceStart : 0) - (run0 && Number.isFinite(run0.sourceStart) ? run0.sourceStart : 0);
  return {
    start: off(range.fromRun) + range.fromStart,
    end: off(range.toRun) + range.toEnd
  };
}

/** glue בין שתי תיבות — המפריד המקורי המדויק נשמר (sep + gapChars) לשחזור מלא. */
function glueItemFor(prevBox, nextBox, env, style) {
  const { sep, range, owner } = separatorOf(prevBox, nextBox);
  const abs = sepRangeAbs(range, owner);
  const glueItemId = `${owner.id}#g@${abs.start}-${abs.end}`;
  const m = measureItem({ id: glueItemId, kind: 'glue', payload: { text: sep } }, style, env.ctx);
  return lineItemOf({
    role: 'glue', kind: 'glue', itemId: glueItemId, sourceItemId: owner.id,
    sep, gapChars: sep,
    measured: m,
    sourceRange: { blockId: env.blockId, itemId: owner.id, runIndex: range.fromRun, start: abs.start, end: abs.end },
    constraints: null
  });
}

/** glue פנימי של יחידה צמודה (מקביל פנימי ל-NBSP במנוע הקיים): רוחב רווח לצורך
 * הפריסה (זהה לנתיב החי — bindMarkersToNeighbors מדביק ב-NBSP), פנימי —
 * אסור לדלג בפתיחת שורה ואסור לחתוך בו (ה-penalty האסור שאחריו מבטיח זאת).
 * הקישור מבוסס noteRef — זהות העוגן נשמרת על ה-glue לשלבי התכנון. */
function internalGlueFor(prevBox, nextBox, env, style) {
  const { sep, range, owner } = separatorOf(prevBox, nextBox);
  const abs = sepRangeAbs(range, owner);
  const glueItemId = `${nextBox.source.id}#j@${abs.start}-${abs.end}`;
  // המדידה ברוחב רווח (כמו המנוע הקיים: NBSP מוצג ברוחב רווח)
  const m = measureItem({ id: glueItemId, kind: 'glue', payload: { text: ' ' } }, style, env.ctx);
  const noteRef = (nextBox.source.kind === 'noteMarker' && nextBox.source.payload && nextBox.source.payload.noteRef)
    || (prevBox.source.kind === 'noteMarker' && prevBox.source.payload && prevBox.source.payload.noteRef) || null;
  return lineItemOf({
    role: 'glue', kind: 'glue', itemId: glueItemId, sourceItemId: owner.id,
    sep: '\u00A0', internal: true, gapChars: sep, noteRef,
    measured: m,
    sourceRange: { blockId: env.blockId, itemId: owner.id, runIndex: range.fromRun, start: abs.start, end: abs.end },
    constraints: null
  });
}

/** צמידת סמני הערה לעוגן — לפי הכללים התקפים (P1-3/BRZ-11), מנוסח פעם אחת.
 * הקישור מותר רק לסמן עם noteRef (זהות עוגן אמיתית במודל המקור). */
function applyMarkerJoins(boxes, env, style) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b.source || b.source.kind !== 'noteMarker') continue;
    if (!(b.source.payload && b.source.payload.noteRef)) continue; // בלי זהות עוגן — אין צמידה
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

/** בדיקת התאמת יחידה צמודה לרוחב — כולל רוחב הדבק הפנימי (רוחב רווח, כמו
 * ה-NBSP בנתיב החי). יחידה חורגת ⇒ הצמדה מתבטלת והטיפול עובר לערוץ
 * ה-overflow המפורש של המנוע (לא גלישה שקטה). */
function unitFits(a, b, env, style) {
  const maxW = env.constraints && Number.isFinite(env.constraints.availableWidthPx) ? env.constraints.availableWidthPx : null;
  const wa = advanceOf(a, style, env);
  const wb = advanceOf(b, style, env);
  if (maxW == null) return true; // אין אילוץ ידוע — הצמדה נשמרת (ההחלטה הסופית ב-KP)
  const spaceW = glueSpaceWidth(style, env);
  return (wa + spaceW + wb) <= maxW;
}

function advanceOf(b, style, env) {
  if (b._adv != null) return b._adv;
  const it = boxItemFor(b, style, env);
  b._adv = it.measured && it.measured.ok ? it.measured.advance : 0;
  return b._adv;
}

/** רוחב רווח הדבק הפנימי — מדידה דרך measureItem היחיד (מטומן לפי מפתח שלב 3). */
function glueSpaceWidth(style, env) {
  const m = measureItem({ id: '#join-space', kind: 'glue', payload: { text: ' ' } }, style, env.ctx);
  return m && m.ok ? m.advance : 0;
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
    gapChars: base.gapChars != null ? base.gapChars : null, // המפריד המקורי המדויק (לשחזור §22)
    internal: !!base.internal,
    noteRef: base.noteRef || null,   // זהות העוגן של יחידה צמודה (סמן הערה)
    penaltyType: base.penaltyType || null,
    cost: base.cost != null ? base.cost : 0
  };
}

module.exports = {
  LINE_ITEM_CONTRACT_VERSION, buildLineSequences,
  H3_LINE_PITCH_PX, H3_LAST_BAND_PX
};
