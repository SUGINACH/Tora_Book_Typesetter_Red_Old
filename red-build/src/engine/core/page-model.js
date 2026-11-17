// src/engine/core/page-model.js — שלב 7: PageModel יחיד, סופי ו-immutable (תכנית §§7.1–7.3)
'use strict';

/**
 * **PageModel — מקור האמת הסופי של מיקומים וגיאומטריה** (הוראת שלב 7 §§18–22):
 *
 *   DocumentModel → Measured Items → LineModel → Planner → PagePlan → **PageModel** → מקרינים טהורים.
 *
 * הבונה מקבל את תוצר התכנון (העמודים הסופיים של ה-pipeline — ה-PagePlan בפועל)
 * ומפיק מודל עמוד **סופי וקפוא** שמכיל את כל ההחלטות הסמנטיות והגיאומטריות
 * של העימוד: עמודים בסדר סופי, גיאומטריית עמוד/טורים, שורות עם fragments
 * ממוקמים (מילים ב-x סופיים — הקרנה חד-פעמית, §7.1-5), פריטי עמוד (הערות
 * מרזב/פריטי עוגן/תיבות מידע/עיטורים/ריהוט), פערים והזמנות, זהויות מקור
 * וטווחי פיצול, סדר קריאה, אבחונים ותקינות נכסים.
 *
 * **גבולות האחריות (§22):** אחרי בניית המודל — שום מקרן אינו מזיז פריט, מודד
 * מילות-גוף, שובר שורות, מחשב תקציב הערות, מאזן, מתקן פערים או מחליט סדר
 * קריאה. כל ההחלטות התקבלו קודם; המקרינים (שלב 8) יקראו בלבד.
 *
 * **מה הבונה עושה ומה לא (§20):** הוא מאמת את התוכנית, מוכיח שכל פריט מתוכנן
 * מופיע בתוצאה (אין יתומים/כפילויות), משמר עוגנים, מאמת גיאומטריה והזמנות,
 * מפיק אבחונים ומקפיא. הוא **אינו** מודד מחדש, שובר שורות, מאזן או מחליט הצבה:
 * הקרנת ה-fragments מתבצעת פעם אחת (§7.1-5) דרך מנוע ההקרנה הקיים — אותו מקור
 * שה-PDF כבר צורך; החלטות העימוד (מיקומים/גבהים/פערים) נצרכות מהתוכנית כמו שהן.
 *
 * דטרמיניזם: אין תאריך/אקראיות/מזהי ריצה; אותו קלט ⇒ אותו מודל ואותם hashes.
 */

const crypto = require('crypto');
const { projectDocument } = require('../output/geometry-projector');
const { stampIsValid } = require('../layout/notes-model');

/** גרסת הסכמה — עולה רק בשינוי חוזה שובר-צרכן (תכנית §7.1-10). */
const PAGE_MODEL_SCHEMA = 'pagemodel-v1';

/** סובלנות גבולות (px) — גלישת דיו מילה מעבר לתיבה אינה הפרת מיקום. */
const BOUNDS_TOLERANCE_PX = 1.5;

/** סוגי שורות שאינן שורות טור-גוף ב-out.lines (הקרנות ייעודיות לפריטי עמוד). */
const NON_BODY_LINE_KINDS = new Set(['side-note', 'info-box']);

// ─── עזרי הקפאה עמוקה (immutable final model — §7.1-12) ───

/**
 * הקפאה עמוקה: מערכים ואובייקטים מוקפאים רקורסיבית. מחזירה את השורש.
 * מוטציה בכל עומק ⇒ TypeError במצב strict (מוכח בבדיקה).
 */
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
 * ערכי גיאומטריה נשמרים **כמו שהם** (בלי עיגול): החישוב דטרמיניסטי
 * מבנית (אותו קלט ⇒ אותם float ביט-לביט), וההשוואה מול התוכנית חייבת
 * להיות מדויקת — תצוגה=ייצוא=מודל, אותם מספרים.
 */
function r2(v) { return v; }

// ─── הבונה (§19–20) ───

/**
 * buildPageModel — הבונה היחיד של מודל העמוד הסופי.
 * @param {object} result — תוצר typeset (pages/tokens/settings/contentHashIn)
 * @param {object} [opts] — { measure?: MeasureAPI, assets?: {ids:Set} }
 * @returns {{model:object, validation:object}} — המודל הקפוא + דוח אימות
 */
