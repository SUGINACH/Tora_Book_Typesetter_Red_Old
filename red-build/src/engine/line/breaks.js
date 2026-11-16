// src/engine/line/breaks.js — מקור אמת אחיד להזדמנויות שבירה (שלב 4, §4.1-4/5)
'use strict';

/**
 * **חוזה:** spec/00 §4.1-4 — "להגדיר break opportunities במפורש: רווחים, מקפים
 * מותרים, NBSP, מגיני תווים, קיצורים, צירופי אות/סמן הערה, וסוגי פריטים
 * אטומיים." ו-§4.1-5 — "סמן הערה והצירוף שהוא שייך אליו אינם נפרדים; אטומים
 * אינם נחתכים באמצע."
 *
 * מקור אחד לכל החלטת שבירה. כל הכללים הקיימים בפועל במנוע (protectors,
 * bindMarkersToNeighbors, buildItems) מנוסחים כאן פעם אחת על פריטי הקנון —
 * לא כטלאי על מחרוזות words[].
 *
 * **ייצוג:** פונקציות טהורות; שום מצב. המנוע (kp-linebreak) קורא אותן בעת
 * בניית הרצף ובעת חיפוש חיתוכים חוקיים — אין לו שיקול דעת משלו.
 */

// ─── תווים וסוגים (ריכוז במקום אחד — §4.1-9) ───────────────────────────────

const SPACE = ' ';
const NBSP = '\u00A0';
/** מקף עברי (מקף מחבר, U+05BE): מחבר את שני צדדיו — אסור לשבור אחריו. */
const HEBREW_MAQAF = '\u05BE';
/** מקף לועזי (U+002D): בספרות תורנית אין מקף סוף-שורה (REQ-LB) — לא הזדמנות. */
const LATIN_HYPHEN = '-';
/** גרשיים (U+05F4) וגרש (U+05F3): חלק בלתי-נפרד מהמילה/הסמן. */
const GERESHAYIM = '\u05F4';
const GERESH = '\u05F3';
/** טווח הניקוד והטעמים (U+0591–U+05C7) — סימנים משולבים; אינם גבול שבירה. */
function isCombiningMark(ch) {
  const c = code(ch);
  return (c >= 0x0591 && c <= 0x05C7) // ניקוד וטעמים
    || (c >= 0x0300 && c <= 0x036F)  // diacritics כלליים
    || (c >= 0xFE00 && c <= 0xFE0F)  // variation selectors
    || (c >= 0x200D && c <= 0x200D); // ZWJ
}
function code(ch) { return typeof ch === 'string' && ch ? ch.codePointAt(0) : 0; }

/** תווים שאינם יכולים לפתוח שורה (איסור תלייה בפתיחה — פיסוק צמוד). */
const NO_LINE_START = new Set(['.', ',', ':', ';', '!', '?', ')', ']', '}', '…', '%', GERESHAYIM, GERESH]);
/** תווים שאינם יכולים לסגור שורה (פתיחה של סוגריים חייבת את הבא אחריה). */
const NO_LINE_END = new Set(['(', '[', '{', '"', '«']);

// ─── הזדמנויות בתוך טקסט (בין תווים) ─────────────────────────────────────

/**
 * סיווג גבול בין שני תווים בתוך fragment טקסט.
 * @returns {{allowed:boolean, type?:string, reason?:string}}
 * - allowed=false ⇒ הגבול אינו הזדמנות שבירה (מבני — לא עונש).
 */
function charBoundary(prev, next) {
  if (prev == null || next == null) return { allowed: false, reason: 'edge' };
  // ניקוד/טעמים: סימן משולב נצמד לבסיס שלו — לעולם לא גבול.
  if (isCombiningMark(next)) return { allowed: false, type: 'combining-mark', reason: 'mark-follows-base' };
  if (isCombiningMark(prev)) return { allowed: false, type: 'combining-mark', reason: 'mark-ends-cluster' };
  // רווח רגיל: הזדמנות חופשית (בין מילים — מטופל ברמת הפריט).
  if (prev === SPACE) return { allowed: false, reason: 'space-consumed-by-glue' };
  if (next === SPACE) return { allowed: false, reason: 'space-consumed-by-glue' };
  // NBSP: צמידה — אין שבירה.
  if (prev === NBSP || next === NBSP) return { allowed: false, type: 'nbsp', reason: 'nbsp-glue' };
  // מקף עברי מחבר: אין שבירה אחריו ולא לפניו.
  if (prev === HEBREW_MAQAF || next === HEBREW_MAQAF) return { allowed: false, type: 'maqaf', reason: 'hebrew-maqaf-joins' };
  // מקף לועזי: אין מקף סוף-שורה בספרות תורנית (REQ-LB) — לא הזדמנות.
  if (prev === LATIN_HYPHEN) return { allowed: false, type: 'hyphen', reason: 'no-hyphenation' };
  // גרש/גרשיים בתוך מילה: חלק מהמילה.
  if (prev === GERESH || prev === GERESHAYIM || next === GERESHAYIM) return { allowed: false, type: 'geresh', reason: 'intra-word' };
  return { allowed: false, reason: 'intra-word' }; // ברירת מחדל: בתוך מילה — אין שבירה
}

