// src/engine/layout/page-items.js — חוזה Page Item + רישום סוגי פריטי עמוד (שלב 6 פרוסה 1)
'use strict';

/**
 * **מעמד (תוכנית §6.1 + הוראת שלב 6 §§6/10):** חוזה אחיד עבור כל פריטי העמוד —
 * כותרות עליונות/תחתונות, מספרי עמוד, קווי הפרדה, עיטורים, שערים, תוכן
 * עניינים, עמודי הערות, עמודים מותאמים, פריטי רקע ופריטים מיוחדים.
 *
 * **חמשת אופני ההשתתפות** (ההבחנה בשדות החוזה, לא במנועים נפרדים — הוראת §6):
 *  - `flow`     — פריט שזורם בגוף העמוד (פסקה, כותרת, תמונה inline).
 *  - `block`    — פריט בלוק (תמונת בלוק/ממורכזת, פס חוצה-טורים).
 *  - `anchor`   — פריט עוגן (הערת-צד: ממוקם בשוליים בעיגון לפסקה מארחת).
 *  - `furniture` — ריהוט קבוע של העמוד (כותרת עליונה, גיליון, חוט הפרדה).
 *  - `reserved` — פריט שמזמין שטח גיאומטרי מראש (עיטור שמקצר גוף, מפריד
 *                 טורים בעל תפוסה, אזור הערות) — דרך מודל הקיבולת של שלב 5
 *                 (page.reservations).
 *
 * **עקרונות:**
 *  - הרישום מכריז; המימושים הקיימים (הבונים) נשארים בעלי הסמכות — ה-descriptor
 *    מצביע עליהם באמצעות שדה `authority` (לא מנוע מקבילי). כל סוג חדש שנרשם
 *    חייב לענות על כל החריצים — כולל הקרנת DOM/PDF — בלי תנאים מפוזרים.
 *  - פריט ריהוט/שמור שמזמין מקום חייב להצהיר `reservation` — וההזמנה מתבצעת
 *    לפני הצבת הטקסט, דרך page.reservations של ה-Planner (שלב 5 — מנגנון אחיד).
 *  - הוספה/הסרה של פריט ריהוט אינה משנה תוכן או זהות פריטים — constraints
 *    ו-geometry בלבד (הוראת §8).
 */

const { registerPageItem: _noop } = { registerPageItem: null }; // (מונע שימוש שוגה — ה-API להלן)

/** אופני ההשתפות ברמת העמוד (הבחנת החוזה — הוראת שלב 6 §6). */
const PAGE_ITEM_PARTICIPATION = Object.freeze({
  FLOW: 'flow',
  BLOCK: 'block',
  ANCHOR: 'anchor',
  FURNITURE: 'furniture',
  RESERVED: 'reserved'
});

/** חריצי חוזה מותרים ברישום סוג פריט עמוד. */
const PAGE_ITEM_SLOTS = Object.freeze([
  'schema',            // סכמת ההצהרה (שדות חובה/אופציונליים)
  'validate',          // ולידציה (פונקציה טהורה על instance)
  'participation',     // אחד מ-PAGE_ITEM_PARTICIPATION
  'slot',              // אזור העמוד (header/footer/margin/body/band/divider)
  'reservation',       // { px | (page)=>px, scope:'all-columns'|'last-column', reason } — ל-reserved
  'resourceDeps',      // תלויות נכסים (ל-AssetResolver)
  'measurement',       // מקור המדידה (מזהה/פונקציה) — "מדידה אחת"
  'placement',         // מקור ההחלטה (מזהה הבונה/המנגנון) — סמכות קיימת
  'diagnostics',       // קטלוג אבחון שהסוג מפיק
  'authority',         // המודול/הבונה המחזיק במימוש (תיעוד הסמכות — לא מנוע מקבילי)
  'projectDOM',        // מזהה הקרנת DOM (מימוש קיים/חוזה)
  'projectPDF'         // מזיה הקרנת PDF
]);

const entries = new Map();

/**
 * רישום סוג פריט עמוד. חד-פעמי ומחמיר (כמו model/registry): רישום כפול =
 * שגיאה; חריץ לא מוכר = שגיאה; participation חסר = שגיאה.
 * @returns {function} unregister
 */
