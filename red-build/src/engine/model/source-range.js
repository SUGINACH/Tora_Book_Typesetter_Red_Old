// src/engine/model/source-range.js — עוגני מקור ומיפוי נרמול הפיך (שלב 2)
// **חוזה:** spec/03_UNIFIED_ITEM_CONTRACT.md §2 (sourceRange) · תוכנית §2.1-4:
// "נרמול תווים, protectors או סימני עזר חייבים להיות reversible או לשמור
// מיפוי מדויק למקור". המודל הקנוני שומר את המקור ואת הנרמול כרשומות
// נקודתיות (offset, original, normalized) — ההיפוך תמיד אפשרי, החשבונאות מלאה.
'use strict';

/**
 * טווח מקור חצי-פתוח [start, end) בתוך המסמך הגולמי (אחרי איחוד CRLF→LF
 * — מיפוי סוף-השורה נשמר ב-lineMap של השלד, ראה document-model).
 */
function sourceRange(docId, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new TypeError(`source-range: invalid [start,end)=(${start},${end})`);
  }
  return Object.freeze({ docId, start, end });
}

/**
 * רשומת נרמול תו בודד (החלפה 1:1 — כל החוקים הקיימים ב-block-tokenizer
 * הם 1:1, ולכן ההיפוך מדויק וללא ערפל מיקום):
 *   ״ (U+05F4) → ׳ (U+05F3)   — גרשיים → גרש (כלל one-way במורשת; כאן הפיך)
 *   ‘ ’ (U+2018/9) → "         — מרכאות לועזיות (הפיך)
 */
const NORMALIZATION_RULES = Object.freeze([
  { original: '\u05F4', normalized: '\u05F3', code: 'gershayim-to-geresh' },
  { original: '\u2018', normalized: '"', code: 'left-quote-to-straight' },
  { original: '\u2019', normalized: '"', code: 'right-quote-to-straight' }
]);

/** בדיקה אם תו מקור יעבור נרמול בטוקניזר. */
function isNormalizedAway(ch) {
  return NORMALIZATION_RULES.some(r => r.original === ch);
}

/**
 * מנרמל טקסט שורה ומחזיר גם את רשומות המיפוי (להיפוך מדויק).
 * זהה חישובית ל-normalizeText של block-tokenizer (אותם החוקים, אותו סדר)
 * — הפונקציה שם ממשיכה להיות מקור האמת להתנהגות; כאן שומרים את המיפוי.
 * @returns {{ text: string, edits: Array<{offset:number, original:string, normalized:string, code:string}> }}
 */
function normalizeWithMap(line, baseOffset) {
  const off = Number.isInteger(baseOffset) ? baseOffset : 0;
  let text = '';
  const edits = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const rule = NORMALIZATION_RULES.find(r => r.original === ch);
    if (rule) {
      text += rule.normalized;
      edits.push({ offset: off + i, original: ch, normalized: rule.normalized, code: rule.code });
    } else {
      text += ch;
    }
  }
  return { text, edits };
}

/** היפוך מדויק של רשומות הנרמול על טקסט מנורמל (round-trip). */
function applyInverseMap(normalizedText, edits, baseOffset) {
  const off = Number.isInteger(baseOffset) ? baseOffset : 0;
  if (!edits || !edits.length) return normalizedText;
  let out = normalizedText;
  // רשומות מסודרות בהיסט עולה; מהסוף כדי שהיסטים לא יזוזו.
  const sorted = [...edits].sort((a, b) => (a.offset - off) - (b.offset - off));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    const at = e.offset - off;
    if (at < 0 || at >= out.length) continue;
    if (out[at] === e.normalized) out = out.slice(0, at) + e.original + out.slice(at + 1);
  }
  return out;
}

module.exports = { sourceRange, NORMALIZATION_RULES, isNormalizedAway, normalizeWithMap, applyInverseMap };
