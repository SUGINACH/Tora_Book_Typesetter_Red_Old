// src/engine/layout/side-notes.js — H7 side-notes / marginalia full contract (REQ-FN-05/06, S7.1.2)
// **שלב 6 פרוסה 2 (§8 בהוראה): הקצאה אנכית משותפת מהחותמות + trace דטרמיניסטי.**
'use strict';

/**
 * הערות צד (H7) ופריטי עוגן מורחבים (תיבות מידע — דרך registry):
 *  - עיגון לטוקן-אנקור, מיקום **בראש הפסקה המארחת** (לא בראש העמוד);
 *  - **מקצה אנכי אחד לכל הפריטים בשוליים של העמוד** (§8): כולם משתתפים באותו
 *    חישוב, לפי העוגנים וסדר הקריאה; מפל-דחיפה מונע חפיפה; מרווח מינימלי
 *    STACK_GAP_PX; גבולות העמוד במיכל CONTAINMENT_PX; המשך-עמוד לפי מדיניות
 *    מפורשת (no-room ⇒ דחייה מתועדת; זנב ⇒ עמוד נושא, BRZ-15);
 *  - **הגובה מהחותמת בלבד** (notes-model.stampNote — מדידה אחת, §10): ההקצאה
 *    והמקרינים (DOM ו-PDF) צורכים את אותן שורות/גובה — אין אומדן עצמאי
 *    ואין הזזה לאחר ההחלטה;
 *  - **trace של החלטות מהותיות** (hooks.trace — רשם שלב 5): עוגן, דחיפה,
 *    דחייה, זנב — דטרמיניסטי וקומפקטי.
 */

const { stampNote, stampIsValid, NOTE_KINDS } = require('./notes-model');

const CONTAINMENT_PX = 20; // חריגה מזערית מעבר למיכל — לא נחשב overlap אמיתי (ספרד קטלוג D3)
const STACK_GAP_PX = 8;    // מרווח בין הערות צד סמוכות בשוליים

/** פרופילי רוחב גופן להערות צד (s-note-body-font) — SSOT ב-notes-model (פרוסה 2). */
const SIDE_NOTE_FONT_FACTORS = require('./notes-model').SIDE_NOTE_FONT_FACTORS;

/**
 * אומדן גובה הערת-צד (תאימות לאחור; צרכנים קיימים — בדיקות S69):
 * כעת חותמת מדידה מלאה דרך notes-model ומחזירה את הגובה — **אותן שורות
 * בדיוק שההקצאה והמקרינים יצרכו** (בעבר: אומדן נפרד שיכול היה לסטות
 * מההקרנה בפועל ⇒ SIDE_NOTE_OVERLAP בעמוד 107).
 */
function estimateSideNoteHeight(text, settings, measureFn) {
  const probe = { text };
  stampNote(probe, settings, measureFn || ((t, s) => String(t).length * 0.55 * (s || 12) * (96 / 72)), NOTE_KINDS.SIDE_NOTE);
  return probe.heightPx;
}

/** מיקום Y של שורה בטור: גובה מצטבר מראש התוכן.
 * **S6.0 (R3-M1):** מיושר למודל המרנדרים — מתחיל מתחת לפס החוצה-טורים
 * (spanning) וכולל את מקדם ה-AQ (aqStretch).
 * **FX-6 (פרוסה 2):** כולל גם את פערי הבלוקים (gapBeforePx) — אותה
 * סמנטיקה כמו הקרנת הטור ב-PDF והרינדור ב-DOM (עוגן מדויק). */
function lineYTop(page, colIdx, lineIdx) {
  let y = page.template.contentBox.top
    + (page.spanning && page.spanning.heightPx ? page.spanning.heightPx : 0);
  const col = page.columns[colIdx] || [];
  for (let i = 0; i < lineIdx && i < col.length; i++) {
    y += (col[i].gapBeforePx || 0) + (col[i].heightPx || 0) * (col[i].aqStretch || 1);
  }
  return y;
}

/** מציאת שורת האנקור הראשונה בעמוד → (colIdx, lineIdx) או null. */
function findAnchorLine(page, anchorToken) {
  for (let c = 0; c < page.columns.length; c++) {
    for (let i = 0; i < page.columns[c].length; i++) {
      const ln = page.columns[c][i];
      const tok = ln.tokenId != null ? ln.tokenId : (ln.meta && ln.meta.tokenId);
      if (tok === anchorToken) return { colIdx: c, lineIdx: i };
    }
  }
  return null;
}