function registerPageItem(kind, descriptor) {
  if (typeof kind !== 'string' || !kind.trim()) {
    throw new TypeError('page-items: kind must be a non-empty string');
  }
  const normalized = kind.trim();
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('page-items: descriptor must be an object');
  }
  for (const slot of Object.keys(descriptor)) {
    if (!PAGE_ITEM_SLOTS.includes(slot)) {
      throw new TypeError(`page-items: unknown slot "${slot}" (allowed: ${PAGE_ITEM_SLOTS.join(', ')})`);
    }
  }
  if (!Object.values(PAGE_ITEM_PARTICIPATION).includes(descriptor.participation)) {
    throw new TypeError(`page-items: descriptor.participation must be one of ${Object.values(PAGE_ITEM_PARTICIPATION).join('|')} — got: ${descriptor.participation}`);
  }
  if (descriptor.participation === PAGE_ITEM_PARTICIPATION.RESERVED && !descriptor.reservation) {
    throw new TypeError('page-items: reserved item must declare reservation (px + scope) — space is invited before text placement');
  }
  if (typeof descriptor.validate !== 'function') {
    throw new TypeError('page-items: descriptor.validate (function) is required');
  }
  if (entries.has(normalized)) {
    throw new Error('page-items: page item kind already registered: ' + normalized);
  }
  entries.set(normalized, Object.freeze({ kind: normalized, ...descriptor }));
  return () => entries.delete(normalized);
}

function pageItemDescriptorOf(kind) { return entries.get(String(kind)) || null; }
function registeredPageItems() { return Array.from(entries.values()); }

/**
 * הזמנת שטח גיאומטרי לפריט reserved, דרך מודל הקיבולת האחיד של שלב 5
 * (page.reservations) — **לפני** הצבת הטקסט. טהורה: מוטציה מבוקרת בלבד
 * בשדה ה-reservations של העמוד.
 * @param {object} page — עמוד DP (עם reservations[])
 * @param {string} kind — סוג פריט רשום (reserved)
 * @param {object} [ctx] — הקשר לחישוב px דינמי (למשל גובה שורה)
 */
function reservePageItemSpace(page, kind, ctx = {}) {
  const d = pageItemDescriptorOf(kind);
  if (!d || d.participation !== PAGE_ITEM_PARTICIPATION.RESERVED) {
    throw new TypeError('page-items: reservePageItemSpace accepts only registered reserved items — got: ' + kind);
  }
  const px = typeof d.reservation.px === 'function' ? d.reservation.px(page, ctx) : Number(d.reservation.px);
  if (!(px > 0)) return { kind, px: 0, applied: false };
  if (!Array.isArray(page.reservations)) page.reservations = [];
  page.reservations.push({ kind, scope: d.reservation.scope || 'all-columns', px, reason: d.reservation.reason || kind });
  return { kind, px, applied: true };
}

// ─── הצהרת הסוגים הקיימים (הבונים הקיימים נשארים הסמכות — תיעוד החוזה) ───
// כל רישום מצהיר: השתתפות, אזור, מקור מדידה, סמכות ההחלטה והקרנות.
// אלו הם הסוגים שלב 6 פרוסה 2 יהגר אל מימוש מלא דרך החוזה; בפרוסה זו הם
// ההצהרה הקנונית שמפורשת את המפה (ומאומתת בבדיקות חיוב/שלילה).

registerPageItem('body-block', {
  participation: PAGE_ITEM_PARTICIPATION.FLOW,
  slot: 'body',
  schema: { lines: 'LineModel[]', tokenId: 'string' },
  validate: (b) => Boolean(b && Array.isArray(b.lines) && b.tokenId != null),
  measurement: 'measureDocumentModel (single boundary, שלב 3-4)',
  placement: 'dp-planner.planPages (המתכנן היחיד, שלב 5)',
  diagnostics: ['line-engine', 'page-plan-invalid'],
  authority: 'line/pipeline-bridge + layout/dp-planner',
  projectDOM: 'dom-renderer.renderLine',
  projectPDF: 'geometry-projector.projectLine'
});

registerPageItem('spanning-band', {
  participation: PAGE_ITEM_PARTICIPATION.BLOCK,
  slot: 'band',
  schema: { lines: 'LineModel[]', heightPx: 'number' },
  validate: (b) => Boolean(b && Array.isArray(b.lines) && (b.heightPx || 0) > 0),
  measurement: 'נמדד ברוחב מלא בזמן השבירה (layoutModelBlock)',
  placement: 'dp-planner — הפס מקצר את כל הטורים (colCapacityOf)',
  reservation: { px: (page) => (page && page.spanning ? page.spanning.heightPx : 0), scope: 'all-columns', reason: 'cross-column band (FWD-1)' },
  diagnostics: ['containment'],
  authority: 'layout/dp-planner + layout/column-flow',
  projectDOM: 'dom-renderer.renderSpanningBand',
  projectPDF: 'geometry-projector (band lines)'
});