function buildPageModel(result, opts = {}) {
  const settings = result.settings;
  const pages = result.pages;
  const measure = opts.measure || null;
  const assetIds = opts.assets && opts.assets.ids instanceof Set ? opts.assets.ids : null;
  const diagnostics = [];

  // (1) הקרנת fragments חד-פעמית — מנוע ההקרנה הקיים (מקור אחד ל-PDF ולמודל;
  // שלב 8 יעביר את המקרינים לצריכת המודל). אין כאן החלטות עימוד חדשות:
  // המיקומים, הגבהים והפערים נצרכים מהתוכנית כמו שהם.
  const projected = projectDocument(result, settings, measure);

  // (2) מיפוי זהות: כל שורת תוכנית → נציגותה במודל (token/part) — בסיס
  // הוכחת הכיסוי המלא ואפס-הכפילויות (§21-1).
  const planLines = [];
  for (const page of pages) {
    (page.columns || []).forEach((col, ci) => {
      col.forEach((ln, li) => {
        const tok = ln.tokenId != null ? ln.tokenId : (ln.meta && ln.meta.tokenId);
        planLines.push({ tok, part: ln.part != null ? ln.part : null, page: page.index, col: ci, li, line: ln });
      });
    });
  }

  // (3) בניית העמודים: גיאומטריה סופית + זהות מקור + פריטי עמוד
  const modelPages = pages.map((page, pi) => {
    const pp = projected.pages[pi];
    const tpl = page.template;
    const geo = {
      width: r2(tpl.width), height: r2(tpl.height),
      contentBox: {
        top: r2(tpl.contentBox.top), bottom: r2(tpl.contentBox.bottom),
        left: r2(tpl.contentBox.left), right: r2(tpl.contentBox.right),
        height: r2(tpl.contentBox.height)
      },
      columns: (tpl.columns || []).map(c => ({ x: r2(c.x), w: r2(c.w) })),
      gutter: r2(tpl.gutter || 0),
      spanOffset: page.spanning ? r2(page.spanning.heightPx) : 0
    };

    // שורות: פס חוצה-טורים (מעל הטורים), ואז טורי הגוף בסדר קריאה (RTL: טור 0
    // הימני ראשון). עמודי סוגים מיוחדים (endnotes/TOC/שערים) — שורותיהם
    // הייעודיות מההקרנה, עם זהות המקור שלהם.
    const lines = [];
    if (pp && pp.spanning && pp.spanning.lines) {
      pp.spanning.lines.forEach((pl, li) => {
        const src = (page.spanning && page.spanning.lines[li]) || null;
        lines.push(placeLine(pl, src, { page: page.index, area: 'spanning', col: -1, li }));
      });
    }
    if (page.type === 'endnotes') {
      // "הטורים" של עמוד הערות מכילים אובייקטי הערה — השורות המוקרנות הן
      // endnote-title/endnote-note; הזהות — tokenId של הערה/העמוד.
      let li = 0;
      for (const pl of ((pp && pp.lines) || [])) {
        const model = pl.kind === 'endnote-note'
          ? matchEndnoteLine(pl, page)
          : { tokenId: null, part: null, seq: null };
        lines.push(placeLine(pl, { tokenId: model.tokenId, part: model.part, seq: model.seq, gapBeforePx: 0, aqStretch: 1 }, { page: page.index, area: 'endnotes', col: 0, li }));
        li++;
      }
    } else {
      // שורות הגוף: out.lines נבנה בסדר "טור 0 ואז טור 1" ואז הקרנות פריטי-עמוד
      // (הערות-צד וכו') — מסננים את אלה שאינן שורות גוף וממפים בסדר.
      const bodyProjected = ((pp && pp.lines) || []).filter(pl => !NON_BODY_LINE_KINDS.has(pl.kind));
      let cursor = 0;
      (page.columns || []).forEach((col, ci) => {
        col.forEach((ln) => {
          const pl = bodyProjected[cursor++];
          lines.push(placeLine(pl, ln, { page: page.index, area: 'column', col: ci, li: lines.length }));
        });
      });
      // שאריות מוקרנות בלי שורות-תוכנית — תוכן מבני של העמוד (שערים/מותאם/
      // TOC): מיוצגות במודל כ-area=structural (§24 — כל פריטי העמוד במודל).
      for (; cursor < bodyProjected.length; cursor++) {
        const pl = bodyProjected[cursor];
        lines.push(placeLine(pl, { gapBeforePx: 0, aqStretch: 1 }, { page: page.index, area: 'structural', col: -1, li: lines.length }));
      }
    }

    // הערות מרזב — זהות+עוגן+חותמה מהרשומה, מיקום סופי מההקרנה (התאמה לפי
    // marker+text — ההקרנה מסדרת לפי נתיבים, לא לפי סדר המערך).
    // עמודי הערות-סיום: הרשומות ב-page.notes; המיקום — משורות ההקרנה שלהן.
    let footnotes;
    if (page.type === 'endnotes') {
      const linesByTok = new Map();
      for (const l of lines) {
        if (l.area !== 'endnotes' || l.sourceTokenId == null) continue;
        if (!linesByTok.has(l.sourceTokenId)) linesByTok.set(l.sourceTokenId, []);
        linesByTok.get(l.sourceTokenId).push(l);
      }
      footnotes = (page.notes || []).map(n => {
        const ls = linesByTok.get(String(n.tokenId)) || [];
        const proj = ls.length
          ? { x: ls[0].x, y: ls[0].y, w: ls[0].w, words: ls.flatMap(l => l.words || []) }
          : null;
        return notePlacement(n, proj, { page: page.index, area: 'endnote-page' });
      });
    } else {
      const projFns = ((pp && pp.footnotes) || []).slice();
      footnotes = (page.footnotes || []).map(n => {
        const idx = projFns.findIndex(p => p.marker === String(n.marker || '') && p.text === String(n.text || '').replace(/\uE000/g, ' '));
        const proj = idx >= 0 ? projFns.splice(idx, 1)[0] : null;
        if (!proj) diagnostics.push({ kind: 'page-model-note-not-projected', note: n.noteId || n.tokenId || null, page: page.index });
        return notePlacement(n, proj, { page: page.index, area: 'footnote-gutter' });
      });
    }

    // פריטי עוגן (הערות-צד/תיבות מידע) — הצבה סופית מהמקצה המשותף
    const sideNotes = (page.sideNotes || []).map(sn => anchorPlacement(sn, { page: page.index }));

    // השלמת שלב 6: דיו עיטור חסר — diagnostic מפורש במודל (לא השתקה; הגיאומטריה נשמרת)
    for (const d of ((pp && pp.decorations) || [])) {
      if (d.inkMissing) diagnostics.push({ kind: 'page-model-ornament-ink-missing', page: page.index, ornId: d.ornId || null, slot: d.slot || null, kindStyle: d.kindStyle || null });
    }

    return {
      index: page.index,
      type: page.type,
      isRecto: page.isRecto === true,
      pageNumber: page.pageNumber != null ? page.pageNumber : null,
      folioDisplay: page.folioDisplay || null,
      geometry: geo,
      lines,
      footnotes,
      sideNotes,
      decorations: (pp && pp.decorations ? pp.decorations.map(d => ({
        x: r2(d.x), y: r2(d.y), w: r2(d.w), h: r2(d.h),
        kind: d.kind || null, slot: d.slot || null, inkType: d.inkType || null,
        // **השלמת חוזה העיטורים (שלב 6 — §6.1-6/§6.1-10):** המודל נושא את מלוא
        // ההצהרה — המקרינים (שלב 8) יקראו ולא יחשבו מחדש: זהות, מקור, דיו,
        // מידות טבעיות מול יעד, fit/scale, עוגן, clipping, z-order, הזמנה
        // ואילוצים. inkMissing מסומן גם כ-diagnostic למטה (אין השתקה).
        ...(d.ornId ? { ornId: d.ornId } : {}),
        ...(d.source != null ? { source: d.source } : {}),
        ...(d.ink ? { ink: { ...d.ink } } : {}),
        ...(d.inkMissing ? { inkMissing: true } : {}),
        ...(d.natural ? { natural: { w: d.natural.w, h: d.natural.h } } : {}),
        ...(d.scale != null ? { scale: d.scale } : {}),
        ...(d.fit ? { fit: { ...d.fit } } : {}),
        ...(d.anchor ? { anchor: { ...d.anchor } } : {}),
        ...(d.clip ? { clip: { ...d.clip } } : {}),
        ...(d.zOrder ? { zOrder: d.zOrder } : {}),
        ...(d.reservation ? { reservation: { ...d.reservation } } : {}),
        ...(d.constraints ? { constraints: { ...d.constraints } } : {}),
        ...(d.cssClass ? { cssClass: d.cssClass } : {})
      })) : []),
      header: pp && pp.header ? { y: r2(pp.header.y) } : null,
      folio: pp && pp.folio ? { y: r2(pp.folio.y), text: pp.folio.text || null, baselineY: pp.folio.baselineY != null ? r2(pp.folio.baselineY) : null } : null,
      reservations: (page.reservations || []).map(r => ({ kind: r.kind, scope: r.scope, px: r2(r.px), reason: r.reason }))
    };
  });

  // (4) אינטגריטי נכסים (§21-10): כל מזהה נכס שהוצהר — נפתר או מדווח מפורש
  const resourceRefs = [];
  if (assetIds) {
    for (const page of pages) {
      for (const col of (page.columns || [])) {
        for (const ln of col) {
          const ast = ln.lineModel && ln.lineModel.assets;
          if (!ast) continue;
          for (const a of ast) {
            const resolved = assetIds.has(a.assetId);
            resourceRefs.push({ assetId: a.assetId, page: page.index, resolved });
            if (!resolved) diagnostics.push({ kind: 'page-model-resource-unresolved', assetId: a.assetId, page: page.index });
          }
        }
      }
    }
  }

  const model = {
    schema: PAGE_MODEL_SCHEMA,
    document: {
      contentHashIn: result.contentHashIn || null,
      tokensCount: (result.tokens || []).length,
      plannedPages: pages.length
    },
    pages: modelPages,
    meta: {
      resources: { referenced: resourceRefs.length, unresolved: resourceRefs.filter(r => !r.resolved).length }
    }
  };

  // (5) אימות (§21) — לפני ההקפאה; הדוח בר-השוואה בין ריצות
  const validation = validatePageModel(model, { planPages: pages, tokens: result.tokens || [], planLines });

  // (6) hashes דטרמיניסטיים — גיאומטריה נפרדת מתוכן (§7.1-8/9)
  model.geometryHash = geometryHashOf(model);
  model.contentHash = contentHashOf(model);

  // (7) הקפאה עמוקה — המודל אינו משתנה עוד (§7.1-12)
  deepFreeze(model);
  return { model, validation };
}

