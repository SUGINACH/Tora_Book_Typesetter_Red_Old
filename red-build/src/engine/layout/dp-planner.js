// src/engine/layout/dp-planner.js — Multi-column/page DP planner (REQ-BAL-01/02/04/08/10)
'use strict';

const crypto = require('crypto');
const { PAGE_TYPES, buildPageTemplate } = require('./page-templates');
const { Ledger } = require('../core/ledger');
const { runProtections } = require('./protections-matrix');
const { runRetreatLoop } = require('./retreat-loop');
const { generateCandidates } = require('./candidate-generator');
const { blockGapPx, colCapacityOf } = require('./column-flow');
const { fixDropWordInColumns } = require('../typography/protectors');
const { MARK_TAG } = require('../notes/markers');
const { moveLineForward } = require('./ordering');
const { optimalSplit } = require('./balancing'); // **EXT-8:** חלוקה גלובלית אופטימלית
const { getFootnotesReservedHeight, noteHeight } = require('./footnote-budget');
const CM = require('./constraint-matrix'); // **דוח 06 (2026-11-15):** מקור האמת המספרי לאילוצי מדיניות

/** חתימת פריסה דטרמיניסטית — ללא Date/random (REQ-GOV determinism).
 * תיקון S7-E2E: tokenId נמצא ב‑meta של pushLines (לא על השורה עצמה) — יש לחלץ משם,
 * אחרת hash/TOC מאבדים את מזהה הטוקן (באג V23: headingsForToc ריק). */
function lineTokenId(ln) {
  if (ln.tokenId != null) return ln.tokenId;
  if (ln.meta && ln.meta.tokenId != null) return ln.meta.tokenId;
  return '';
}

/**
 * **תיקון S8 (טור פנטום):** יישור מערך הטורים לאורך התבנית אחרי המרת סוג עמוד.
 * שומר על תוכן קיים בעמודות שנותרו; תורם עודפים (בלי תבנית) מוחזרים —
 * לא אמור לקרות (ההמרה מתבצעת בעמוד ריק/חדש), ואם קרה — נסיגה בטוחה.
 */
function reAlignColumns(page) {
  const n = page.template.columns.length;
  const old = page.columns || [];
  const next = Array.from({ length: n }, (_, i) => (old[i] ? old[i].slice() : []));
  let orphaned = 0;
  for (let i = n; i < old.length; i++) orphaned += old[i].length;
  if (orphaned > 0 && old[n - 1]) {
    // שורות בטור פנטום — מוחזרות לטור האחרון החוקי (BRZ-15: אין גניזה)
    next[n - 1].push(...old.slice(n).flat());
  }
  page.columns = next;
  return orphaned;
}