registerPageItem('running-header', {
  participation: PAGE_ITEM_PARTICIPATION.FURNITURE,
  slot: 'header',
  schema: { slots: '{right,center,left}' },
  validate: (h) => Boolean(h && h.slots),
  measurement: 'headers-builder מודד סלוטים ב-9pt (D-81)',
  placement: 'furniture-geometry.headerGeometry — מקור יחיד ל-DOM ול-PDF (שלב 6)',
  diagnostics: [],
  authority: 'decoration/headers-builder + layout/furniture-geometry',
  projectDOM: 'dom-renderer.renderHeader',
  projectPDF: 'geometry-projector (header slots)'
});

registerPageItem('folio', {
  participation: PAGE_ITEM_PARTICIPATION.FURNITURE,
  slot: 'footer',
  schema: { folioDisplay: 'string', pageNumber: 'number' },
  validate: (p) => Boolean(p && p.folioDisplay != null),
  measurement: 'מדידת הגיליון בגופן/גודל מההגדרות (folioGeometry)',
  placement: 'furniture-geometry.folioGeometry — מקור יחיד ל-DOM ול-PDF (שלב 6)',
  diagnostics: ['pn-overflow'],
  authority: 'decoration/folio + layout/furniture-geometry',
  projectDOM: 'dom-renderer.renderFolio',
  projectPDF: 'geometry-projector (folio)'
});

registerPageItem('column-divider', {
  participation: PAGE_ITEM_PARTICIPATION.RESERVED,
  slot: 'divider',
  schema: { style: 'thin|dashed|double|none' },
  validate: (s) => Boolean(s && s['column-divider-style']),
  reservation: { px: 0, scope: 'all-columns', reason: 'overlay — geometry-neutral (כלל V4: אורך בלבד, ללא תפוסה)' },
  measurement: 'אין תפוסה — overlay',
  placement: 'גובה Math.min(טורים)−8 (ornament-fit.columnDividerHeightPx — F-09)',
  diagnostics: [],
  authority: 'decoration/ornament-fit',
  projectDOM: 'dom-renderer.renderColumnDivider',
  projectPDF: 'geometry-projector.projectColumnDivider'
});

registerPageItem('footnote-gutter', {
  participation: PAGE_ITEM_PARTICIPATION.RESERVED,
  slot: 'notes-area',
  schema: { footnotes: 'Note[]' },
  validate: (p) => Boolean(p && Array.isArray(p.footnotes)),
  reservation: { px: (page) => (page && page.fnReservedHeightPx) || 0, scope: 'all-columns', reason: 'footnote area budget (F-17, R3-C2)' },
  measurement: 'stampNoteMetrics (CP2 — מדידה אחת; שלב 5 פרוסה 2)',
  placement: 'dp-planner.reserveNotes — תקציב בהכרעת ההצבה (FX-3)',
  diagnostics: ['fn-split', 'fn-moved-whole', 'fn-tail-overflow', 'fn-degenerate'],
  authority: 'layout/footnote-budget + dp-planner',
  projectDOM: 'dom-renderer.renderFootnoteArea',
  projectPDF: 'geometry-projector.projectFootnoteGutter'
});

registerPageItem('side-note', {
  participation: PAGE_ITEM_PARTICIPATION.ANCHOR,
  slot: 'margin',
  schema: { text: 'string', anchorToken: 'string', ownToken: 'string', noteRows: 'Row[]', noteWords: 'string[]', lineH: 'number' },
  validate: (sn) => Boolean(sn && sn.text && sn.anchorToken),
  measurement: 'notes-model.stampNote (side-note ctx) — **מדידה אחת ביצירת הפריט ב-DP (פרוסה 2, §10)**: רוחב השוליים בפועל, רוחבי מילים/סמן/רווח, פיץ׳ 1.15',
  placement: 'side-notes.placeSideNotes — **המקצה האנכי המשותף** (פרוסה 2, §8): כל פריטי העוגן של העמוד בחישוב אחד; cascade + מרווח + מיכל + trace',
  diagnostics: ['side-note-overflow', 'no-room', 'note-stamp-missing'],
  authority: 'layout/side-notes + layout/notes-model',
  projectDOM: 'dom-renderer (aside — שורות מהחותמת, line-height מפורש)',
  projectPDF: 'geometry-projector.projectStampedRows (projectSideNotes)'
});

