// src/engine/line/line-model.js — LineModel קנוני: הרכבה, justify חד-פעמי, שחזור (שלב 4)
'use strict';

/**
 * **חוזה:** spec/00 §4.1-10 — "לשמור לכל שורה: ordered fragments, source mapping,
 * measured advances, glue allocation, baseline metrics, break reason, line
 * constraints ו-diagnostics." §4.1-11 — "חלוקת הרווחים/המתיחה במנגנון שורות
 * אחד בלבד... אין למתוח מחדש ב-renderer."
 *
 * **כניסה יחידה:** layoutSequence(sequence, opts) — מקבל רצף מ-buildLineSequences
 * ומחזיר LineModel[]. ה-DP עצמו חי ב-kp-linebreak (המנוע הקיים, מורחב); כאן
 * ההרכבה, אילוצי האזור (wrap-around), תמונות ממורכזות, הקצאת glue חד-פעמית
 * ושחזור המקור.
 */

const { breakItemSequence, STRETCH_RATIO, SHRINK_RATIO } = require('../typography/kp-linebreak');

/** גרסת חוזה מודל השורה. */
const LINE_MODEL_VERSION = 'line-model-v1(fragments+glue+source)';

/**
 * layoutSequence — הכניסה היחידה של מנוע השורות המאוחד.
 * @param {{blockId, blockKind, semantic, items:Array}} sequence — מ-buildLineSequences
 * @param {{maxWidthPx:number, justify?:'ragged'|'stretch', runts?:number, raggedEnd?:boolean}} opts
 * @returns {{ok, lines:LineModel[], diagnostics, blockId, blockKind, semantic, stats}}
 */
function layoutSequence(sequence, opts = {}) {
  const maxWidthPx = Number(opts.maxWidthPx);
  if (!sequence || !Array.isArray(sequence.items) || !sequence.items.length) {
    return { ok: false, lines: [], diagnostics: [{ code: 'empty-sequence', message: 'layoutSequence: רצף ריק' }], blockId: sequence && sequence.blockId, blockKind: sequence && sequence.blockKind, semantic: sequence && sequence.semantic, stats: { lines: 0 } };
  }
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    return { ok: false, lines: [], diagnostics: [{ code: 'bad-max-width', message: `layoutSequence: רוחב שורה שגוי (${maxWidthPx})` }], blockId: sequence.blockId, blockKind: sequence.blockKind, semantic: sequence.semantic, stats: { lines: 0 } };
  }
  const diagnostics = [];
  const items = sequence.items;

  // ── תמונות בלוק/ממורכזות (§4.1-7): פריט פריסה בפני עצמו — לפי כלל הפריסה
  // שבאילוצי הפריט, לא הזזה על ידי renderer אחרי השבירה. תמונת inline נשארת
  // בזרימה; תמונת float מגדירה אילוץ אזור (להלן).
  const centeredIdx = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'image' || !it.constraints) continue;
    const p = String(it.constraints.participates || 'inline');
    if (p === 'block' || p === 'centered') centeredIdx.add(i);
  }
  // פיצול הרצף למקטעים: [זרימה][תמונה ממורכזת][זרימה]... — כל מקטע זרימה נשבר
  // ב-DP; תמונה ממורכזת = LineModel בפני עצמה. סדר המקור נשמר בדיוק.
  const segments = [];
  let flow = [];
  for (let i = 0; i < items.length; i++) {
    if (centeredIdx.has(i)) {
      if (flow.length) segments.push({ type: 'flow', items: flow });
      segments.push({ type: 'centered-image', item: items[i], index: i });
      flow = [];
    } else {
      flow.push(items[i]);
    }
  }
  if (flow.length) segments.push({ type: 'flow', items: flow });

  const lines = [];
  for (const seg of segments) {
    if (seg.type === 'centered-image') {
      lines.push(centeredImageLine(seg.item, maxWidthPx, sequence));
      continue;
    }
    // ── אילוץ אזור לתמונה צפה (§4.1-7): wrap-start/wrap-end מקטינים את הרוחב
    // האפקטיבי של השורות שבגובה התמונה — אותו DP, אילוץ אחד; אין breaker שני.
    const wrap = wrapConstraintOf(seg.items, maxWidthPx, opts);
    const res = breakItemSequence(seg.items, maxWidthPx, {
      runts: opts.runts,
      raggedEnd: opts.raggedEnd,
      lineWidthAt: wrap ? (li) => wrap.widthAt(li) : null
    });
    for (const d of res.diagnostics) diagnostics.push(d);
    let lineIdxInSeg = 0;
    for (const cut of res.lines) {
      const lm = assembleLine(seg.items, cut, maxWidthPx, wrap, opts, sequence, lineIdxInSeg);
      if (lm) { lines.push(lm); lineIdxInSeg++; }
    }
  }
  // אינדוקס רץ + isLast + סמנטיקה (§21: הרווח התחתון של כותרת 3 שייך לפריט כולו)
  for (let i = 0; i < lines.length; i++) {
    lines[i].index = i;
    lines[i].isLast = i === lines.length - 1;
    if (sequence.semantic && sequence.semantic.kind === 'heading3') {
      lines[i].semantic = {
        kind: 'heading3', itemId: sequence.semantic.itemId,
        linePitchPx: sequence.semantic.linePitchPx,
        bandPx: lines[i].isLast ? sequence.semantic.lastBandPx : sequence.semantic.linePitchPx,
        trailingSpacePx: lines[i].isLast ? sequence.semantic.trailingSpacePx : 0,
        rule: sequence.semantic.rule
      };
    }
  }
  return {
    ok: true, lines, diagnostics,
    blockId: sequence.blockId, blockKind: sequence.blockKind, semantic: sequence.semantic || null,
    stats: { lines: lines.length, modelVersion: LINE_MODEL_VERSION }
  };
}