/** רוחב העמודה בשוליים עבור פריט — מההקשר של החותמת (או ברירת המחדל). */
function marginColWidth(settings, sn) {
  // תיבת מידע: הרוחב החיצוני המוגדר שלה (stampCtx מכיל את הרוחב הפנימי)
  if (sn && sn.boxSpec && Number(sn.boxSpec.widthPx) > 0) return sn.boxSpec.widthPx;
  return (sn && sn.stampCtx && sn.stampCtx.widthPx) || settings._sideNoteColWidthPx || 60;
}

/**
 * מיקום הערות הצד על עמודי התוצר — **המקצה האנכי המשותף** (§8).
 * @param {Array} pages - עמודי התוצר (עם columns + sideNotes)
 * @param {object} settings
 * @param {(text:string,sizePt:number)=>number} [measureFn] — רק להטבעת-חותמות מגניבה
 *   (פריט שלא נחתם ביצירתו; במסלול המוצר כולם חתומים — המדידה היחידה שלהם)
 * @param {object} [hooks] — {ledger, eventLog, trace} לרישום הזזות/דחיות/trace
 * @returns {{placed:Array, deferred:Array, overflow:Array}}
 */
function placeSideNotes(pages, settings, measureFn, hooks = {}) {
  const ledger = hooks.ledger || null;
  const eventLog = hooks.eventLog || null;
  const trace = hooks.trace || null;
  const placed = [];
  const deferred = [];
  const pending = []; // pagePendingNotes — נשארות מועברות לעמוד הבא
  const overflowEvents = [];

  for (const page of pages) {
    // recto: שוליים חיצוניים בצד שמאל (RTL); verso: בצד ימין
    const outerX = page.isRecto !== false
      ? page.template.margins.side * 0.15
      : page.template.width - page.template.margins.side * 0.15 - marginColWidth(settings, null);
    const queue = [...pending.splice(0), ...(page.sideNotes || [])];
    page.sideNotes = []; // ייבנה מחדש לפי מה שבאמת מוקם בעמוד זה
    let lastBottom = -1;

    for (let i = 0; i < queue.length; i++) {
      const sn = queue[i];
      // **מדידה אחת (§10):** הגובה מהחותמת. פריט לא-חתום (מסלול חריג) מוטבע
      // כאן פעם אחת — ומרגע זה ההקצאה, ה-DOM וה-PDF קוראים את אותה חותמת.
      if (!stampIsValid(sn)) {
        stampNote(sn, settings, measureFn, NOTE_KINDS.SIDE_NOTE, {
          widthPx: sn.boxSpec && sn.boxSpec.widthPx ? sn.boxSpec.widthPx : undefined
        });
      }
      const h = sn.heightPx;
      // **מיקום בראש הפסקה המארחת** (S7.1.2): עוגן לשורה הראשונה של האנקור בעמוד
      const anchor = findAnchorLine(page, sn.anchorToken);
      const anchorY = anchor
        ? lineYTop(page, anchor.colIdx, anchor.lineIdx)
        : page.template.contentBox.top; // אנקור לא בעמוד זה ⇒ ראש תוכן
      let yTop = anchorY;
      // push-down cascade: אין לחפוף את ההערה הקודמת (מרווח מינימלי לפי מדיניות)
      if (lastBottom >= 0 && yTop < lastBottom + STACK_GAP_PX) yTop = lastBottom + STACK_GAP_PX;
      if (trace) trace.emit(page.index, 'side-note-allocated', {
        note: sn.noteId || sn.ownToken || sn.anchorToken,
        anchorY: Math.round(anchorY * 10) / 10,
        yTop: Math.round(yTop * 10) / 10,
        pushedDown: Math.round((yTop - anchorY) * 10) / 10,
        heightPx: h
      });
      // מיכל 20px: אין חריגה מסוף אזור התוכן — אחרת דחייה מפורשת (diagnostic)
      if (yTop + h > page.template.contentBox.bottom + CONTAINMENT_PX) {
        deferred.push({ ...sn, reason: 'no-room', page: page.index });
        pending.push({ ...sn, deferredFrom: page.index });
        if (trace) trace.emit(page.index, 'side-note-deferred', {
          note: sn.noteId || sn.ownToken || sn.anchorToken,
          reason: 'no-room', wouldEndAt: Math.round((yTop + h) * 10) / 10,
          limit: page.template.contentBox.bottom + CONTAINMENT_PX
        });
        continue;
      }
      const rec = {
        ...sn, page: page.index,
        x: outerX, yTop,
        heightPx: h,
        batchGroup: sn.batchId || (anchor ? `${sn.anchorToken}` : `p${page.index}i${i}`),
        colWidth: marginColWidth(settings, sn)
      };
      placed.push(rec);
      page.sideNotes.push(rec); // מה שמוקם בפועל בעמוד זה (נרנדר)
      lastBottom = yTop + h;
    }
  }

  // **BRZ-15 — לא גניזה:** הערות שנותרו בתור אחרי העמוד האחרון — מוסיפים עמוד נוסף
  // שנושא אותן (אירוע מתועד; אינו מזיז עמודי גוף קיימים — הצפה בזנב).
  if (pending.length && pages.length) {
    const last = pages[pages.length - 1];
    const tpl = last.template;
    const tail = {
      index: pages.length ? pages[pages.length - 1].index + 1 : 0,
      type: 'regular', isRecto: pages.length % 2 === 0,
      template: { ...tpl, columns: tpl.columns.map(c => ({ ...c })) },
      columns: tpl.columns.map(() => []),
      footnotes: [], sideNotes: [], headingsOnPage: [], balanceInfo: null,
      fnReservedHeightPx: 0, chapterOpening: false, tailForSideNotes: true
    };
    pages.push(tail);
    let yTop = tail.template.contentBox.top;
    for (const sn of pending.splice(0)) {
      if (!stampIsValid(sn)) stampNote(sn, settings, measureFn, NOTE_KINDS.SIDE_NOTE);
      const h = sn.heightPx;
      if (yTop + h > tail.template.contentBox.bottom + CONTAINMENT_PX) {
        // פתולוגי: הערה גבוהה מעמוד — נרשם כממצא, לא נגנז (מוקם בחריגת מיכל מתועדת)
        overflowEvents.push({ anchor: sn.anchorToken, heightPx: h, reason: 'taller-than-page' });
        if (ledger) {
          const rec = ledger.create('side-note-overflow', `sn@${sn.anchorToken}`, tail.index, { heightPx: h }, 'decorations');
          ledger.transition(rec.issue_id, 'persists', 'decorations', 'note taller than a page — placed with documented containment breach');
        }
      }
      const rec = { ...sn, page: tail.index, x: tail.isRecto !== false ? tail.template.margins.side * 0.15 : tail.template.width - tail.template.margins.side * 0.15 - marginColWidth(settings, sn), yTop, heightPx: h, colWidth: marginColWidth(settings, sn) };
      placed.push(rec);
      tail.sideNotes.push(rec);
      if (trace) trace.emit(tail.index, 'side-note-tail-placed', {
        note: sn.noteId || sn.ownToken || sn.anchorToken, yTop: Math.round(yTop * 10) / 10, heightPx: h
      });
      yTop += h + STACK_GAP_PX;
    }
    if (eventLog) eventLog.emit('decorations', 'side-notes-tail-page', { page: tail.index, count: tail.sideNotes.length }, tail.index);
  }

  return { placed, deferred, overflow: overflowEvents };
}