/** התאמת שורת endnote מוקרנת לרשומת ההערה שלה (לפי טקסט+סמן). */
function matchEndnoteLine(pl, page) {
  for (const col of (page.columns || [])) {
    for (const n of col) {
      const txt = pl.words.map(w => w.text).join(' ');
      if (String(n.text || '').includes(txt.slice(0, 12)) || txt.includes(String(n.text || '').slice(0, 12))) {
        return { tokenId: n.tokenId != null ? n.tokenId : null, part: null, seq: null };
      }
    }
  }
  return { tokenId: null, part: null, seq: null };
}

/** מיקום שורה: גיאומטריה סופית + זהות מקור + fragments ממוקמים. */
function placeLine(pl, srcLine, where) {
  const tok = srcLine && (srcLine.tokenId != null ? srcLine.tokenId : (srcLine.meta && srcLine.meta.tokenId));
  const id = `p${where.page}.${where.area === 'spanning' ? 'sp' : (where.area === 'endnotes' ? 'en' : 'c' + where.col)}.${where.li}`;
  if (!pl) {
    return { id, sourceTokenId: tok != null ? String(tok) : null, projected: false, ...where };
  }
  return {
    id,
    sourceTokenId: tok != null ? String(tok) : null,
    part: srcLine && srcLine.part != null ? srcLine.part : null,
    seq: srcLine && srcLine.seq != null ? srcLine.seq : null,
    kind: pl.kind || 'paragraph',
    level: pl.level != null ? pl.level : null,
    isLast: pl.isLast === true,
    align: pl.align || null,
    sizePt: pl.sizePt != null ? pl.sizePt : null,
    x: r2(pl.x), y: r2(pl.y), w: r2(pl.w), h: r2(pl.h),
    baselineY: pl.baselineY != null ? r2(pl.baselineY) : null,
    ascentPx: pl.ascentPx != null ? r2(pl.ascentPx) : null,
    descentPx: pl.descentPx != null ? r2(pl.descentPx) : null,
    gapBeforePx: srcLine && srcLine.gapBeforePx != null ? r2(srcLine.gapBeforePx) : 0,
    aqStretch: srcLine && srcLine.aqStretch != null ? r2(srcLine.aqStretch) : 1,
    words: (pl.words || []).map(wd => ({
      text: wd.text, x: r2(wd.x), w: r2(wd.w),
      ...(wd.sizePt != null ? { sizePt: wd.sizePt } : {}),
      ...(wd.fontKey != null ? { fontKey: wd.fontKey } : {}),
      ...(wd.baselineY != null ? { baselineY: r2(wd.baselineY) } : {}),
      ...(wd.color != null ? { color: wd.color } : {})
    })),
    projected: true,
    ...where
  };
}

