// src/engine/layout/decision-trace.js — תיעוד החלטות תכנון דטרמיניסטי קומפקטי (שלב 5 פרוסה 2)
'use strict';

/**
 * **רשם החלטות התכנון (§2.7 בביקורת שלב 5):** trace שמסביר אילו מועמדים
 * נבחנו, אילו אילוצים הופעלו, מדוע מועמד נדחה, מה ניקודו, מדוע נבחר,
 * מדוע בוצעה נסיגה ומה תוצאתה — לכל החלטה מהותית של ה-Planner.
 *
 * עקרונות החוזה:
 *  - **דטרמיניזם מוחלט:** אסורים תאריך/שעה/אקראיות/מזהי ריצה; הסדר הוא
 *    סדר ההחלטות עצמן. שתי ריצות זהות מניבות trace זהה ביט-לביט.
 *  - **קומפקטיות מוגבלת:** תקרת רשומות (ברירת מחדל 20,000) + דגל
 *    truncated — לא מנפח זיכרון ללא גבול. ההפעלה opt-in (env.plannerTrace
 *    או settings._plannerTrace) — כבוי בברירת המחדל; הספירות (counts)
 *    נשמרות תמיד כך שגם trace כבוי מדווח כמות החלטות לפי סוג.
 *  - **שימושי לאבחון:** כל רשומה היא { p: עמוד, k: סוג, d: נתונים } —
 *    מפתח קצר, נתונים עגולים (round2) — קריא בפלט JSON ובבדיקות.
 */

const DEFAULT_MAX_ENTRIES = 20000;

function createTraceRecorder(opts = {}) {
  const enabled = opts.enabled === true;
  const maxEntries = Number.isFinite(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
  const entries = [];
  const counts = Object.create(null);
  let truncated = false;

  /** עיגול ערכים מספריים בנתונים — דטרמיניזם בפלט (בלי שאריות נקודה צפה). */
  function freezeData(d) {
    if (d == null || typeof d !== 'object') return d;
    const out = {};
    for (const k of Object.keys(d).sort()) {
      const v = d[k];
      if (typeof v === 'number' && !Number.isInteger(v)) out[k] = Math.round(v * 100) / 100;
      else if (Array.isArray(v)) out[k] = v.slice(0, 8); // רשימות נחתכות — קומפקטיות
      else out[k] = v;
    }
    return out;
  }

  return {
    enabled,
    /** רשומת החלטה. page — אינדקס העמוד (או null להחלטה גלובלית). */
    emit(page, kind, data) {
      counts[kind] = (counts[kind] || 0) + 1;
      if (!enabled) return;
      if (entries.length >= maxEntries) { truncated = true; return; }
      entries.push({ p: page == null ? null : page, k: kind, d: freezeData(data) });
    },
    /** ספירות בלבד (ללא רשומות) — תמיד זמין, גם כשה-trace כבוי. */
    stats() {
      return { enabled, entries: entries.length, truncated, counts: { ...counts } };
    },
    /** פלט JSON — הרשומות עצמן (כשמופעל). */
    toJSON() {
      return { entries, truncated };
    }
  };
}

module.exports = { createTraceRecorder, DEFAULT_MAX_ENTRIES };
