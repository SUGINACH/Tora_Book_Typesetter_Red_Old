// src/engine/model/kinds.js — קבועי סוגי פריטים קנוניים (שלב 2)
// **חוזה:** spec/03_UNIFIED_ITEM_CONTRACT.md §2-§3 · spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §2.1.
// מילון יחיד לסוגי בלוקים ופריטי inline. אין להשתמש בשמות אחרים לאותו סוג
// (word/box/token של המורשת ממופים לכאן בלבד דרך adapter הכניסה).
'use strict';

/** סוגי בלוקים ברמת המסמך (DocumentModel.blocks[].kind). */
const BLOCK_KINDS = Object.freeze({
  HEADING: 'heading',            // כותרת רמות 0–7 (0=הקדמה/ספר, 1=חלק, 2=פרק …)
  PARAGRAPH: 'paragraph',        // פסקה רגילה
  ENDNOTE: 'endnote',            // גוף הערת-סיון (תוכן — D-40)
  ENDNOTE_CLASS: 'endnoteClass', // הוראת כותרת עמודי ההערות (רבים בלבד)
  EDITORIAL: 'editorial'         // ##…## — מוסר מהפלט, נשמר לחשבונאות
});

/** סוגי פריטי inline בתוך בלוק (Inline Item Model — חוזה §3). */
const ITEM_KINDS = Object.freeze({
  TEXT: 'text',            // ריצת טקסט (עם runs[] כשיש טווחי גופן/סגנון)
  NOTE_MARKER: 'noteMarker', // סמן הערה אטומי — קישור מבני noteRef לגוף ההערה
  IMAGE: 'image',          // תמונה inline — assetId + מידות טבעיות + fit
  ANCHOR: 'anchor',        // עוגן יעד (זהות יציבה לקישור פנימי)
  ATOMIC_TOKEN: 'atomicToken', // טוקן אטומי (מספר/תאריך/מקור ציטוט)
  GLUE: 'glue',            // דבק מפורש (רווח בלתי-שביר וכדומה) — לפי הצורך
  PENALTY: 'penalty',      // עונש שבירה מפורש — לפי הצורך
  CUSTOM: 'custom'         // פריט מותאם — חייב רישום ב-registry בלבד
});

/** \u05de\u05d3\u05d9\u05e0\u05d9\u05d5\u05ea \u05d4\u05e6\u05d1\u05ea \u05ea\u05de\u05d5\u05e0\u05d4 (\u05e9\u05dc\u05d1 3, \u00a73.1-4 \u2014 \u05de\u05d3\u05d9\u05e0\u05d5\u05ea \u05d7\u05d3-\u05de\u05e9\u05de\u05e2\u05d9\u05ea \u05e2\u05dc \u05d0\u05d5\u05ea\u05d5 \u05de\u05e0\u05d5\u05e2 \u05d0\u05d9\u05dc\u05d5\u05e6\u05d9\u05dd; \u05dc\u05d0 \u05de\u05e1\u05dc\u05d5\u05dc\u05d9\u05dd \u05e0\u05e4\u05e8\u05d3\u05d9\u05dd). */
const IMAGE_PLACEMENT = Object.freeze({
  INLINE: 'inline',        // \u05d1\u05ea\u05d5\u05da \u05e9\u05d5\u05e8\u05d4 \u2014 \u05e4\u05e8\u05d9\u05d8 \u05d0\u05d8\u05d5\u05de\ \u05d1\u05d6\u05e8\u05d9\u05de\u05ea \u05d4\u05d8\u05e7\u05e1\u05d8
  BLOCK: 'block',          // \u05d1\u05dc\u05d5\u05e7 \u05de\u05e9\u05d5\u05d8\u05e3 \u2014 \u05d8\u05d5\u05e8 \u05de\u05dc\u05d0, \u05e9\u05d5\u05e8\u05d5\u05ea \u05d2\u05d5\u05e3 \u05dc\u05d0\u05d7\u05e8\u05d9\u05d5
  CENTERED: 'centered',    // \u05d1\u05dc\u05d5\u05e7 \u05de\u05de\u05d5\u05e8\u05db\u05d6 \u05d1\u05e8\u05d5\u05d7\u05d1 \u05d4\u05e4\u05e1/\u05d4\u05e2\u05de\u05d5\u05d3
  FLOAT_START: 'float-start', // \u05d6\u05e8\u05d9\u05de\u05ea \u05d8\u05e7\u05e1\u05d8 \u05de\u05e1\u05d1\u05d9\u05d1 \u2014 \u05de\u05d5\u05e6\u05de\u05d3 \u05dc\u05e6\u05d3 \u05d4\u05d4\u05ea\u05d7\u05dc\u05d4 (\u05d1\u05de\u05e1\u05de\u05da RTL: \u05d9\u05de\u05d9\u05df)
  FLOAT_END: 'float-end'      // \u05de\u05d5\u05e6\u05de\u05d3 \u05dc\u05e6\u05d3 \u05d4\u05e1\u05d9\u05d5\u05dd
});

/** סוגי נכסים (assetId namespace). */
const ASSET_KINDS = Object.freeze({
  IMAGE: 'image',
  FONT: 'font',
  ORNAMENT: 'ornament'
});

/** אופני השתתפות בעימוד (constraints.participates — חוזה §2). */
const PARTICIPATION = Object.freeze({
  INLINE: 'inline',
  BLOCK: 'block',
  PAGE_FURNITURE: 'pageFurniture',
  BACKGROUND: 'background'
});

/** מדיניות overflow (אף פעם לא מחיקה שקטה). */
const OVERFLOW_POLICIES = Object.freeze({
  SHRINK: 'shrink',
  MOVE: 'move',
  DIAGNOSE: 'diagnose'
});

/** מדיניות פיצול לאורך עמודים. */
const SPLIT_POLICIES = Object.freeze({
  NEVER: 'never',
  LINE: 'line',       // פיצול בין שורות (פסקה/הערה ארוכה)
  BLOCK: 'block'      // העברה כבלוק שלם
});

const ALL_BLOCK_KINDS = Object.values(BLOCK_KINDS);
const ALL_ITEM_KINDS = Object.values(ITEM_KINDS);

function isBlockKind(kind) { return ALL_BLOCK_KINDS.includes(kind); }
function isItemKind(kind) {
  if (ALL_ITEM_KINDS.includes(kind)) return true;
  return typeof kind === 'string' && kind.startsWith('custom:');
}

module.exports = {
  BLOCK_KINDS, ITEM_KINDS, ASSET_KINDS, PARTICIPATION, OVERFLOW_POLICIES, SPLIT_POLICIES,
  ALL_BLOCK_KINDS, ALL_ITEM_KINDS, isBlockKind, isItemKind, IMAGE_PLACEMENT };