/** רשומת הערה במודל: זהות + עוגן + מדדים + מיקום סופי מההקרנה. */
function notePlacement(n, proj, where) {
  return {
    noteId: n.noteId || null,
    kind: n.kind || 'footnote',
    sourceId: n.sourceId || (n.tokenId != null ? String(n.tokenId) : null),
    anchorId: n.anchorId || (n.tokenId != null ? String(n.tokenId) : null),
    marker: n.marker != null ? String(n.marker) : null,
    text: String(n.text || ''),
    continuationOf: n.continuationOf || null,
    wordRange: n.wordRange ? { from: n.wordRange.from, to: n.wordRange.to } : null,
    lineH: n.lineH != null ? r2(n.lineH) : null,
    heightPx: n.heightPx != null ? r2(n.heightPx) : null,
    linesCount: n.linesCount != null ? n.linesCount : null,
    stampValid: stampIsValid(n),
    x: proj ? r2(proj.x) : null, y: proj ? r2(proj.y) : null,
    w: proj ? r2(proj.w) : null,
    words: proj && proj.words ? proj.words.map(wd => ({ text: wd.text, x: r2(wd.x), w: r2(wd.w), baselineY: wd.baselineY != null ? r2(wd.baselineY) : null })) : [],
    ...where
  };
}

