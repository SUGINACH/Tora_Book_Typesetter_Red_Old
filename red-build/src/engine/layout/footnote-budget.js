// src/engine/layout/footnote-budget.js — Footnote reservation (REQ-FN-01/02/07)
'use strict';

const { assignFootnoteLanes } = require('./footnote-lanes'); // **שלב 5 (חילוץ שורש מ-PR #16):** מקור-אמת יחיד לחלוקת נתיבי המרזב

/**
 * **מקור־הסמכות היחיד לתקציב המרזב** (תיקון P1-1): הן probe הן reservation
 * עוברים כאן — getFootnotesReservedHeight — וה‑dp-planner קורא לזה בלבד
 * (בעבר היו שני מימושים מקבילים: כאן ו‑recomputeFnBudget מקומי, והבדיקה
 * probe==reserved רצה על מודול שהמנוע לא השתמש בו).
 * כולל הערות של הפסקה הנמדדת כעת (לקח V2/V4).
 * מדיניות הערה ארוכה (split/move-whole/reject-to-body) מיושמת ב‑dp-planner
 * **בזמן ההצבה** — המודול הזה אינו מחזיק עוד מימוש תאום מת (באג S6).
 */

/** פרופילי רוחב גופן לגוף ההערה (f-note-body-font). */
const NOTE_FONT_FACTORS = { 'David HB': 1.06, 'David': 1.04, 'Narkisim': 1.10, 'Nachlieli': 0.96, 'Alef': 1.02, 'Rubin': 1.05 };

/** **שלב 5 (חילוץ שורש מ-PR #16 — מדדי ההערה, מקור יחיד):** גודל גוף-ההערה
 * (0.8× הגוף — כמו .footnotes{font-size:.8em} ב-DOM) ופיץ' השורה שלו (1.25 —
 * כמו המרזב בשני הרנדרים). עד כאן הנוסחה שוכפלה בשלושה אתרים (כאן, פיצול
 * ההערה-הארוכה ב-dp-planner, הקרנת המרזב ב-geometry-projector) — כל
 * נגזרת שהתרחקה מחברותיה הזיזה את התקציב מול ההקרנה. */
function noteMetrics(settings) {
  const sizePt = settings['body-font-size-pt'] * 0.8;
  const lineHeightPx = Math.round(sizePt * (96 / 72) * 1.25);
  return { sizePt, lineHeightPx };
}

function noteHeight(note, settings, measure) {
  // **פרוסה 2 (מדידה אחת — §2.3 בביקורת):** צריכת החותמת קודמת לחישוב —
  // הערה שנמדדה פעם אחת (ביצירתה, CP2) אינה נמדדת שוב לאף החלטת הצבה.
  if (note && note.heightPx != null) return note.heightPx;
  return noteRowsOf(note, settings, measure).heightPx;
}

/**
 * **פרוסה 2 — שבירת שורות ההערה + מדדיה (מקור יחיד, חד-פעמי):**
 * אותו אלגוריתם גרידי ברוחב הנתיב (כמו שהיה ב-noteHeight) — אך מוחזר
 * כמבנה שורות מלא: `{ rows, heightPx, linesCount, lineH, words }`, כאשר כל
 * שורה היא `{ wFrom, wTo, widthPx }` (טווח מילים + רוחב). השורות כוללות את
 * הסמן ורווח ההמשך בשורה הראשונה — כמו שמצויר בפועל (R3-C3).
 * הצרכנים: התקציב (noteHeight), הפיצול של הערה ארוכה (dp-planner —
 * חיתוך בגבול שורה מוחלט, בלי מדידת מילים מחדש) והקרנת המרזב (עתיד
 * שלב 6/7 — אותן שורות בדיוק). ההטבעה עצמה — stampNoteMetrics להלן.
 */
// **פרוסה 2 (טוהר מדידה — חשבונאות בדיקה, דפוס api.cacheStats):** מונה פנימי
// להפעלות שבירת השורות של ההערה. הבדיקות מוכיחות באמצעותו שכל הערה נמדדת
// בדיוק פעם אחת (החותמת) — ושההמשכים מטיצול הם הטקסטים החדשים היחידים.
const _rowsStats = { calls: [] };
function __resetRowsStats() { _rowsStats.calls.length = 0; }
function __rowsStats() {
  const perKey = Object.create(null);
  for (const k of _rowsStats.calls) perKey[k] = (perKey[k] || 0) + 1;
  return { total: _rowsStats.calls.length, keys: _rowsStats.calls.slice(), perKey };
}