// ─── הרכבת שורה אחת ─────────────────────────────────────────────────────────

function assembleLine(items, cut, maxWidthPx, wrap, opts, sequence, lineIdxInSeg) {
  // הגלישה מעל glue פותח (שבירת השורה): הקטע מתחיל בתיבה הראשונה — ה-glue של
  // השבירה שייך למרווח הבין-שורות ואינו חלק מרוחב השורה (הוא נשמר ב-flow הקודם
  // כ-breakGlue לשחזור המקור — בלי ספירה כפולה).
  let from = cut.from;
  while (from < cut.to && items[from].role === 'glue' && !items[from].internal) from++;
  const seg = items.slice(from, cut.to);
  const boxes = seg.filter((x) => x.role === 'box');
  if (!boxes.length) return null; // אין שורות ריקות — תוצר לוואי אסור (§19)
  const effMax = wrap ? wrap.widthAt(lineIdxInSeg) : maxWidthPx;
  // עמות-השדה של המקור: סדר הפריטים והמפרידים כפי שנוצרו — לשחזור מדויק ולמיפוי מקור לכל פרגמנט
  const flow = seg.map((it) => it.role === 'glue'
    ? { type: 'glue', itemId: it.itemId, sep: it.sep != null ? it.sep : ' ', internal: !!it.internal }
    : { type: 'box', itemId: it.itemId, kind: it.kind });
  // ה-glue שעל נקודת החיתוך שייך למקור בין שתי השורות — נשמר בעמות-השדה לשחזור מדויק
  // (שימור מקור §22), מסומן breakGlue ואינו נכנס לרוחב השורה או להקצאת ה-glue.
  const atCut = items[cut.to];
  if (atCut && atCut.role === 'glue' && !atCut.internal) {
    flow.push({ type: 'glue', itemId: atCut.itemId, sep: atCut.sep != null ? atCut.sep : ' ', internal: false, breakGlue: true });
  }

  // פרגמנטים מסודרים עם זהות ומקור (§4.1-10)
  const fragments = [];
  for (const it of seg) {
    if (it.role !== 'box') continue;
    fragments.push({
      itemId: it.itemId,
      sourceItemId: it.sourceItemId,
      kind: it.kind,
      fontId: it.fontId,
      fragments: (it.fragments || []).map((f) => ({ ...f })),
      measuredAdvance: it.measuredAdvance,
      inkBounds: it.inkBounds,
      constraints: it.constraints,
      sourceAnchor: it.sourceAnchor || null,
      diagnostics: it.diagnostics || []
    });
  }

  // גאומטריית בסיס: מקסימום ascent/descent וגובה מהמדידות (לא חישוב מחדש)
  let ascent = 0, descent = 0, height = 0;
  for (const b of boxes) {
    const m = b.measured;
    if (m && m.ok) {
      ascent = Math.max(ascent, m.ascent || 0);
      descent = Math.max(descent, m.descent || 0);
      height = Math.max(height, m.height || 0);
    }
  }

  // הקצאת glue — פעם אחת כאן (§4.1-11): הרינדרר צורך allocationPx ואינו מותח מחדש
  const glue = [];
  let natural = 0;
  for (const it of seg) {
    if (it.role === 'box') natural += it.measuredAdvance;
    else if (it.role === 'glue') {
      const g = it.measured && it.measured.ok ? it.measured.advance : 0;
      glue.push({
        itemId: it.itemId, sep: it.sep != null ? it.sep : ' ', internal: !!it.internal,
        naturalPx: g, stretchPx: g * STRETCH_RATIO, shrinkPx: g * SHRINK_RATIO,
        allocationPx: g // יתעדכן בהקצאה אם justify=stretch
      });
      natural += g;
    }
  }
  const slack = effMax - natural;
  if (opts.justify === 'stretch' && slack > 0 && glue.length) {
    // חלוקה דטרמיניסטית לפי משקלי מתיחה + השלמת שארית הגדולה (אין סחיפה)
    const totalStretch = glue.reduce((s, g) => s + g.stretchPx, 0);
    if (totalStretch > 0) {
      const exact = glue.map((g) => (g.stretchPx / totalStretch) * slack);
      const base = exact.map((x) => Math.floor(x));
      let rem = Math.round(slack - base.reduce((s, x) => s + x, 0));
      const order = glue.map((g, i) => i).sort((a, b) => (exact[b] - exact[a]) || (a - b));
      for (let k = 0; rem > 0 && k < order.length; k++, rem--) base[order[k]] += 1;
      for (let i = 0; i < glue.length; i++) glue[i].allocationPx = glue[i].naturalPx + base[i];
    }
  }

  return {
    modelVersion: LINE_MODEL_VERSION,
    index: 0, isLast: false,
    blockId: sequence.blockId,
    fragments,
    itemIds: boxes.map((b) => b.itemId),
    flow,
    naturalWidthPx: round3(natural),
    effectiveMaxWidthPx: round3(effMax),
    glue,
    baseline: { ascentPx: round3(ascent), descentPx: round3(descent) },
    lineHeightPx: round3(height),
    breakReason: cut.reason || 'legal-cut',
    badness: cut.badness || 0,
    constraints: { maxWidthPx: round3(effMax), justify: opts.justify === 'stretch' ? 'stretch' : 'ragged' },
    semantic: null,
    diagnostics: []
  };
}