/** רשומת פריט עוגן (הערת-צד / תיבת מידע): הצבה סופית מהמקצה המשותף. */
function anchorPlacement(sn, where) {
  return {
    noteId: sn.noteId || null,
    itemKind: sn.itemKind || 'side-note',
    sourceId: sn.sourceId || (sn.ownToken != null ? String(sn.ownToken) : null),
    anchorId: sn.anchorId != null ? String(sn.anchorId) : null,
    text: String(sn.text || ''),
    x: sn.x != null ? r2(sn.x) : null,
    yTop: sn.yTop != null ? r2(sn.yTop) : null,
    w: (sn.boxSpec && sn.boxSpec.widthPx) || sn.colWidth || null,
    heightPx: sn.heightPx != null ? r2(sn.heightPx) : null,
    lineH: sn.lineH != null ? r2(sn.lineH) : null,
    rowsCount: sn.noteRows ? sn.noteRows.length : null,
    stampValid: stampIsValid(sn),
    boxChrome: sn.boxChrome ? { ...sn.boxChrome } : null,
    ...where
  };
}

// ─── האימות (§21) ───

/**
 * validatePageModel — אינווריאנטים. מחזיר דוח בר-השוואה בין ריצות:
 * { checks: {name: count}, violations: [{code, detail}], summary: {...} }.
 */