function layoutHash(pages) {
  const canon = pages.map(p => ({
    i: p.index, t: p.type,
    c: p.columns.map(col => col.map(ln => `${lineTokenId(ln)}:${(ln.words || []).join('\u00A7')}`)),
    // **S4.10:** דפנסיביות — עמודי מנוע המורשת אינם מחויבים לכל השדות
    // (לפני כן p.sideNotes.length קרס על undefined). לעמודי DP אין שינוי ערך.
    fn: (p.footnotes || []).length, sn: (p.sideNotes || []).length
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canon), 'utf8').digest('hex');
}

/**
 * **D-47 (תיקון P0-6):** hash של **הגיאומטריה הנמדדת בלבד** (הטורים/השורות) —
 * זהו האינווריאנט T1: פאס העיטורים/ההערות אסור לו לשנות את הפריסה שנמדדה.
 * בעבר ההשוואה CP4==CP5 השוותה משתנה לעצמו — טאוטולוגיה שאינה יכולה להיכשל.
 * כאן: hash נפרד של הטורים בלבד (בלי מרזבים/הערות צד שמשתנים כחוק בשלב ההערות)
 * — נבדק לפני ואחרי פאס העיטורים בpipeline; שינוי אמיתי בשורות ⇒ הבדיקה נכשלת.
 */
function bodyGeometryHash(pages) {
  const canon = pages.map(p => ({
    i: p.index, t: p.type,
    c: p.columns.map(col => col.map(ln => `${lineTokenId(ln)}:${(ln.words || []).join('\u00A7')}:${ln.seq != null ? 's' + ln.seq : ''}`))
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canon), 'utf8').digest('hex');
}

/**
 * **תיקון P0-3 (שבירת סדר קריאה):** איזון חוקי מזיז שורות **קדימה בסדר הקריאה
 * בלבד** — הזזת גבול הטורים קדימה/אחורה תוך שמירת סדר המילים:
 *  - טור מוקדם (col0, נקרא ראשון) גבוה יותר ⇒ pop מסופו → unshift לראש col1 (קדימה).
 *  - טור מאוחר (col1, נקרא שני) גבוה יותר ⇒ shift מראשו → push לסוף col0 (הזזת הגבול
 *    אחורה — שומר סדר: השורה עדיין אחרי כל col0 ולפני שאר col1).
 * בעבר: pop מהטור המאוחר + unshift לראש הטור המוקדם — הציג את סוף פסקה לפני
 * תחילתה (רגרסיה חדשה שלא הייתה באף גרסה קודמת). כל השורות מתויגות seq
 * (סדר הצבה = סדר מסמך) ו‑protections-matrix מפיק reading-order-break אם
 * איזון עתידי יפר זאת — הבאג נעול לצמיתות בבדיקת רגרסיה.
 */

/**
 * Block = יחידת פריסה: heading או paragraph עם שורות שנמדדו.
 * @param {Array} blocks - [{kind:'heading'|'paragraph', lines:[...], notes:[...], token}]
 * @param {object} settings
 * @param {{measure:(t:string,s?:number)=>number}} env - חייב להכיל measure (entry יחיד — L1); אחרת throw (ללא קריסה שקטה)
 */
function planPages(blocks, settings, eventLog, ledger = new Ledger(), env = {}) {
  const measureFn = env && typeof env.measure === 'function' ? env.measure : null;
  if (!measureFn) {
    throw new Error('dp-planner: env.measure is required (single measurement entry — REQ-LB-01). Silent fallback to global is forbidden.');
  }
  // **S10 (REQ-UI-03):** מזליף התקדמות מה‑DP — מכשור בלבד (no-op proof בבדיקה).
  // הערכת מספר העמודים: סכום גבהים נמדדים / קיבולת עמוד רגיל — מעודכנת בזמן אמת.
  const onProgress = env && typeof env.onProgress === 'function' ? env.onProgress : null;
  const estCapacity = (() => {
    const tpl = buildPageTemplate(PAGE_TYPES.REGULAR, settings, true);
    return Math.max(1, tpl.contentBox.height * Math.max(1, tpl.columns.length));
  })();
  const blockHeight = (b) => (b.lines || []).reduce((s, l) => s + (l.heightPx || 0), 0);
  const totalHeight = blocks.reduce((s, b) => s + blockHeight(b), 0);
  const estimatedPages = Math.max(1, Math.ceil(totalHeight / estCapacity));
  const pages = [];
  let pageIdx = 0;
  let seqCounter = 0; // סדר הצבה — סדר קריאה (תיקון P0-3)
  const lineH = Math.round(settings['body-font-size-pt'] * (96 / 72) * settings['body-line-height']);
  const imbMax = settings['imbalance-max-delta-px'];

  // **FX-1 (דוח 06, פרק 4):** נעילת ליווי — הטור שאומת למחסנית כותרת+ליווי הוא
  // startCol של ההצבה עד השלמת שורות הליווי; נאפס בכל עמוד חדש.
  let escortLockCol = 0;
  let escortLinesNeeded = 0;

  function newPage(type = PAGE_TYPES.REGULAR) {
    escortLockCol = 0;
    escortLinesNeeded = 0;
    const isRecto = pages.length % 2 === 0; // עמוד 1 = recto
    const tpl = buildPageTemplate(type, settings, isRecto);
    return { index: pageIdx++, type, template: tpl, columns: Array.from({ length: tpl.columns.length }, () => []), footnotes: [], sideNotes: [], headingsOnPage: [], balanceInfo: null, fnReservedHeightPx: 0, chapterOpening: false };
  }

  let cur = newPage(PAGE_TYPES.REGULAR);

  // **FWD-1 (S8):** פס כותרת חוצה־טורים (spanning band) — כותרת שנמדדה ברוחב
  // מלא מוצבת בפס עליון חוצה־טורים במקום בטור חצי־רוחב (בעבר: נמדדה ברוחב מלא
  // והוצבה בטור רגיל ⇒ גלישה אופקית שקטה). הטורים מתחילים מתחת לפס.
  const spanH = (page) => (page && page.spanning ? page.spanning.heightPx : 0);
  // **S5.2 (P-2 — קיבולת מאוחדת):** כל חישובי הקיבולת עוברים דרך colCapacityOf
  // (column-flow — מקור יחיד). כאן usedHeight כבר כולל את תקציב ההערות על
  // הטור האחרון (F-17) — ולכן הקיבולת נלקחת בלי התקציב (fnBudget:false;
  // שקול מתמטית: used+fn ≤ cap ⟺ used ≤ cap−fn). הפס החוצה־טורים נכלל תמיד.
  const colCapacity = (tpl, page) => colCapacityOf(page, { fnBudget: false }) || (tpl && tpl.contentBox ? tpl.contentBox.height - spanH(page) : 0);

  /**
   * גובה תפוס = שורות + **יתרת תקציב ההערות של העמוד** — כך ה‑probe וה‑reservation
   * זהים (F-17). התקציב נרשם פעם אחת בסוף הטור האחרון.
   * תיקון P1-8: חתימה (col, page) — page חובה; אין עוד עמוד ברירת־מחדל שגוי.
   */
  function usedHeight(col, page = cur) {
    let h = col.reduce((s, ln) => s + (ln.heightPx || 0), 0);
    if (page && page.fnReservedHeightPx > 0 && page.columns[page.columns.length - 1] === col) {
      h += page.fnReservedHeightPx; // נשמר פעם אחת — בסוף הטור האחרון
    }
    return h;
  }

  /**
   * **איחוד P1-1 (מנגנום תאום):** recomputeFnBudget ממשיך כעת דרך
   * footnote-budget.getFootnotesReservedHeight — מקור יחיד. בעבר היו שני מימושים
   * מקבילים; בדיקת probe==reserved רצה על מודול שהמנוע לא השתמש בו.
   */
  function recomputeFnBudget(page) {
    if (!settings['footnotes-enabled'] || !page.footnotes.length) { page.fnReservedHeightPx = 0; return 0; }
    const reserved = getFootnotesReservedHeight(page.footnotes, settings, measureFn) // **S70:** העברת הפונקציה עצמה שומרת על סימון ה-impl (להתאמת פקטורים);
    page.fnReservedHeightPx = reserved;
    return reserved;
  }

  /**
   * **FX-5/FX-1 (דוח 06, פרק 4):** בדיקת קיבולת ב-yPx אמיתיים. הגרסה ההיסטורית
   * (`ensureRoom(neededLines)`) מדדה `neededLines × lineH` בעוד ההצבה צורכת
   * heightPx — פער היחידות יצר עמודים ריקים פנטום (בלוק שנכנס פיזית
   * "נכשל" בבדיקה) ובדיקות ליווי שקרסו על כותרות גבוהות מ-lineH.
   * המחסנית כוללת את פער הכניסה של הבלוק (CM.stackHeightPx).
   */
  function ensureRoomFor(stackPx, fromCol = 0) {
    const cap = colCapacity(cur.template, cur);
    for (let c = fromCol; c < cur.columns.length; c++) {
      if (cap - usedHeight(cur.columns[c], cur) >= stackPx - CM.CAPACITY_EPS) return c;
    }
    return -1;
  }

  function flushPage() {
    // איזון טורים: Δ≤5px (BRZ-3) — **EXT-8: החלוקה הגלובלית האופטימלית**
    // (פיצול רציף ממזער |lH−rH| בכפוף לקיבולת; סדר קריאה נשמר מבנית — תיקון P0-3
    // מובנה בהגדרת מרחב המצבים; הוכחת מינימליות ב-balancing.optimalSplit)
    if (cur.columns.length === 2) {
      const a0 = usedHeight(cur.columns[0], cur), b0 = usedHeight(cur.columns[1], cur);
      if (Math.abs(a0 - b0) > imbMax) {
        const cap = colCapacity(cur.template, cur);
        const best = optimalSplit(cur.columns, { cap, extraLast: cur.fnReservedHeightPx || 0 });
        if (best && best.k !== cur.columns[0].length) {
          const seq = [...cur.columns[0], ...cur.columns[1]];
          cur.columns[0] = seq.slice(0, best.k);
          cur.columns[1] = seq.slice(best.k);
        }
      }
      // מילה נופלת בין טורים (פורטר מ‑Gold) — גם שומר סדר (המילה חוצה את הגבול קדימה)
      // **S5.2 (תיקון 2):** המיזוג מותר רק אם השורה המקבלת נכנסת ברוחב הטור
      // (מדידה מחדש + FIT_EPS שמרני) — אותה מדידה של המתכנן; מילה שאינה
      // נכנסת נשארת בטור המקורי (בלי גלישה אופקית שקטה — מחלקת D-92).
      if (fixDropWordInColumns(cur.columns, 3, { measure: (t) => measureFn(t), colW: cur.template.columns[0].w })) {
        eventLog.emit('balance', 'fix-drop-word', { page: cur.index }, cur.index);
      }
      const a = usedHeight(cur.columns[0], cur), b = usedHeight(cur.columns[1], cur);
      cur.balanceInfo = { before: [a0, b0], after: [a, b] };
      eventLog.emit('balance', 'column-balance', { page: cur.index, delta: Math.abs(a - b) }, cur.index);
    }
    // Invariant BRZ-14: scrollHeight ≤ clientHeight (בכפוף לפס החוצה־טורים — FWD-1)
    for (const col of cur.columns) {
      if (usedHeight(col, cur) > colCapacity(cur.template, cur) + 0.5) {
        const rec = ledger.create('containment', `page#${cur.index}`, cur.index, { used: usedHeight(col, cur), cap: colCapacity(cur.template, cur) }, 'page-plan');
        ledger.transition(rec.issue_id, cur.type === PAGE_TYPES.FILLER ? 'not-comparable' : 'persists', 'page-plan', 'overflow after placement');
      }
    }
    pages.push(cur);
  }

  function pushLines(lines, meta = {}, opts = {}) {
    // grid-block-gap-pct: מרווח בין־בלוקי נצרך כאן — שורה ראשונה של בלוק חדש
    // סופגת את ה‑gap (פרופורציונלי לגובה שורה), כך שתקציב הטור כולל אותו.
    // **FX-1 (דוח 06):** startCol — הצבה מכוונת-ליווי: הטור שאומת למחסנית
    // כותרת+ליווי הוא נקודת הפתיחה. סדר הקריאה נשמר מבנית — אין הצבה
    // לטור מוקדם יותר מנקודת הפתיחה.
    const startCol = Math.max(0, Math.min(opts.startCol != null ? opts.startCol : escortLockCol, cur.columns.length - 1));
    const gap = meta.firstOfBlock ? blockGapPx(settings, lineH) : 0;
    let pendingGap = gap;
    for (const ln of lines) {
      let placed = false;
      for (let c = startCol; c < cur.columns.length && !placed; c++) {
        const needPx = ln.heightPx + pendingGap - 0.5;
        if (colCapacity(cur.template, cur) - usedHeight(cur.columns[c], cur) >= needPx) {
          cur.columns[c].push({ ...ln, meta, seq: seqCounter++ });
          pendingGap = 0;
          placed = true;
          // נעילת ליווי: שורות גוף ראשונות אחרי הכותרת מקריעות את המונה;
          // בהשלמת שורות הליווי — שחרור הנעילה (ההצבה חוזרת לזרימה חופשית).
          if (escortLinesNeeded > 0 && ln.kind !== 'heading') {
            escortLinesNeeded--;
            if (escortLinesNeeded === 0) escortLockCol = 0;
          }
        }
      }
      if (!placed) {
        flushPage();
        cur = newPage(meta.forceType || PAGE_TYPES.REGULAR);
        cur.columns[0].push({ ...ln, meta, seq: seqCounter++ }); // טור חדש/עמוד חדש → ללא gap
        pendingGap = 0;
      }
    }
  }

  /**
   * **תקציב הערות לפני מיקום (F-17 probe==reserved) — כולל מדיניות הערה ארוכה
   * (REQ-FN-02) בזמן ההצבה**, כך שהתקציב תמיד עדכני (ללא תיקון פוסט‑הוק):
   *  - split: החלק הראשון נכנס למרזב העמוד; השאר נכנס לתור pendingBarNotes
   *    ונדחף לראש המרזב של העמוד הבא עם סימון המשך (isContinuation).
   *  - move-whole: ההערה כולה עוברת לעמוד הבא.
   *  - reject-to-body: ההערה חוזרת לגוף כplaceholder `[סמן: טקסט]` + רישום ledger.
   * fn-layout-mode (D-34): block ⇒ תקרת fn-bar-max-height-px נאכפת; continuous ⇒
   * אין תקרה (ההערות זורמות) — מנגנון אמיתי, לא מחלקת CSS בלבד.
   */
  const pendingBarNotes = [];
  function reserveNotes(blk) {
    const notes = (blk.notes || []);
    if (!notes.length) return null;
    // **FX-3 (דוח 06, פרק 4):** תמונת-מצב לשחזור דטרמיניסטי — ההתחייבות
    // חייבת להיות הפיכה כל עוד הפסקה עודנה בהכרעת מיקום. snap.clean=false
    // אחרי פעולות בעלות תופעות לוואי (פיצול/העברה/החזרה לגוף) — אין שחזור
    // אחריהן (המשכים שנוצרו, מצב הבלוק וה-ledger אינם הפיכים בבטחה).
    const snap = { clean: true, footLenBefore: cur.footnotes.length, fnBefore: cur.fnReservedHeightPx || 0, pendingBefore: pendingBarNotes.slice() };
    // המשכים מהעמוד הקודם קודם כל (שמירת סדר ההערות)
    const queue = [...pendingBarNotes.splice(0), ...notes];
    const barMax = settings['fn-layout-mode'] === 'continuous'
      ? Number.POSITIVE_INFINITY
      : (settings['fn-bar-max-height-px'] || Number.POSITIVE_INFINITY);
    for (const n of queue) {
      if (!settings['footnotes-enabled']) {
        // אין מרזב — ההערה חוזרת לגוף כplaceholder; לרזב לא אמורות להגיע הערות
        // כלל במצבים אלה (הpipeline לא שם אותן ב‑blk.notes). שומר בטוח: continue.
        continue;
      }
      // **S71.1 (R7-M4 שארית — בדיקה כפולה):** מעבר ישיר של measureFn — עטיפת
      // החץ שהייתה כאן איבדה את סימון ה-impl (measureWithImpl.impl), וב-impl B
      // (ייצוא PDF) הופעל פקטור הגופן שנועד לטבלת impl A בלבד ⇒ תקציב מרזב
      // מנופח והחלטות split/move-whole מוטות בגבול התקרה. כמו recomputeFnBudget.
      const h = noteHeight(n, settings, measureFn);
      const isCont = n.isContinuation === true;
      // הערה ארוכה מתקרת המרזב ⇒ מדיניות (block mode בלבד; continuous אין תקרה — D-34)
      if (Number.isFinite(barMax) && h > barMax && settings['long-footnote-policy'] !== 'allow') {
        if (settings['long-footnote-policy'] === 'split') {
          // **פיצול אמיתי של הטקסט**: החלק הראשון נכנס למרזב הזה, השאר לעמוד הבא
          const fnSize = settings['body-font-size-pt'] * 0.8;
          const fnLH = Math.round(fnSize * (96 / 72) * 1.25);
          const laneW = settings._fnColWidthPx || 200;
          const words = String(n.text).replace(/\uE000/g, ' ').split(/\s+/).filter(Boolean);
          const linesFit = Math.max(1, Math.floor(barMax / fnLH));
          let w = 0, linesUsed = 1, cutIdx = words.length;
          for (let i = 0; i < words.length; i++) {
            const ww = measureFn(words[i], fnSize);
            if (w + ww > laneW && w > 0) { linesUsed++; w = ww; if (linesUsed > linesFit) { cutIdx = i; break; } } else w += ww;
          }
          if (cutIdx >= words.length) {
            // כל ההערה נכנסת בגבול התקרה — אין צורך בפיצול
            cur.footnotes.push({ ...n, heightPx: h, mode: isCont ? 'split-rest' : 'normal', isContinuation: isCont });
            continue;
          }
          const firstText = words.slice(0, cutIdx).join(' ');
          const restText = words.slice(cutIdx).join(' ');
          cur.footnotes.push({ ...n, text: firstText, heightPx: linesFit * fnLH, lineH: fnLH, mode: 'split-first', linesShown: linesFit });
          pendingBarNotes.push({ ...n, text: restText, isContinuation: true, continuationOf: n.tokenId, mode: 'split-rest' });
          snap.clean = false; // נוצר המשך חדש — אין שחזור בטוח
          eventLog.emit('notes-budget', 'fn-split', { token: n.tokenId, marker: n.marker, barMax, firstWords: cutIdx }, cur.index);
          continue;
        }
        if (settings['long-footnote-policy'] === 'move-whole') {
          pendingBarNotes.push({ ...n, mode: 'moved-whole', deferredToNextPage: true });
          snap.clean = false; // הועברה לעמוד הבא — אין שחזור בטוח
          eventLog.emit('notes-budget', 'fn-moved-whole', { token: n.tokenId, marker: n.marker }, cur.index);
          continue;
        }
        if (settings['long-footnote-policy'] === 'reject-to-body' && rejectToBody(n, `bar overflow ${h}>${barMax}`)) {
          snap.clean = false; // מוטציית בלוק+lines — אין שחזור בטוח
          continue;
        }
      }
      cur.footnotes.push({ ...n, heightPx: h, lineH: Math.round((settings['body-font-size-pt'] * 0.8) * (96 / 72) * 1.25), isContinuation: isCont, mode: isCont ? 'split-rest' : 'normal' });
    }
    recomputeFnBudget(cur); // probe==reserved — פונקציה אחת (unified) לשני הצרכים
    return snap;
  }

  /**
   * **FX-3 (דוח 06):** שחזור דטרמיניסטי של התחייבות הערות — רק מנתיב snap.clean
   * (המשכים קודמים מוחזרים לתור; פעולות עם תופעות לוואי אינן הפיכות).
   */
  function uncommitNotes(page, snap) {
    page.footnotes.length = snap.footLenBefore;
    page.fnReservedHeightPx = snap.fnBefore;
    pendingBarNotes.length = 0;
    for (const p of snap.pendingBefore) pendingBarNotes.push(p);
  }

  /** **FX-3 (דוח 06, פרק 4):** אינדקס שורת הסמן הראשונה של הבלוק (-1 אם אין). */
  function firstMarkerLineOf(blk) {
    return (blk.lines || []).findIndex(ln => (ln.words || []).some(w => String(w).includes(MARK_TAG)));
  }

  /**
   * **FX-3 (דוח 06):** התחייבות הערות בעמוד שבו שורת הסמן עומדת להיות מוצבת,
   * עם נסיגה דטרמיניסטית חד-פעמית אם התקציב חסם את שורת הסמן. F-17 נשמר
   * לעמוד ההערה: התקציב נסגר בטרם שורת הסמן ושארית שורות הבלוק.
   * @param {object} blk — הפסקה
   * @param {object|null} markerLine — שורת הסמן (null ⇒ שורה ראשונה של הבלוק)
   */
  function reserveAtMarker(blk, markerLine) {
    const snap = reserveNotes(blk);
    if (!snap) return;
    const isFirst = !markerLine;
    const stack = CM.stackHeightPx([markerLine || blk.lines[0]], isFirst ? blockGapPx(settings, lineH) : 0);
    if (snap.clean && ensureRoomFor(stack) === -1) {
      uncommitNotes(cur, snap);
      flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
      reserveNotes(blk);
      if (ensureRoomFor(stack) === -1) {
        // מצב פתולוגי (הערה בגודל עמוד): מתועד, לא שקט
        ledger.create('fn-degenerate', blk.tokenId, cur.index, { reservedPx: cur.fnReservedHeightPx }, 'notes-budget');
      }
    }
  }

  /**
   * **תיקון P0-3 משלים — reject-to-body נשאר מסלול BRZ-15 לגיטימי** (השבה מלאה
   * לגוף; לעולם אין גניזת מילים). פועל בזמן הצבה בלבד (בתוך reserveNotes).
   */
  function rejectToBody(n, reason) {
    const blk = blocks.find(b => b.tokenId === n.tokenId && (b.notes || []).some(x => x.noteIndex === n.noteIndex));
    if (!blk) return false;
    // **D-53:** הסמן בשורות הוא יחידה מתויגת (`עוגן\u00A0\uE102סמן`). ההחלפה:
    // מורידים את התג ומדביקים את טקסט ההערה אחרי הסמן במפריד E000 —
    // `עוגן\u00A0סמן\uE000טקסט` — צורה אחידה עם inline (D-30), נספרת פעם אחת.
    const tagged = (l) => l.words && l.words.some(w => String(w).includes(MARK_TAG));
    const idx = (blk.lines || []).findIndex(tagged);
    if (idx >= 0) {
      blk.lines[idx].words = blk.lines[idx].words.map(w => {
        const sw = String(w);
        if (!sw.includes(MARK_TAG)) return w;
        const textE = String(n.text).replace(/\uE000/g, ' ').replace(/ /g, '\uE000');
        return sw.replace(MARK_TAG, '') + '\uE000' + textE;
      });
    } else {
      const textE = String(n.text).replace(/\uE000/g, ' ').replace(/ /g, '\uE000');
      blk.lines.push({ words: [`${n.marker}\uE000${textE}`], heightPx: lineH, isLast: false, tokenId: blk.tokenId, kind: 'paragraph', part: 'rest' });
    }
    const ni = (blk.notes || []).findIndex(x => x.noteIndex === n.noteIndex);
    if (ni >= 0) blk.notes.splice(ni, 1); // מקור־אמת יחיד: לא לספור פעמיים
    blk.rejectedNotes = blk.rejectedNotes || [];
    blk.rejectedNotes.push({ tokenId: n.tokenId, noteIndex: n.noteIndex, text: n.text, marker: n.marker, rejected: true, reason });
    ledger.create('fn-out-of-order', `rejected@p${cur.index}`, cur.index, { marker: n.marker, reason }, 'notes-budget');
    eventLog.emit('notes-budget', 'footnote-rejected-to-body', { token: n.tokenId, marker: n.marker, reason }, cur.index);
    return true;
  }


  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    const next = blocks[bi + 1];

    // **S10 (REQ-UI-03):** התקדמות שלב הפריסה — "עומד עמוד X מתוך כ־Y" (Y מוערך;
    // מעודכן לספירה הסופית בסיום ה‑DP). בדידות 32 בלוקים — אפס השפעה על הפריסה.
    if (onProgress && (bi & 31) === 0) {
      const est = Math.max(estimatedPages, cur.index + 1);
      onProgress({
        stage: 'page-plan',
        pct: 25 + Math.round(45 * (bi / Math.max(1, blocks.length))),
        label: `עומד עמוד ${cur.index + 1} מתוך כ־${est}`,
        pageIndex: cur.index + 1,
        estimatedTotal: est
      });
    }

    // REQ-HDG-02 (החלטה מאוחדת — headings-escort.applyHeadingModes, D-09):
    // הדגלים נקבעים בpipeline לפני ה‑DP; כאן רק צריכה.
    if (blk.kind === 'heading' && blk.forcePageBreakBefore && cur.columns.some(c => c.length)) {
      flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
      eventLog.emit('page-plan', 'heading-new-page-mode', { token: blk.tokenId }, cur.index);
    }
    // פתיחת חלק (H1) / פתיחת ספר (H0 — PT-04 טור רחיד): עמוד חדש + סימון chapterOpening (D-36)
    // **תיקון S8 (באג חבוי):** המרת סוג עמוד חייבת ליישר גם את מערך הטורים לתבנית
    // החדשה — בעבר נשאר מערך שני־טורי מעל תבנית חד־טורית ⇒ טור פנטום בלי תבנית.
    if (blk.kind === 'heading' && (blk.level === 1 || blk.level === 0)) {
      if (cur.columns.some(c => c.length)) { flushPage(); cur = newPage(PAGE_TYPES.REGULAR); }
      cur.chapterOpening = true;
      cur.type = PAGE_TYPES.PREFACE;
      cur.template = buildPageTemplate(PAGE_TYPES.PREFACE, settings, cur.isRecto !== false);
      reAlignColumns(cur);
      eventLog.emit('page-plan', 'part-opening', { token: blk.tokenId, level: blk.level }, cur.index);
    }

    // REQ-FN-05/06: heading mode=side-note → הערת שוליים בטור מקביל (H7 doctrine)
    if (blk.kind === 'heading' && blk.asSideNote) {
      // S7.1.2: הערת צד נצמדת לפסקה שהיא מבארת — הבלוק הבא (host) הוא העוגן החזותי;
      // ההצבה מחפשת את שורת ה‑host וממקמת את ההערה בראשה (לא ראש עמוד עיוור).
      const host = blocks.slice(bi + 1).find(b => b.kind === 'paragraph');
      cur.sideNotes.push({
        text: blk.lines.map(l => l.words.join(' ')).join(' ').trim(),
        anchorToken: host ? host.tokenId : blk.tokenId,
        ownToken: blk.tokenId, isHeading: true, level: blk.level
      });
      eventLog.emit('page-plan', 'heading-side-note', { token: blk.tokenId }, cur.index);
      continue;
    }

    // **S11 (REQ-PAR-06):** דגלי פריסה של סגנונות מותאמים על פסקאות —
    // הדגלים נקבעו בפרה־פאס (pipeline) לפני המדידה; כאן רק צריכה (דפוס D-09).
    if (blk.kind === 'paragraph' && blk.customStyle) {
      const cs = blk.customStyle;
      if (cs.layoutMode === 'new-location' && blk.forcePageBreakBefore && cur.columns.some(c => c.length)) {
        flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
        eventLog.emit('page-plan', 'custom-style-new-location', { style: cs.id, token: blk.tokenId }, cur.index);
      }
      if (cs.layoutMode === 'side-note' && blk.asSideNote) {
        // הפסקה הופכת הערת צד מעוגנת לפסקה הבאה שאחריה (המארחת) — דפוס H7
        // **FX-3:** הערות פנימיות של פסקת צד מחויבות כאן — הענף continue
        // מדלג על ההצבה הרגילה (התנהגות קודמת נשמרת).
        if ((blk.notes || []).length) reserveNotes(blk);
        const host = blocks.slice(bi + 1).find(b => b.kind === 'paragraph' && !(b.customStyle && b.customStyle.layoutMode === 'side-note'));
        cur.sideNotes.push({
          text: blk.lines.map(l => (l.words || []).join(' ')).join(' ').trim(),
          anchorToken: host ? host.tokenId : blk.tokenId,
          ownToken: blk.tokenId, isCustomStyle: cs.id,
          counterMark: cs.counterMark || null
        });
        eventLog.emit('page-plan', 'custom-style-side-note', { style: cs.id, token: blk.tokenId }, cur.index);
        continue;
      }
      if (cs.layoutMode === 'full-width' && blk.fullWidth) {
        // פס חוצה־טורים (callout) — דפוס FWD-1 של H2; פס אחד בראש העמוד.
        // אם כבר יש פס/תוכן בעמוד — עמוד חדש (קריאה פותחת מיקום משלה).
        if (cur.spanning || cur.columns.some(c => c.length)) { flushPage(); cur = newPage(PAGE_TYPES.REGULAR); }
        const bandH = blk.lines.reduce((s, ln) => s + (ln.heightPx || 0), 0);
        cur.spanning = {
          lines: blk.lines.map((ln, i) => ({ ...ln, meta: { tokenId: blk.tokenId, firstOfBlock: i === 0, docPart: blk.part }, seq: seqCounter++ })),
          heightPx: bandH,
          customStyle: cs
        };
        eventLog.emit('page-plan', 'custom-style-band', { style: cs.id, token: blk.tokenId, heightPx: bandH }, cur.index);
        continue;
      }
    }

    // **FX-3 (דוח 06, פרק 4):** התחייבות ההערות הועברה להכרעת המיקום (להלן,
    // אחרי ensureRoomFor/findSplit) — בעבר רצה כאן, לפני שהיה ידוע היכן
    // הפסקה תוצב: פסקה שנדחקה כולה לעמוד הבא הותירה את הערותיה מאחור
    // (סמן בעמוד N+1, טקסט ההערה במרזב עמוד N).

    // **03.11(ד) — span_1col של המקור ל-H3–H6 (mode=full-width):** עד כאן כותרת
    // שנמדדה ברוחב מלא (674px) הוצבה בטור של 270px — שורה ברוחב 471px בטור
    // חצי-רוחב, נגררת בדפדפן לגלישה/חפיפה ("טקסטים אחד על השני" — דיווח משתמש 3).
    // עתה היא מוצבת בפס חוצה־טורים כמו H2 (FWD-1) — בלי עמוד חדש (המקור:
    // כותרת הענף ממשיכה באותו עמוד; עמוד חדש רק אם אין מקום לפס).
    if (blk.kind === 'heading' && blk.level >= 3 && blk.level <= 6 && blk.fullWidth) {
      if (cur.spanning || cur.columns.some(c => c.length)) {
        flushPage();
        cur = newPage(PAGE_TYPES.REGULAR);
      }
      if (!cur.spanning && cur.template.columns.length >= 2) {
        const bandH3 = blk.lines.reduce((s, ln) => s + (ln.heightPx || 0), 0);
        cur.spanning = {
          lines: blk.lines.map((ln, i) => ({ ...ln, meta: { tokenId: blk.tokenId, firstOfBlock: i === 0, docPart: blk.part }, seq: seqCounter++ })),
          heightPx: bandH3,
          titleTopPadPx: 0,
          orn: null
        };
        eventLog.emit('page-plan', 'h3-spanning', { token: blk.tokenId, level: blk.level, heightPx: bandH3 }, cur.index);
        continue; // הכותרת בפס; הבלוקים הבאים ימלאו את הטורים מתחת
      }
    }

    if (blk.kind === 'heading' && blk.level === 2) {
      // PT-05: עמוד חדש תמיד + סימון פתיחת סימן (D-36) + בניית תבנית מלאה
      // (בעבר בענף ה־else הוחלף סוג העמוד בלי בניית תבנית SIGN_OPEN —
      // נשארה תבנית REGULAR ללא h2-top-offset; תוקן ב‑S8 עם FWD-1)
      if (cur.columns.some(c => c.length)) { flushPage(); cur = newPage(PAGE_TYPES.SIGN_OPEN); }
      else if (cur.type !== PAGE_TYPES.SIGN_OPEN) {
        cur.type = PAGE_TYPES.SIGN_OPEN;
        cur.template = buildPageTemplate(PAGE_TYPES.SIGN_OPEN, settings, cur.isRecto !== false);
        reAlignColumns(cur); // יישור טורים לתבנית (תיקון S8 — טור פנטום)
      }
      cur.chapterOpening = true;
      eventLog.emit('page-plan', 'h2-new-page', { token: blk.tokenId }, cur.index);
      // **FWD-1:** H2 שנמדדה ברוחב מלא (mode=full-width, ברירת המחדל) ⇒ פס
      // חוצה־טורים — לא טור חצי־רוחב. הטורים נמדדים מתחת לפס (colCapacity מותאם).
      if (blk.fullWidth && cur.template.columns.length >= 2) {
        const bandH = blk.lines.reduce((s, ln) => s + (ln.heightPx || 0), 0);
        // **S8 (F-08):** הזמנת עיטורי H2 בגודל סופי — בתוך גובה הפס, לפני כל מדידה
        const orn = blk.lines[0] && blk.lines[0].h2Orn;
        const topPad = orn && orn.scope && orn.scope.signTop ? orn.topPx : 0;
        const bottomPad = orn && orn.scope && orn.scope.signBottom ? orn.bottomPx : 0;
        cur.spanning = {
          lines: blk.lines.map((ln, i) => ({ ...ln, meta: { tokenId: blk.tokenId, firstOfBlock: i === 0, docPart: blk.part }, seq: seqCounter++ })),
          heightPx: topPad + bandH + bottomPad,
          titleTopPadPx: topPad,
          orn: orn || null
        };
        eventLog.emit('page-plan', 'h2-spanning', { token: blk.tokenId, heightPx: cur.spanning.heightPx, ornTop: topPad, ornBottom: bottomPad }, cur.index);
        continue; // הכותרת הוצבה בפס; הבלוקים הבאים ימלאו את הטורים מתחתיו
      }
    }

    // REQ-BAL-10: heading escort — ≥ESCORT_MIN_LINES שורות אחרי כותרת H1–H6
    // באותו טור. **FX-1 (דוח 06, פרק 4):** הבדיקה מודדת מעתה את המחסנית
    // הפיזית האמיתית (גבהי הכותרת + פערי כניסה + שורות הליווי) ותוצאתה
    // מנוצלת להצבה מכוונת (escortLockCol/startCol) — בדיקה שאינה קשורה
    // להצבה יוצרת כותרות יתומות שאין להן תיקון (הוכח: FX-1).
    if (blk.kind === 'heading' && blk.level <= 6) {
      const following = (next && next.lines) ? next.lines.length : 0;
      if (following >= 1) {
        const escortN = Math.min(CM.ESCORT_MIN_LINES, following);
        const escortStack = CM.escortStackHeightPx(blk, next, () => blockGapPx(settings, lineH));
        let pushed = false;
        let room = ensureRoomFor(escortStack);
        if (room === -1) {
          flushPage(); cur = newPage(blk.level === 2 ? PAGE_TYPES.SIGN_OPEN : PAGE_TYPES.REGULAR);
          room = ensureRoomFor(escortStack);
          pushed = true;
        }
        if (room !== -1) {
          eventLog.emit('page-plan', pushed ? 'heading-escort-push' : 'heading-escort-directed', { token: blk.tokenId, page: cur.index, col: room, stackPx: Math.round(escortStack) }, cur.index);
          escortLockCol = room;      // הצבה מכוונת: הכותרת ושורות הליווי — בטור שאומת
          escortLinesNeeded = escortN;
        } else {
          const rec = ledger.create('heading-escort', blk.tokenId, cur.index, { stackPx: Math.round(escortStack), capacityPx: colCapacity(cur.template, cur) }, 'protections');
          ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'no column fits heading+escort even on fresh page (oversized block)');
        }
      }
    }

    // REQ-BAL-01: candidate search עם capacityBefore/capacityAfter + הקשר הבלוק הבא
    // **FX-5 (דוח 06):** הקיבולת נמדדת ב-yPx אמיתיים (גבהים + פער כניסה) —
    // לא בהמרת lineH; בלוק שנכנס פיזית לא יידחק עוד לעמוד חדש (עמוד ריק פנטום).
    const needStack = CM.stackHeightPx(blk.lines, blockGapPx(settings, lineH));
    let chosenCol = ensureRoomFor(needStack);
    if (chosenCol === -1) {
      const splitAt = findSplit(blk, cur, colCapacity, usedHeight, lineH, ledger, eventLog, settings, generateCandidates);
      if (splitAt > 0) {
        // **FX-3:** ההערות מחויבות לעמוד של החלק שבו שורת הסמן:
        // הסמן בחלק הראשון ⇒ כאן; הסמן בהמשך ⇒ בעמוד החדש (לאחר ה-flush).
        const splitMIdx = (blk.kind === 'paragraph' && (blk.notes || []).length && settings['footnotes-enabled'])
          ? firstMarkerLineOf(blk) : -1;
        if (blk.kind === 'paragraph' && splitMIdx < splitAt) reserveNotes(blk);
        pushLines(blk.lines.slice(0, splitAt - 1), { tokenId: blk.tokenId, part: 'first' });
        pushLines([blk.lines[splitAt - 1]], { tokenId: blk.tokenId, part: 'first', isLast: true });
        flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
        if (blk.kind === 'paragraph' && splitMIdx >= splitAt) reserveNotes(blk);
        pushLines(blk.lines.slice(splitAt), { tokenId: blk.tokenId, part: 'rest' });
        continue;
      }
      // הבלוק כולו עובר עמוד ⇒ ההערות יחויבו לעמוד החדש (להלן) — לא לישן (FX-3)
      flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
      chosenCol = 0;
    }
    // **FX-3 (דוח 06, פרק 4):** התחייבות הערות בעמוד שבו שורת הסמן נוחתת בפועל.
    // שורות שלפני הסמן ממלאות את העמודים הקודמים בלי תקציב (ההערה לא תשהה
    // שם); התקציב נסגר בטרם שורת הסמן ושארית השורות — F-17 נשמר לעמוד ההערה.
    const hasNotes = blk.kind === 'paragraph' && (blk.notes || []).length && settings['footnotes-enabled'];
    const mIdx = hasNotes ? Math.max(0, firstMarkerLineOf(blk)) : 0;
    if (hasNotes && mIdx > 0) {
      pushLines(blk.lines.slice(0, mIdx), { tokenId: blk.tokenId, firstOfBlock: true, docPart: blk.part }, { startCol: escortLockCol });
    }
    if (hasNotes) reserveAtMarker(blk, mIdx > 0 ? blk.lines[mIdx] : null);
    pushLines(blk.lines.slice(mIdx), { tokenId: blk.tokenId, docPart: blk.part, ...(mIdx > 0 ? {} : { firstOfBlock: true }) }, { startCol: escortLockCol });

    if (blk.sideNoteText) cur.sideNotes.push({ text: blk.sideNoteText, anchorToken: blk.tokenId });
  }

  // **S6.0 (R3-C1 — אובדן תוכן בזנב):** פס חוצה-טורים (H3–H6) או הערת-צד
  // שנותרו לבד בעמוד האחרון (בלי שורות טור ובלי הערות) לא הופיעו בפלט
  // — הם נפלטו ב-flushPage אך התנאי לא כלל אותם ⇒ העמוד לא נסגר מעולם.
  if (cur.columns.some(c => c.length) || cur.footnotes.length
    || (cur.spanning && cur.spanning.lines && cur.spanning.lines.length)
    || (cur.sideNotes && cur.sideNotes.length) || pages.length === 0) flushPage();

  // המשכים שנותרו בתור בסוף המסמך — לא ראוי לגנוז (BRZ-15): נדחפים לעמוד האחרון
  if (pendingBarNotes.length) {
    const last = pages[pages.length - 1];
    for (const n of pendingBarNotes) {
      last.footnotes.push({ ...n }); // mode/isContinuation preserved (moved-whole stays whole)
    }
    recomputeFnBudget(last);
    eventLog.emit('notes-budget', 'fn-tail-continuation', { count: pendingBarNotes.length, page: last.index }, last.index);
    pendingBarNotes.length = 0;
  }

  // terminal residual fallback (REQ-BAL-04): אם העמוד האחרון ריק למחצה ויש מצב natural — סמן
  if (settings['allow-terminal-residual-fallback']) {
    const last = pages[pages.length - 1];
    if (last && last.columns.every(c => usedHeight(c, last) < colCapacity(last.template, last) * 0.5)) {
      last.terminalResidual = true; // לא מדווח כ‑underfill (B4)
    }
  }

  // S5.1.4 + S5.1.5: הגנות AFTER every mutation, ואז לולאת נסיגה מאוחדת עם גלאי תנודה
  // **FX-2 (דוח 06, פרק 4):** תיקוני רישום-בלבד מסומנים mutates:false — לולאת
  // הנסיגה לא תתייג עוד הפרה סטטית (שאין לה תיקון פעיל) כ"תנודה בין תיקונים
  // מתחרים". התווית ההיסטורית היתה אבחון שקרי: שום תיקון לא רץ.
  const markNoLegalSplit = (violations, c) => {
    for (const v of violations) {
      const rec = c.ledger.issues.get(v.ledgerRef);
      if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'no legal split exists (documented compromise)');
    }
  };
  markNoLegalSplit.mutates = false;
  const markReadingOrderBlocked = (violations, c) => {
    for (const v of violations) {
      const rec = c.ledger.issues.get(v.ledgerRef);
      if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'line moved backward in reading order (bug-guard P0-3; not auto-repaired)');
    }
  };
  markReadingOrderBlocked.mutates = false;
  const assess = (page, s, lg) => runProtections(page, s, lg).violations;
  const retreat = runRetreatLoop({
    pages, settings, ledger, eventLog,
    repairFns: {
      'column-imbalance': (violations, c) => {
        for (const v of violations) {
          const pg = pages.find(p => `page#${p.index}` === v.target);
          if (pg) balancePageSafe(pg, c.settings, c.ledger);
        }
      },
      'reading-order-break': markReadingOrderBlocked,
      'widow-bottom': markNoLegalSplit,
      'orphan-top': markNoLegalSplit
    },
    assess
  });

  return { pages, ledger, retreat, hash: layoutHash(pages), bodyHash: bodyGeometryHash(pages) };
}