/**
 * אימות המרת H7 → הערת צד (S7.1.3 + **9b.3 §3.3 — הרחבה מלאה**).
 * בדיקות על בסיס **זהות טוקן** (לא חיפוש טקסט — כפילות טקסט בגוף אינה
 * false-positive), עם הפרדה קפדנית בין ownToken (הטוקן של ההערה עצמה)
 * ל-anchorToken (הפסקה המארחת) — שני מזהים בעלי תפקידים שונים:
 *  1. לכל טוקן H7 — פריט אחד בדיוק (אין חסר, אין כפילות);
 *  2. טקסט הביאור נשמר במלואו (מילה-במילה מול טוקן המקור);
 *  3. anchorToken מצביע לפסקה המארחת הצפויה (הפסקה הבאה במקור);
 *  4. אין פריט חסר-מקור (ללא ownToken של H7/סגנון-צד אמיתי);
 *  5. אין פריט שהוצב בעמוד לפני עוגנו החזותי (firstPageByToken);
 *  6. deferred/pending נסגרו בהצבה או בממצא מפורש.
 * @param {Array} sourceTokens - טוקני המקור
 * @param {Array} pages - עמודי התוצר
 * @param {{placed:Array, deferred:Array}} placement - פלט placeSideNotes
 * @param {object} [ctx] - { hostByH7: Map<ownToken,String>, sourceBlocks: Array }
 *   (אופציונלי — מאפשר אימות anchorToken מול המארחת הצפויה שנקבעה בתכנון)
 */
