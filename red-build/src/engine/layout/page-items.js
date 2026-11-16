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
  schema: { text: 'string', anchorToken: 'string', ownToken: 'string' },
  validate: (sn) => Boolean(sn && sn.text && sn.anchorToken),
  measurement: 'estimateSideNoteHeight — **ממתין לאיחוד שלב 6 פרוסה 2 (מדידה ברוחב השוליים במקור אחד עם ההקרנה)**',
  placement: 'side-notes.placeSideNotes — מפל-דחיפה עוגן-לשוליים; מקצה אנכי משותף לכל הערות השול',
  diagnostics: ['side-note-overflow', 'no-room'],
  authority: 'layout/side-notes',
  projectDOM: 'dom-renderer (aside מוחלט לפי placement)',
  projectPDF: 'geometry-projector.projectSideNotes'
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
  schema: { notes: 'Note[]', part: 'number' },
  validate: (p) => Boolean(p && p.type === 'endnotes' && Array.isArray(p.notes)),
  measurement: 'endnote-pages — **מדדי הערה מאוחדים: ממתין לפרוסה 2 (צריכת stampNoteMetrics)**',
  placement: 'endnote-pages.buildEndnotePages',
  diagnostics: ['fn-page-overflow'],
  authority: 'layout/endnote-pages',
  projectDOM: 'dom-renderer (עמודי הערות מהמודל)',
  projectPDF: 'geometry-projector.projectEndnotePage'
});

module.exports = {
  PAGE_ITEM_PARTICIPATION,
  PAGE_ITEM_SLOTS,
  registerPageItem,
  pageItemDescriptorOf,
  registeredPageItems,
  reservePageItemSpace
};