function validatePageModel(model, ctx = {}) {
  const planPages = ctx.planPages || [];
  const tokens = ctx.tokens || [];
  const planLines = ctx.planLines || [];
  const checks = Object.create(null);
  const violations = [];
  const check = (name) => { checks[name] = (checks[name] || 0) + 1; };
  const tokenIds = new Set(tokens.map(t => t.id));

  // (1) כיסוי מלא: כל שורת תוכנית מיוצגת במודל (לפי token+part); אין כפילויות מזהה
  const modelLineIds = new Set();
  const modelLinesByTokenPart = new Map();
  for (const page of model.pages) {
    for (const ln of page.lines) {
      if (ln.id != null) {
        if (modelLineIds.has(ln.id)) violations.push({ code: 'duplicate-line-id', detail: ln.id });
        modelLineIds.add(ln.id);
      }
      if (ln.sourceTokenId != null) {
        const key = `${ln.sourceTokenId}|${ln.part != null ? ln.part : ''}`;
        if (!modelLinesByTokenPart.has(key)) modelLinesByTokenPart.set(key, 0);
        modelLinesByTokenPart.set(key, modelLinesByTokenPart.get(key) + 1);
      }
      check('line-coverage');
    }
  }
  for (const info of planLines) {
    const key = `${info.tok}|${info.part != null ? info.part : ''}`;
    if (info.tok != null && !(modelLinesByTokenPart.get(key) > 0)) {
      violations.push({ code: 'planned-line-missing', detail: `${key}@p${info.page}` });
    }
  }
  // כמות השורות במודל = כמות השורות בתוכנית (טורים + פסים חוצי-טורים;
  // אין שורות חדשות/מוכפלות)
  const planSpanning = planPages.reduce((a, p) => a + (p.spanning && p.spanning.lines ? p.spanning.lines.length : 0), 0);
  const modelBodyLines = model.pages.reduce((a, p) => a + p.lines.filter(l => l.area === 'column' || l.area === 'spanning').length, 0);
  if (modelBodyLines !== planLines.length + planSpanning) {
    violations.push({ code: 'line-count-mismatch', detail: `plan=${planLines.length + planSpanning} (cols ${planLines.length}+span ${planSpanning}) model=${modelBodyLines}` });
  }

  // (2) זהות מקור לכל fragment: שורה מוקרנת בלי sourceTokenId ⇒ הפרה
  // (שורות סינתטיות — כותרת עמוד הערות/תוכן מבני של שערים/TOC — מסומנות
  // area=endnotes/structural ופטורות מטוקן-גוף; הן תוכן עמוד, לא גוף זורם)
  for (const page of model.pages) {
    for (const ln of page.lines) {
      if (ln.projected === false) {
        violations.push({ code: 'line-not-projected', detail: `${page.index}:${ln.id}` });
      } else if (ln.area !== 'endnotes' && ln.area !== 'structural' && ln.sourceTokenId == null) {
        violations.push({ code: 'line-without-source', detail: `${page.index}:${ln.id}` });
      } else if (ln.sourceTokenId != null && !tokenIds.has(ln.sourceTokenId)) {
        violations.push({ code: 'line-unknown-token', detail: `${ln.id}→${ln.sourceTokenId}` });
      }
      check('source-identity');
    }
  }

  // (3) גבולות: אין placement מחוץ לתיבת התוכן ללא diagnostic (בסובלנות דיו)
  for (const page of model.pages) {
    const cb = page.geometry.contentBox;
    for (const ln of page.lines) {
      if (ln.projected === false || ln.y == null) continue;
      if (ln.area === 'column' && (ln.y < cb.top - BOUNDS_TOLERANCE_PX || ln.y + (ln.h || 0) > cb.bottom + BOUNDS_TOLERANCE_PX)) {
        violations.push({ code: 'line-outside-content-box', detail: `${page.index}:${ln.id} y=${ln.y} h=${ln.h}` });
      }
      check('bounds');
    }
  }

  // (4) סדר קריאה: בכל טור, y מונוטוני לא-יורד (סדר השורות = סדר הקריאה)
  for (const page of model.pages) {
    const perCol = new Map();
    for (const ln of page.lines) {
      if (ln.area !== 'column' || ln.y == null) continue;
      if (!perCol.has(ln.col)) perCol.set(ln.col, -Infinity);
      const lastY = perCol.get(ln.col);
      if (ln.y < lastY - BOUNDS_TOLERANCE_PX) {
        violations.push({ code: 'reading-order-break', detail: `${page.index}:${ln.id} y=${ln.y} < ${lastY}` });
      }
      perCol.set(ln.col, Math.max(lastY, ln.y + (ln.h || 0)));
      check('reading-order');
    }
  }

  // (5) גיאומטריית פערים: gapBeforePx ≥ 0 (חוזה FX-6)
  for (const page of model.pages) {
    for (const ln of page.lines) {
      if (ln.gapBeforePx != null && ln.gapBeforePx < 0) {
        violations.push({ code: 'negative-gap', detail: `${page.index}:${ln.id}` });
      }
      check('gaps');
    }
  }

  // (6) הערות מקושרות לעוגן; חותמות תקינות; אין marker יתום
  for (const page of model.pages) {
    for (const n of page.footnotes) {
      if (!n.noteId) violations.push({ code: 'note-without-id', detail: `p${page.index}` });
      if (n.anchorId == null || !tokenIds.has(n.anchorId)) {
        violations.push({ code: 'note-anchor-orphan', detail: `${n.noteId}→${n.anchorId}` });
      }
      if (n.stampValid !== true) violations.push({ code: 'note-stamp-invalid', detail: `${n.noteId}@p${page.index}` });
      check('note-linkage');
    }
    for (const sn of page.sideNotes) {
      if (!sn.noteId) violations.push({ code: 'anchor-item-without-id', detail: `p${page.index}` });
      if (sn.anchorId == null || !tokenIds.has(sn.anchorId)) {
        violations.push({ code: 'anchor-item-orphan', detail: `${sn.noteId}→${sn.anchorId}` });
      }
      if (sn.stampValid !== true) violations.push({ code: 'anchor-item-stamp-invalid', detail: `${sn.noteId}@p${page.index}` });
      check('anchor-linkage');
    }
  }

  // (7) הזמנות: כל הזמנה בתוכנית נכנסה למודל (נצרכה או מדווחת)
  let planReservations = 0, modelReservations = 0;
  for (const pp of planPages) planReservations += (pp.reservations || []).length;
  for (const page of model.pages) modelReservations += page.reservations.length;
  if (planReservations !== modelReservations) {
    violations.push({ code: 'reservations-mismatch', detail: `plan=${planReservations} model=${modelReservations}` });
  }
  checks['reservations'] = modelReservations;

  // (8) נכסים: כל נכס נפתר או מדווח (§21-10)
  if (model.meta && model.meta.resources && model.meta.resources.unresolved > 0) {
    violations.push({ code: 'resources-unresolved', detail: String(model.meta.resources.unresolved) });
  }

  // (9) סכמה ו-hashes קיימים (דטרמיניזם/immutable נאכפים חיצונית בבדיקות כפולות)
  if (model.schema !== PAGE_MODEL_SCHEMA) violations.push({ code: 'bad-schema', detail: model.schema });

  const total = Object.values(checks).reduce((a, b) => a + b, 0);
  return { checks, violations, summary: { pass: total, total, violations: violations.length, schema: PAGE_MODEL_SCHEMA } };
}