/** איזון בטוח עם rollback (REQ-BAL-09): snapshot כולל footnotes/sideNotes.
 * **EXT-8 — חלוקה גלובלית אופטימלית** (במקום טיפוס גרידי שורה-שורה):
 * מרחב המצבים החוקי = פיצולים רציפים של רצף הקריאה; המינימום הגלובלי של |lH−rH|
 * נמצא ב-O(n) (הוכחה ב-balancing.optimalSplit). סדר קריאה נשמר מבנית.
 * תיקון P1-8: גובה כולל את תקציב ההערות של **העמוד המאוזן עצמו** (על הטור האחרון). */
function balancePageSafe(page, settings, ledger) {
  const deltaOf = () => {
    const hh = (c) => c.reduce((s, ln) => s + (ln.heightPx || 0), 0)
      + (page.columns[page.columns.length - 1] === c ? (page.fnReservedHeightPx || 0) : 0);
    return Math.abs(hh(page.columns[0]) - hh(page.columns[1]));
  };
  const maxDelta = settings['imbalance-max-delta-px'];
  if (deltaOf() <= maxDelta) return true; // כבר מאוזן — אין התערבות (יציבות פריסה)
  if (!page.columns || page.columns.length < 2) return false;
  // **S5.2 (P-2 — קיבולת מאוחדת):** colCapacityOf — כולל הפס החוצה־טורים
  // (בעבר חושב מ-contentBox.height גולמי ⇒ איזון שגלש מתחת לפס בעמודי H2);
  // תקציב ההערות עובר כ-extraLast (P1-8) — בלי כפילה.
  const cap = colCapacityOf(page, { fnBudget: false });
  const best = optimalSplit(page.columns, { cap, extraLast: page.fnReservedHeightPx || 0 });
  if (!best || best.k === page.columns[0].length) {
    // **EXT-8:** אין פיצול חוקי, או שהנוכחי כבר האופטימלי הגלובלי — הפרש שנותר
    // מעל הסף הוא **פשרה מתועדת**: שלמות פסקה (הימנעות מיתום/ווידוא בגבול
    // התפר) גוברת על Δ≤5px (למשל: פסקה בת 15 שורות שנכנסת שלמה לטור אחד).
    const rec = ledger.create('rollback-compromise', `balance@p${page.index}`, page.index,
      { reason: best ? 'at-optimum' : 'capacity', delta: Math.round(deltaOf()), bestK: best ? best.k : null },
      'balance');
    ledger.transition(rec.issue_id, 'correction-blocked', 'balance',
      best ? 'global optimum reached: any further move creates widow/orphan at the seam (paragraph integrity preferred over Δ-threshold)'
           : 'hard reject: no capacity-legal split exists');
    return false;
  }
  const snapshot = { cols: page.columns.map(c => c.slice()), fn: page.footnotes.slice(), sn: page.sideNotes.slice() };
  const seq = [...page.columns[0], ...page.columns[1]];
  page.columns[0] = seq.slice(0, best.k);
  page.columns[1] = seq.slice(best.k);
  // hard reject: חריגת קיבולת אחרי ההחלפה (הגנה כפולה — optimalSplit כבר מסנן) → rollback מלא
  // **S5.2 (P-2):** קיבולת אפקטיבית פר-טור (פס + תקציב על הטור האחרון) — מקור יחיד.
  const overflows = (c, ci) => {
    const hh = c.reduce((s, ln) => s + (ln.heightPx || 0) * (ln.aqStretch || 1), 0);
    return hh > colCapacityOf(page, { colIndex: ci }) + 0.5;
  };
  if (page.columns.some(overflows)) {
    page.columns = snapshot.cols; page.footnotes = snapshot.fn; page.sideNotes = snapshot.sn;
    const rec = ledger.create('rollback-compromise', `balance@p${page.index}`, page.index, { reason: 'capacity' }, 'balance');
    ledger.transition(rec.issue_id, 'correction-reverted', 'balance', 'hard reject: overflow after move (not soft ×2000)');
    return false;
  }
  return true;
}

