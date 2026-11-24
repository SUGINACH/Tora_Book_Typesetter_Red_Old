// src/ui/caret-map.js — מיפוי דו־כיווני סמן↔עמוד (REQ-UI-05: "סנכרון סמן↔עמוד")
'use strict';

/**
 * מבוסס על חוזה הטוקנים של המנוע: כל שורת־גוף לא־ריקה ⇒ טוקן אחד בדיוק
 * (block-tokenizer); שורות העמודים נושאות tokenId. המפה מחברת:
 *   מיקום תו במקור ← שורת גוף ← טוקן ← העמוד שמכיל את שורותיו,
 * ובכיוון ההפוך: עמוד ← הטוקן הראשון בסדר הקריאה ← שורת מקור ← מיקום תו.
 *
 * פתיח המסמך (metadata) אינו טוקנים — מוצא מעבר לפתיח לפי אותו כלל
 * של dfa-lexer (שורה ריקה/כותרת/הערת־סיום סוגרות את הפתיח).
 */

const { lexDocument, HEADING_RE, ENDNOTE_PREFIX } = require('../engine/parser/dfa-lexer');

/** קווי המקור: מיקומי התחלה של כל שורה. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** **9c.3:** מזהה הטוקן של שורה — לשני המקורות: עמודי PageModel (sourceTokenId)
 * או עמודי תוצאה מורשת (tokenId/meta.tokenId). המקרין אינו קובע מקור —
 * הקריאה מעבירה את מערך העמודים הקנוני לפי הפרופיל. */
function lineTokenId(ln) {
  if (ln == null) return null;
  if (ln.sourceTokenId != null) return ln.sourceTokenId;
  if (ln.tokenId != null) return ln.tokenId;
  return ln.meta && ln.meta.tokenId != null ? ln.meta.tokenId : null;
}

/** **9c.3:** שורות העמוד הנושאות טוקנים — מודל: lines[] (כולל שורות spanning
 * שנכנסו ל-lines); מורשת: spanning.lines + columns[].flat(). */
function tokenLinesOfPage(pg) {
  if (!pg) return [];
  if (Array.isArray(pg.lines)) return pg.lines; // PageModel
  return [...((pg.spanning && pg.spanning.lines) || []), ...(pg.columns || []).flat()]; // מורשת
}

function buildCaretMap(rawText, tokensOrResult, pagesArg) {
  const { bodyLines } = lexDocument(rawText);
  // **9c.3:** שני אופני קריאה: (a) buildCaretMap(text, tokens, pages) —
  // העמודים הם המערך הקנוני שהועבר (מודל או מורשת); (b) buildCaretMap(text,
  // result) — תאימות לאחור (עמודי תוצאה). הטוקנים הם מידע זהות מקור
  // (DocumentModel) — לא גיאומטריה.
  const tokens = Array.isArray(tokensOrResult) ? tokensOrResult : tokensOrResult.tokens;
  const pages = Array.isArray(tokensOrResult) ? (pagesArg || []) : tokensOrResult.pages;

  // tokenId → אינדקס עמוד ראשון שמכיל אותו (כולל פס חוצה־טורים — FWD-1).
  // **9c.3:** המקור לפי הפרופיל — עמודי המודל (sourceTokenId) או עמודי התוצאה.
  const pageByToken = new Map();
  const tokensByPage = new Map();
  for (const pg of pages) {
    const lines = tokenLinesOfPage(pg);
    const set = new Set();
    for (const ln of lines) {
      const tok = lineTokenId(ln);
      if (tok == null) continue;
      set.add(tok);
      if (!pageByToken.has(tok)) pageByToken.set(tok, pg.index);
    }
    tokensByPage.set(pg.index, [...set]);
  }

  // שורת־גוף לא־ריקה ↔ אינדקס טוקן מצטבר (כלל block-tokenizer: trim + לא ריק ⇒ טוקן)
  let nonEmpty = 0;
  const tokenAtBodyLine = new Array(bodyLines.length).fill(-1); // bodyLineIdx → tokenIdx (הטוקן של השורה עצמה)
  const lastTokenThrough = new Array(bodyLines.length).fill(-1); // bodyLineIdx → טוקן אחרון שנוצר עד וכולל שורה זו
  for (let i = 0; i < bodyLines.length; i++) {
    if (bodyLines[i].trim() !== '') { tokenAtBodyLine[i] = nonEmpty; nonEmpty++; }
    lastTokenThrough[i] = nonEmpty - 1;
  }

  const starts = lineStarts(rawText);
  const bodyStartLine = starts.length - bodyLines.length; // שורות הגוף הן סיומת השורות (הפתיח נזנח)

  /** מיקום תו ← אינדקס שורת־מקור */
  function lineOfChar(charIndex) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= charIndex) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** טוקן ← עמוד; טוקן שלא הוצב (editorial) ← העמוד של הטוקן הקודם שהוצב */
  function pageOfTokenIdx(ti) {
    for (let k = ti; k >= 0; k--) {
      const p = pageByToken.get(tokens[k].id);
      if (p != null) return p;
    }
    return pages.length ? pages[0].index : null;
  }

  /** מיקום תו במקור ← אינדקס עמוד (כיוון א׳ של הסנכרון) */
  function caretToPage(charIndex) {
    if (!pages.length) return null;
    const line = lineOfChar(Math.max(0, Math.min(charIndex, rawText.length)));
    const bodyLine = line - bodyStartLine;
    if (bodyLine < 0) return pages[0].index; // פתיח המסמך — העמוד הראשון
    const ti = lastTokenThrough[Math.min(bodyLine, bodyLines.length - 1)];
    if (ti < 0) return pages[0].index;
    return pageOfTokenIdx(ti);
  }

  /** אינדקס עמוד ← מיקום תו במקור (תחילת שורת המקור של הטוקן הראשון; כיוון ב׳) */
  function pageToCaret(pageIndex) {
    const toks = tokensByPage.get(pageIndex);
    if (!toks || !toks.length) return null;
    const tokenId = toks[0];
    const ti = tokens.findIndex(t => t.id === tokenId);
    if (ti < 0) return null;
    // אינדקס שורת־גוף: מספר הטוקנים שנוצרו עד טוקן זה = מספר שורות לא־ריקות עד אליו
    let bodyLine = -1, count = 0;
    for (let i = 0; i < bodyLines.length; i++) {
      if (bodyLines[i].trim() !== '') {
        if (count === ti) { bodyLine = i; break; }
        count++;
      }
    }
    if (bodyLine < 0) return null;
    const rawLine = bodyStartLine + bodyLine;
    return starts[Math.min(rawLine, starts.length - 1)];
  }

  return { caretToPage, pageToCaret, pageByToken, tokensByPage, pageCount: pages.length };
}

module.exports = { buildCaretMap };