// ─── hashes דטרמיניסטיים (§7.1-8/9) ───

/** geometryHash — טביעת-אצבע גיאומטרית: מיקומים וגדלים סופיים בלבד (בלי טקסט). */
function geometryHashOf(model) {
  const canon = model.pages.map(p => ({
    i: p.index, t: p.type,
    l: p.lines.map(l => l.projected === false ? '∅' : `${l.id}:${l.x},${l.y},${l.w},${l.h},${l.baselineY}:${(l.words || []).map(w => `${Math.round(w.x * 10) / 10}+${Math.round(w.w * 10) / 10}`).join(',')}`),
    fn: p.footnotes.map(n => `${n.noteId}:${n.x},${n.y},${n.w},${n.h}`),
    sn: p.sideNotes.map(s => `${s.noteId}:${s.x},${s.yTop},${s.heightPx}`),
    d: (p.decorations || []).map(d => `${d.kind}:${d.x},${d.y},${d.w},${d.h}`)
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canon), 'utf8').digest('hex');
}

/** contentHash — הוכחת שימור מקור ברמת המודל הסופי (טקסט השורות בסדר הקריאה). */
function contentHashOf(model) {
  const canon = model.pages.map(p => ({
    i: p.index,
    l: p.lines.map(l => (l.words || []).map(w => w.text).join('\u00A7')),
    fn: p.footnotes.map(n => `${n.marker || ''}§${n.text}`),
    sn: p.sideNotes.map(s => s.text)
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canon), 'utf8').digest('hex');
}

module.exports = {
  PAGE_MODEL_SCHEMA,
  buildPageModel,
  validatePageModel,
  deepFreeze,
  geometryHashOf,
  contentHashOf
};