function verifyH7Conversion(sourceTokens, pages, placement, ctx = {}) {
  const mismatches = [];
  const placed = placement ? placement.placed : [];
  const deferred = placement ? placement.deferred : [];
  const placedByOwn = new Map();
  for (const p of placed) {
    const own = p.ownToken != null ? String(p.ownToken) : null;
    if (own == null) {
      mismatches.push({ kind: 'side-item-without-source', anchor: p.anchorToken, text: String(p.text || '').slice(0, 40) });
      continue;
    }
    if (!placedByOwn.has(own)) placedByOwn.set(own, []);
    placedByOwn.get(own).push(p);
  }
  // (5) עמוד הופעה ראשון של כל טוקן — לבדיקת "לפני העוגן"
  const firstPageByToken = new Map();
  for (const page of pages) {
    const pageLinesList = [...(page.spanning ? page.spanning.lines : []), ...(page.columns || []).flat()];
    for (const ln of pageLinesList) {
      const tok = ln.tokenId != null ? String(ln.tokenId) : (ln.meta && ln.meta.tokenId != null ? String(ln.meta.tokenId) : null);
      if (tok != null && !firstPageByToken.has(tok)) firstPageByToken.set(tok, page.index);
    }
  }
  const sourceH7 = new Map(); // ownToken -> token
  for (const t of sourceTokens) {
    if (t.type === 'heading' && (t.level === 7 || t.mode === 'side-note')) sourceH7.set(String(t.id), t);
  }
  // (1)+(2)+(3): כיסוי, יחידות, טקסט, עוגן
  const normCmp = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  for (const [own, t] of sourceH7) {
    const items = placedByOwn.get(own) || [];
    if (items.length === 0) {
      mismatches.push({ token: t.id, text: t.text, kind: 'h7-conversion-missing' });
      continue;
    }
    if (items.length > 1) {
      mismatches.push({ token: t.id, kind: 'h7-conversion-duplicate', count: items.length });
    }
    for (const it of items) {
      if (normCmp(it.text) !== normCmp(t.text)) {
        mismatches.push({ token: t.id, kind: 'h7-text-not-preserved', expected: normCmp(t.text).slice(0, 40), actual: normCmp(it.text).slice(0, 40) });
      }
      if (ctx.hostByH7 && ctx.hostByH7.has(own)) {
        const expectedHost = String(ctx.hostByH7.get(own));
        if (String(it.anchorToken) !== expectedHost) {
          mismatches.push({ token: t.id, kind: 'h7-anchor-mismatch', expectedHost, actualAnchor: String(it.anchorToken) });
        }
      }
      // (5) הפריט אחרי עוגנו (או באותו עמוד) — לעולם לא לפניו
      const anchorPage = firstPageByToken.get(String(it.anchorToken));
      if (anchorPage != null && it.page < anchorPage) {
        mismatches.push({ token: t.id, kind: 'h7-placed-before-anchor', itemPage: it.page, anchorPage });
      }
    }
  }
  // (4) פריטים חסרי מקור H7 (ownToken שאינו טוקן H7 — יכולים להיות סגנונות-צד
  // לגיטימיים; מדווח רק כשאין מקור כלל ואין isCustomStyle)
  for (const [own, items] of placedByOwn) {
    if (sourceH7.has(own)) continue;
    if (items.some(it => it.isCustomStyle)) continue;
    mismatches.push({ token: own, kind: 'side-item-without-h7-source', count: items.length });
  }
  // (6) דחויים שלא נסגרו בהצבה — זרימה תקינה (עמוד נושא/המשך) רק אם הפריט
  // בסופו של דבר מוקם; מדווח רק מי שהופיע ב-deferred אך לא ב-placed.
  const placedOwns = new Set(placedByOwn.keys());
  for (const d of deferred) {
    const own = d.ownToken != null ? String(d.ownToken) : (d.tokenId != null ? String(d.tokenId) : null);
    if (own != null && !placedOwns.has(own)) {
      mismatches.push({ token: own, kind: 'h7-deferred-never-placed', reason: d.reason, page: d.page });
    }
  }
  void pages;
  return mismatches;
}

module.exports = { placeSideNotes, verifyH7Conversion, estimateSideNoteHeight, CONTAINMENT_PX, STACK_GAP_PX, SIDE_NOTE_FONT_FACTORS };