function noteRowsOf(note, settings, measure) {
  if (note && note.text != null) {
    _rowsStats.calls.push(`${note.tokenId || ''}#${note.noteIndex != null ? note.noteIndex : ''}#${String(note.text).slice(0, 24)}`);
  }
  const { sizePt, lineHeightPx: lh } = noteMetrics(settings); // **שלב 5:** מקור יחיד לגודל/פיץ'
  const words = String(note.text).replace(/\uE000/g, ' ').split(/\s+/).filter(Boolean);
  const colW = laneWidth(settings);
  // **S70 (R7-M4):** הפקטור מתקן את טבלת impl A בלבד; ב-impl B
  // (font-metrics) המטריקות מדויקות והכפלה הייתה מנפחת את תקציב ההערות.
  const factor = (measure && measure.impl === 'font-metrics')
    ? 1 : (NOTE_FONT_FACTORS[settings['f-note-body-font']] || 1);
  // **S6.0 (R3-C3 — אומדן ללא רווחים):** ההקרנה (wrapNoteTokens) שוברת
  // את ההערה **עם** רוחבי רווח בין מילים — האומדן כאן סיכם מילים בלבד
  // ⇒ כל הערה הגובלת בשבירת-שורה נמדדה שורה אחת פחות (19–21px) וההערה
  // שאחריה חפפה אותה (32% מ-230 הערות בדגימה). נכללים גם הסמן ורווח
  // ההמשך בשורה הראשונה — כמו שמצויר בפועל.
  const spaceW = measure(' ', sizePt) * factor;
  const mkTxt = note && note.marker != null ? String(note.marker) : '';
  const mkW = mkTxt ? measure(mkTxt, sizePt) * factor + spaceW : 0;
  const rows = [];
  let rowW = Math.min(mkW, colW); // סמן בפינת השורה הראשונה
  let wFrom = 0;
  for (let i = 0; i < words.length; i++) {
    const ww = measure(words[i], sizePt) * factor;
    const addW = (rowW > 0 ? spaceW : 0) + ww;
    if (rowW + addW > colW && rowW > 0) {
      rows.push({ wFrom, wTo: i, widthPx: rowW });
      wFrom = i; rowW = ww;
    } else rowW += addW;
  }
  rows.push({ wFrom, wTo: words.length, widthPx: rowW });
  return { rows, heightPx: rows.length * lh, linesCount: rows.length, lineH: lh, words };
}

/**
 * **פרוסה 2 (§2.3 — מדידה אחת לכל פריט):** הטבעת מדדי ההערה על אובייקט
 * ההערה עצמו, ברגע יצירתה (CP2 ב-pipeline). מרגע זה כל הצרכנים — תקציב,
 * הצבה, פיצול, ניקוז זנב — קוראים את החותמת ואינם מודדים שוב. הערה שנוצרה
 * בפיצול (המשך) היא טקסט חדש — מוטבעת אף היא פעם אחת בלבד.
 * @param {object} note - { text, marker, ... } — מוטציה באתר (המקור בידי ה-pipeline)
 * @returns {object} ה-note עצמו (שרשרת)
 */
function stampNoteMetrics(note, settings, measure) {
  const m = noteRowsOf(note, settings, measure);
  note.heightPx = m.heightPx;
  note.lineH = m.lineH;
  note.linesCount = m.linesCount;
  note.noteRows = m.rows;
  note.noteWords = m.words;
  return note;
}

function laneWidth(settings) {
  const base = settings._fnColWidthPx || 200;
  return settings['footnote-columns'] === 2 ? base : base;
  // _fnColWidthPx כבר מכוין לפי המספר טורים במרזב (הpipeline מזרים) — נשמר כאן כפשוטו.
}

/**
 * getFootnotesReservedHeight — הזהה ל‑probe (BRZ: no divergence):
 * @param {Array} pageNotes - [{text, marker}]
 */
function getFootnotesReservedHeight(pageNotes, settings, measure) {
  if (!settings['footnotes-enabled']) return 0;
  if (!pageNotes || !pageNotes.length) return 0;
  const cols = settings['footnote-columns'];
  const heights = pageNotes.map(n => n.heightPx != null ? n.heightPx : noteHeight(n, settings, measure));
  if (cols === 1) return heights.reduce((a, b) => a + b, 0);
  // 2 טורים: חלוקה שווה־גובה — **שלב 5 (חילוץ שורש מ-PR #16):** מקור יחיד
  // (footnote-lanes). שקול מתמטית למימוש הקודם (סדר גובה-יורד/אינדקס-עולה,
  // חמדני לנמוך) — נעול בבדיקת שקילות; מעתה תקציב/הקרנה/תצוגה משתפים את
  // אותה חלוקה ממקור אחד.
  const { totals } = assignFootnoteLanes(pageNotes, (n, i) => heights[i]);
  return Math.max(totals[0], totals[1]);
}

module.exports = { getFootnotesReservedHeight, noteHeight, noteRowsOf, stampNoteMetrics, noteMetrics, laneWidth, NOTE_FONT_FACTORS, __resetRowsStats, __rowsStats };