/**
 * פיצול טקסט ריצה למילים לפי גבולות שבירה מותרים (מקור האמת לפיצול).
 * @param {string} text — טקסט הריצה (עם קיזוז sourceStart שלה)
 * @returns {Array<{text:string, start:number, end:number, sepAfter:string|null}>}
 *   sepAfter = המפריד המדויק שנמצא אחרי המילה (נשמר לשחזור מדויק של המקור).
 */
function splitWordsOfRun(text) {
  const out = [];
  let wordStart = -1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === SPACE) {
      if (wordStart >= 0) {
        let j = i;
        while (j < n && text[j] === SPACE) j++; // רצף רווחים — מפריד אחד מדויק
        out.push({ text: text.slice(wordStart, i), start: wordStart, end: i, sepAfter: text.slice(i, j) });
        i = j; wordStart = -1; continue;
      }
      i++; continue;
    }
    if (wordStart < 0) wordStart = i;
    i++;
  }
  if (wordStart >= 0) out.push({ text: text.slice(wordStart), start: wordStart, end: n, sepAfter: null });
  return out;
}

// ─── הזדמנויות בין פריטים (בין תיבות) ─────────────────────────────────────

/**
 * החלטת שבירה בין שני תיבות LineItem סמוכות.
 * @param {{kind:string, atomic?:boolean, constraints?:object}} left
 * @param {{kind:string, atomic?:boolean, constraints?:object}} right
 * @param {{joined?:boolean}} [rel] — יחס מפורש מהמודל (צמידת סמן-עוגן, קיצור)
 * @returns {{allowed:boolean, penalty:number, type:string, reason:string}}
 */
function breakBetweenItems(left, right, rel = {}) {
  // צמידה מפורשת (סמן הערה מוצמד לעוגן / קיצור): אין שבירה — עונש אינסופי מבני.
  if (rel.joined) return { allowed: false, penalty: Number.POSITIVE_INFINITY, type: 'joined-unit', reason: 'explicit-join' };
  // תמונה/פריט אטומי: שבירה לפניהם ואחריהם מותרת; בתוכם — מבנית (אין תת-פריטים).
  if (right.kind === 'image' || right.kind === 'atomicToken' || right.kind === 'noteMarker' || right.atomic) {
    return { allowed: true, penalty: 0, type: 'before-atomic', reason: 'atomic-boundary' };
  }
  if (left.kind === 'image' || left.kind === 'atomicToken' || left.kind === 'noteMarker' || left.atomic) {
    return { allowed: true, penalty: 0, type: 'after-atomic', reason: 'atomic-boundary' };
  }
  return { allowed: true, penalty: 0, type: 'inter-word', reason: 'space-glue' };
}

/** איסור תליית פיסוק בפתיחת שורה / סגירה בסוף שורה — נבדק על שולי השורה. */
function canStartLineWith(text) {
  const first = typeof text === 'string' && text ? text[0] : null;
  return !NO_LINE_START.has(first);
}
function canEndLineWith(text) {
  const last = typeof text === 'string' && text ? text[text.length - 1] : null;
  return !NO_LINE_END.has(last);
}

// ─── קיצורים וסמניטקסט (§4.1-4: "קיצורים, צירופי אות/סמן הערה") — מקור אחד לשני הנתיבים ───

/** רשימת קיצורים להדבקה (מקור יחיד: גם protectors של נתיב המורשת קורא מכאן). */
const ABBREVIATIONS = ['ר"ת', 'רשב"א', "תוס'", 'מרדכי', 'שב"ע', 'רמב"ם', 'רש"י', 'תוספות'];

/** סמן טקסטואליטרי (Pattern גרש): אות עברית עם גרש (א׳) או זוג-אותיות עם גרשיים (אב״) —
 * מדבק למילה שאחריו (מקור יחיד גם ל-protectors). */
const NOTE_MARKER_WORD_RE = /([א-ת]׳|[א-ת]{1,2}״)$/;
const isTextNoteMarkerWord = (word) => NOTE_MARKER_WORD_RE.test(String(word || ''));
const isAbbreviationWord = (word) => ABBREVIATIONS.includes(String(word || ''));

module.exports = {
  SPACE, NBSP, HEBREW_MAQAF, LATIN_HYPHEN, GERESH, GERESHAYIM,
  ABBREVIATIONS, NOTE_MARKER_WORD_RE, isTextNoteMarkerWord, isAbbreviationWord,
  isCombiningMark, charBoundary, splitWordsOfRun, breakBetweenItems,
  canStartLineWith, canEndLineWith
};