// **שלב 6 פרוסה 2 (§11 — הוכחת הרחבה אמיתית):** פריט מותאם חדש שאינו מ-11 הסוגים
// שנרשמו בפרוסה 1. תיבת מידע בשוליים — עוגן לפסקה מארחת, רוחב/ריפוד/מסגרת
// מוגדרים בסגנון, מדידה קנונית ברוחב הפנימי, וגובה התיבה כולה בחותמת —
// מה שההקצאה מקבלת הוא מה שמוקרן. רוכב על מסלול העוגן הקיים (אין מנוע
// מקבילי ואין ענף if/else פר-שכבה מעבר לשסע ההרחבה של החוזה).
registerPageItem('info-box', {
  participation: PAGE_ITEM_PARTICIPATION.ANCHOR,
  slot: 'margin',
  schema: {
    text: 'string', anchorToken: 'string', ownToken: 'string',
    itemKind: '"info-box"', boxSpec: '{ widthPx, padPx, borderPx }',
    boxChrome: '{ pad, border }', styleSpec: '{ background?, border?, fontSizePt? }',
    noteRows: 'Row[]', noteWords: 'string[]', lineH: 'number', heightPx: 'number (כולל מסגרת+ריפוד)'
  },
  validate: (b) => Boolean(b && b.text && b.anchorToken && b.itemKind === 'info-box'
    && b.boxSpec && Number(b.boxSpec.widthPx) > 0),
  measurement: 'notes-model.stampNote (info-box ctx — רוחב פנימי = מוגדר פחות מסגרת/ריפוד); הגובה כולל chrome',
  placement: 'side-notes.placeSideNotes — אותו מקצה אנכי משותף (עוגן, cascade, מיכל)',
  diagnostics: ['side-note-overflow', 'no-room', 'note-stamp-missing'],
  authority: 'extensions/style-schema (parse/validate) + layout/notes-model + layout/side-notes',
  projectDOM: 'dom-renderer (aside.info-box — רקע/מסגרת/ריפוד מהחוזה + שורות מהחותמת)',
  projectPDF: 'geometry-projector.projectSideNotes (תיבה כעיטור + projectStampedRows)'
});

registerPageItem('ornament', {
  participation: PAGE_ITEM_PARTICIPATION.RESERVED,
  slot: 'variable',
  schema: { kindStyle: 'string', x: 'number', y: 'number', w: 'number', h: 'number' },
  validate: (d) => Boolean(d && d.kindStyle && Number.isFinite(d.x)),
  reservation: { px: 0, scope: 'all-columns', reason: 'overlay-rects מהפאס (F-09); הזמנת גובה חיה בתוך גבהי השורות (F-08) — לא נספרת פעמיים' },
  measurement: 'ornament-fit — מדדי התאמה בגודל סופי',
  placement: 'ornament-plan — פאס עיטורים ניטרלי-גיאומטריה (T1 מוכח)',
  diagnostics: ['ornament-overflow', 'ornament-overlap', 'ornament-asymmetry'],
  authority: 'decoration/ornament-plan + ornament-ink',
  projectDOM: 'dom-renderer.renderDecorations',
  projectPDF: 'geometry-projector (decorations pdfOps)'
});

registerPageItem('shaar-gate', {
  participation: PAGE_ITEM_PARTICIPATION.BLOCK,
  slot: 'gate-page',
  schema: { boxes: 'ShaarBox[]', theme: 'string|null' },
  validate: (p) => Boolean(p && (p.isShaar || p.type === 'custom')),
  measurement: 'shaar-content — תיבות שער במדידה חיה',
  placement: 'shaar-pages.insertShaarPages — עמודים מבניים מוכנסים; **עיצובי השערים המקוריים פעילים אוטומטית (נעול ברגרסיה)**',
  diagnostics: ['settings-verification'],
  authority: 'decoration/shaar-pages + theme-sets',
  projectDOM: 'dom-renderer.renderPageBackgroundAndShaar',
  projectPDF: 'geometry-projector (shaar boxes)'
});

registerPageItem('toc-page', {
  participation: PAGE_ITEM_PARTICIPATION.BLOCK,
  slot: 'toc-page',
  schema: { rows: 'TocRow[]' },
  validate: (p) => Boolean(p && (p.type === 'toc-general' || p.type === 'toc-detail')),
  measurement: 'toc-builder — שורות במדידה חיה',
  placement: 'toc-builder.buildTocPages + insertTocPages — עמודים מבניים',
  diagnostics: ['toc-hanging'],
  authority: 'decoration/toc-builder',
  projectDOM: 'dom-renderer.renderTocPageContent',
  projectPDF: 'geometry-projector (toc rows)'
});

