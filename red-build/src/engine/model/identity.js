// src/engine/model/identity.js — זהות דטרמיניסטית לפריטים קנוניים (שלב 2)
// **חוזה:** spec/03_UNIFIED_ITEM_CONTRACT.md §2-כללי-זהות · תוכנית §2.1-3.
// כלל הברזל: מזהים נגזרים מהמקור (מיקום + תוכן) בלבד — אין מוני ריצה,
// אין Date.now/Math.random, אין מופעי סדר תלויי-סביבה. אותו קלט ⇒ אותם מזהים,
// בכל ריצה ובכל סביבה (Node/Worker/UI).
'use strict';

const crypto = require('crypto');

/** תחילית מרחבי-שם לזהות — מונעת התנגשות בין סוגי ישויות. */
const NS = Object.freeze({
  DOC: 'doc',
  BLOCK: 'blk',
  ITEM: 'itm',
  NOTE: 'note',
  ANCHOR: 'anc',
  ASSET: 'ast',
  STYLE: 'sty'
});

/** hash קצר ודטרמיניסטי (hex, 52 סיביות) של שרשור שדות מנורמלים. */
function stableHash(namespace, fields) {
  const parts = [namespace];
  for (const f of fields) {
    if (f === null || f === undefined) parts.push('~');
    else if (typeof f === 'number') parts.push(Number.isInteger(f) ? String(f) : String(Math.round(f * 1e6) / 1e6));
    else parts.push(String(f));
  }
  return crypto.createHash('sha256').update(parts.join('\u0001'), 'utf8').digest('hex').slice(0, 13);
}

/**
 * מזהה מסמך — נגזר מבייטי המקור בלבד.
 * @param {string} rawText
 */
function documentId(rawText) {
  return stableHash(NS.DOC, [crypto.createHash('sha256').update(String(rawText), 'utf8').digest('hex')]);
}

/**
 * מזהה בלוק — נגזר מטווח המקור + kind + מיקום יחסי בתוך המסמך.
 * סדר הבלוקים (blockOrdinal) הוא סדר המקור, לא מונה רץ: אותו מסמך
 * מייצר תמיד אותו רצף סדור.
 */
function blockId(docId, kind, blockOrdinal, sourceStart, sourceEnd) {
  return `${NS.BLOCK}-${stableHash(NS.BLOCK, [docId, kind, blockOrdinal, sourceStart, sourceEnd])}`;
}

/**
 * מזהה פריט inline — נגזר מההורה + טווח המקור + סודר בתוך ההורה.
 * ordinal בתוך ההורה נקבע מסדר המקור של הפריטים (דטרמיניסטי).
 */
function itemId(parentId, kind, ordinalInParent, sourceStart, sourceEnd) {
  return `${NS.ITEM}-${stableHash(NS.ITEM, [parentId, kind, ordinalInParent, sourceStart, sourceEnd])}`;
}

/**
 * מזהה גוף הערה — נגזר מהסמן שלו (טווח המקור בגוף) + ההורה של הסמן.
 * הקישור marker↔body הוא מבני: שניהם נושאים את אותו noteRef.
 */
function noteId(parentBlockId, noteOrdinal, sourceStart, sourceEnd) {
  return `${NS.NOTE}-${stableHash(NS.NOTE, [parentBlockId, noteOrdinal, sourceStart, sourceEnd])}`;
}

/** מזהה עוגן. */
function anchorId(docId, anchorName) {
  return `${NS.ANC}-${stableHash(NS.ANC, [docId, String(anchorName)])}`;
}

/** מזהה נכס — נגזר מזהות המקור של הנכס (נתיב/bytes-hash כשיש). */
function assetId(sourceIdentity) {
  return `${NS.ASSET}-${stableHash(NS.ASSET, [String(sourceIdentity)])}`;
}

/** מזהה הצהרת סגנון (styleRef target). */
function styleId(rawStyleId) {
  return `${NS.STY}-${stableHash(NS.STY, [String(rawStyleId)])}`;
}

/**
 * מפתח occurrence למופע של פריט שהתפצל חזותית (המשך בעמוד הבא).
 * כל המופעים מפנים לאותו id המקורי; ה-occurrence מבדיל אותם בפלט.
 * אינדקס המופע נקבע על ידי שלב העימוד בלבד — כאן רק המבנה.
 */
function occurrenceKey(id, occurrenceIndex) {
  return `${id}#${occurrenceIndex}`;
}

module.exports = {
  NS, stableHash, documentId, blockId, itemId, noteId, anchorId, assetId, styleId, occurrenceKey
};