/** בחירת נקודת פיצול עם הגנות widow/orphan (≥WIDOW_ORPHAN_MIN שורות לכל צד).
 * **FX-5 (דוח 06):** maxFit נספר מהגבהים האמיתיים (עם פער הכניסה) —
 * לא מהמרת lineH; המרת היחידות ההיסטורית פסלה פיצולים חוקיים. */
function findSplit(blk, cur, colCapacity, usedHeight, lineH, ledger, eventLog, settings = {}, candidatesFn = null) {
  const cap = colCapacity(cur.template, cur);
  const free = cap - usedHeight(cur.columns[cur.columns.length - 1], cur);
  let maxFit = 0;
  let acc = blockGapPx(settings, lineH); // פער הכניסה של החלק הראשון
  for (const ln of blk.lines) {
    const h = ln.heightPx || 0;
    if (acc + h > free + CM.CAPACITY_EPS) break;
    acc += h;
    maxFit++;
  }
  if (maxFit < CM.WIDOW_ORPHAN_MIN || blk.lines.length - maxFit < CM.WIDOW_ORPHAN_MIN) return 0; // אין פיצול חוקי → הזזה מלאה

  if (candidatesFn) {
    const cands = candidatesFn(blk, maxFit, cap, settings, ledger);
    if (cands.length) {
      eventLog.emit('protections', 'candidate-split', { token: blk.tokenId, at: cands[0].cut, score: cands[0].score });
      return cands[0].cut;
    }
  }
  eventLog.emit('protections', 'legal-split', { token: blk.tokenId, at: maxFit });
  return maxFit;
}

module.exports = { planPages, layoutHash, bodyGeometryHash, lineTokenId, moveLineForward, balancePageSafe };