// ─── תמונות ──────────────────────────────────────────────────────────────────

/** תמונה בלוק/ממורכזת — שורה בפני עצמה לפי כלל הפריסה שבאילוצי הפריט (§4.1-7). */
function centeredImageLine(item, maxWidthPx, sequence) {
  const m = item.measured;
  const w = m && m.ok ? m.advance : 0;
  const h = m && m.ok ? m.height : 0;
  return {
    modelVersion: LINE_MODEL_VERSION,
    index: 0, isLast: false,
    blockId: sequence.blockId,
    fragments: [{
      itemId: item.itemId, sourceItemId: item.sourceItemId, kind: 'image',
      fontId: null, fragments: [], measuredAdvance: w, inkBounds: m && m.inkBounds,
      constraints: item.constraints, sourceAnchor: null, diagnostics: []
    }],
    itemIds: [item.itemId],
    naturalWidthPx: round3(w),
    effectiveMaxWidthPx: round3(maxWidthPx),
    glue: [],
    baseline: { ascentPx: round3(h), descentPx: 0 },
    lineHeightPx: round3(h),
    breakReason: 'image-block',
    badness: 0,
    constraints: { maxWidthPx: round3(maxWidthPx), align: (item.constraints && item.constraints.align) || 'center', placement: 'block' },
    semantic: null,
    diagnostics: []
  };
}

/**
 * אילוץ אזור לתמונה צפה ברצף: התמונה הצפה הראשונה (wrap start/end) מקטינה
 * את הרוחב לשורות 0..K-1 כאשר K = ceil(displayH / lineHeight). דטרמיניסטי,
 * מנוסח פעם אחת; מיקום צף מלא בעמוד הוא תכנון (שלב 5) — כאן אילוץ הזרימה.
 */
function wrapConstraintOf(items, maxWidthPx, opts) {
  let floatImg = null;
  for (const it of items) {
    if (it.kind === 'image' && it.constraints && (it.constraints.wrap === 'start' || it.constraints.wrap === 'end')
      && String(it.constraints.participates || 'inline') === 'inline' && it.measured && it.measured.ok) {
      floatImg = it; break;
    }
  }
  if (!floatImg) return null;
  const imgH = floatImg.measured.height || 0;
  const lineH = Number(opts.lineHeightPx) > 0 ? Number(opts.lineHeightPx) : (imgH || 1);
  const linesSpanned = Math.max(1, Math.ceil(imgH / lineH));
  const reduced = Math.max(0, maxWidthPx - (floatImg.measured.advance || 0));
  return {
    linesSpanned,
    widthAt: (li) => (li < linesSpanned ? reduced : maxWidthPx)
  };
}

// ─── שחזור מקור (§22: אין אובדן/כפילות/שינוי סדר) ───────────────────────────

/** שחזור טקסט הרצף מתוך השורות — לפי עמות-השדה (flow):
 * סדר הפריטים והמפרידים המדויקיים (sep) משחזרים את המקור
 * מוות אובדן, כפילות או שינוי סדר. יחידות צמודות — ה-sep הפנימי (NBSP) משוחזר אף הוא. */
function reconstructTextOfLines(lines) {
  let out = '';
  const textOf = (ln, itemId) => {
    const f = ln.fragments.find((x) => x.itemId === itemId);
    if (!f) return null;
    if (f.kind === 'text' || f.kind === 'noteMarker' || f.kind === 'atomicToken') {
      return (f.fragments || []).map((x) => x.text).join('');
    }
    return ''; // תמונה/עוגן — אינם טקסט; זהותם נשמרת בפרגמנט
  };
  for (const ln of lines) {
    for (const step of (ln.flow || [])) {
      if (step.type === 'glue') out += step.sep;
      else out += (textOf(ln, step.itemId) || '');
    }
  }
  return out;
}

function round3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

module.exports = { layoutSequence, reconstructTextOfLines, LINE_MODEL_VERSION };