registerPageItem('endnote-page', {
  participation: PAGE_ITEM_PARTICIPATION.BLOCK,
  slot: 'notes-page',
  schema: { notes: 'Note[]', part: 'number', noteRows: 'Row[] (לכל הערה)' },
  validate: (p) => Boolean(p && p.type === 'endnotes' && Array.isArray(p.notes)),
  measurement: 'notes-model.stampNote (endnote ctx — רוחב הטור בפועל) — **פרוסה 2: המדידה היחידה, בבונה עצמו**; התקציב/DOM/PDF צורכים אותה',
  placement: 'endnote-pages.buildEndnotePages',
  diagnostics: ['fn-page-overflow', 'note-stamp-missing'],
  authority: 'layout/endnote-pages + layout/notes-model',
  projectDOM: 'dom-renderer (עמודי הערות — שורות מהחותמת)',
  projectPDF: 'geometry-projector.projectEndnotePage (projectStampedRows)'
});

/**
 * **הרישום כסמכות תפעולית (פרוסה 2, §5 בהוראה):** מעבר אימות שרץ ב-pipeline
 * אחרי ההצבות — כל פריט שהוצב בפועל על עמוד נבדק מול ה-descriptor של סוגו
 * (schema/validate), והערות/פריטי עוגן גם מול תקינות החותמת (stampIsValid).
 * הרישום אינו עוד הצהרה בלבד: החוזה נצרך ואינו מקבילי לבונים — הבונים
 * מייצרים, החוזה מאמת.
 * @param {Array} pages — עמודי התוצר (אחרי הצבה/ריהוט)
 * @param {object} [opts] — { validateStamps: bool = true }
 * @returns {{checked: Object<string,number>, violations: Array<{kind,page,code,note?}>}}
 */
function validatePageItems(pages, opts = {}) {
  const validateStamps = opts.validateStamps !== false;
  const { stampIsValid } = require('./notes-model');
  const checked = Object.create(null);
  const violations = [];
  const check = (kind, instance, page, extra) => {
    const d = pageItemDescriptorOf(kind);
    if (!d) { violations.push({ kind, page, code: 'kind-not-registered' }); return; }
    checked[kind] = (checked[kind] || 0) + 1;
    if (!d.validate(instance)) violations.push({ kind, page, code: 'contract-invalid', ...(extra || {}) });
  };
  for (const page of pages || []) {
    const pIdx = page && page.index != null ? page.index : null;
    if (page.folioDisplay) check('folio', page, pIdx);
    if (page.header) check('running-header', page.header, pIdx);
    if (page.footnotes && page.footnotes.length) {
      check('footnote-gutter', page, pIdx);
      if (validateStamps) {
        for (const n of page.footnotes) {
          if (!stampIsValid(n)) violations.push({ kind: 'footnote-gutter', page: pIdx, code: 'note-stamp-invalid', note: n.noteId || n.tokenId || null });
        }
      }
    }
    for (const sn of (page.sideNotes || [])) {
      if (sn.yTop == null) continue; // רק המוקמות בפועל
      const kind = sn.itemKind === 'info-box' ? 'info-box' : 'side-note';
      check(kind, sn, pIdx, { note: sn.noteId || sn.ownToken || null });
      if (validateStamps && !stampIsValid(sn)) {
        violations.push({ kind, page: pIdx, code: 'note-stamp-invalid', note: sn.noteId || sn.ownToken || null });
      }
    }
    for (const d of (page.decorations || [])) check('ornament', d, pIdx);
    if (page.spanning && page.spanning.lines && page.spanning.lines.length) check('spanning-band', page.spanning, pIdx);
    if (page.type === 'endnotes') {
      check('endnote-page', page, pIdx);
      if (validateStamps) {
        for (const n of (page.notes || [])) {
          if (!stampIsValid(n)) violations.push({ kind: 'endnote-page', page: pIdx, code: 'note-stamp-invalid', note: n.noteId || n.tokenId || null });
        }
      }
    }
    if (page.type === 'toc-general' || page.type === 'toc-detail') check('toc-page', page, pIdx);
    if (page.type === 'shaar-main' || page.type === 'shaar-sub' || page.type === 'shaar-back' || page.type === 'custom') check('shaar-gate', page, pIdx);
    // גוף זורם: קלות ובגבולות — הטור הראשון עם שורות מייצג את ה-block של העמוד
    const firstCol = (page.columns || []).find(c => c && c.length);
    if (firstCol) check('body-block', { lines: firstCol, tokenId: firstCol[0].tokenId != null ? firstCol[0].tokenId : (firstCol[0].meta && firstCol[0].meta.tokenId) }, pIdx);
  }
  return { checked, violations };
}

module.exports = {
  PAGE_ITEM_PARTICIPATION,
  PAGE_ITEM_SLOTS,
  registerPageItem,
  pageItemDescriptorOf,
  registeredPageItems,
  reservePageItemSpace,
  validatePageItems
};
