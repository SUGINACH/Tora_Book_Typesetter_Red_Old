// src/engine/typography/kp-linebreak.js — Knuth-Plass optimal line breaking (REQ-LB-02/03/07)
'use strict';

/**
 * מימוש KP: boxes/glues/penalties, badness³, עונשי runt/widow/orphan, active-list DP.
 * - אין מקף סוף־שורה (no hyphenation — אסור בספרות תורנית).
 * - \u00A0 = צמידת NBSP (protectors); \uE000 = רווח אטומי בתוך הערה — ההערה אינה נקרעת (REQ-LB-04).
 * - RTL מדידה: rect.right − colRect.left (לקח Z.ai #5) — מתמטי כאן; DOM oracle יזהה.
 */

const INF = Number.POSITIVE_INFINITY;
const STRETCH_RATIO = 0.6;   // מתיחות רווח יחסית
const SHRINK_RATIO = 0.5;    // כיווץ רווח יחסית
const LINE_DEMERIT = 100;    // עלות בסיס לכל שורה: ברירת מחדל במודל ragged — ה־DP
                            // ממזער מספר שורות (הרינדור מצייר מרווחים טבעיים).
// השלמת ביקורת 03.11 (D-79): הרינדור של המנוע ragged (יישור לימין; מרווחים
// טבעיים ב-DOM וב-PDF). לכן במודל השבירה כל שורה מקבלת "מתיחת סוף-שורה"
// כמו \raggedright של TeX — אחרת שורה במילה בודדת (stretch=0 ⇒ ratio=0)
// היא "חינם" וה־DP מתפוצץ לשורות מילה-בודדת. כשהשורות מיושרות בפועל
// (align=stretch) ניתן לכבות: opts.raggedEnd=false.
const RAGGED_END_STRETCH_FACTOR = 10; // × maxWidthPx — מתיחה גדולה סופית-מעשית

function buildItems(words, measure) {
  const items = [];
  const sp = measure(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // יחידת NBSP פוצלת לתת־קופסאות עם **אי־שבירה אסורה** (INF penalty) ביניהן:
    // כך DP רואה את הרוחב האמיתי (כולל רווחים פנימיים) אך לעולם לא קורע את הצמד.
    // (לקח V23: רוחב חסר של unit צמוד → מדידת שורה שגויה → badness מוטה.)
    // U+E000 (רווח אטומי בתוך הערה) אינו מקום שבירה כלל — נשמר בתוך תת־הקופסה
    // ומוחלף ל‑NBSP רק בפליטה; כך unit שלם לעולם לא נקרע (REQ-LB-04).
    const parts = w.split('\u00A0');
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) items.push({ kind: 'penalty', forbidden: true, cost: INF });
      // **S5.2 (תיקון 4 — תיבת פנטום 1px):** חלק ריק (NBSP כפול, פתיחה/סיום
      // ב-NBSP) נמדד עכשיו ברוחב 0 — בעבר Math.max(1,…) יצר תיבת 1px שאינה
      // קיימת בדיו והעלתה את רוחב השורה. אין חשש מכניסה לרווח: מנגנוני ה-badness
      // מוגנים (effStretch>0 / shrink>0 — ראה breakLines) וההתקדמות מובטחת
      // (תיבה ריקה אינה מקום שבירה; הטוקן שלה משוחזר עם ה-NBSP שלו).
      items.push({ kind: 'box', text: parts[k].replace(/\uE000/g, '\u00A0'), width: Math.max(0, measure(parts[k])) });
      if (k < parts.length - 1) items.push({ kind: 'glue', width: sp, stretch: sp * STRETCH_RATIO, shrink: sp * SHRINK_RATIO, internal: true });
    }
    if (i < words.length - 1) {
      items.push({ kind: 'glue', width: sp, stretch: sp * STRETCH_RATIO, shrink: sp * SHRINK_RATIO });
    }
  }
  items.push({ kind: 'penalty', final: true }); // סיום פסקה — שבירה חובה
  return items;
}

function badness(ratio) {
  if (!isFinite(ratio)) return 0;
  if (ratio < -1) return INF;               // אי־אפשר לכווץ מעל הגבול
  const r = Math.abs(ratio);
  if (r <= 1) return Math.round(Math.pow(r * 100, 3) / 10000); // 0..100
  return 100 + Math.round(Math.pow((r - 1) * 100, 2) / 100);   // דחיסה/מתיחת יתר
}

/**
 * @param {string[]} words - מילות הפסקה (NBSP כבר הוצמד ע"י protectors)
 * @param {number} maxWidthPx
 * @param {(t:string)=>number} measure
 * @param {number} lineHeightPx
 * @param {{runtMinPct?:number}} opts
 * @returns {Array<{words:string[], widthPx:number, heightPx:number, isLast:boolean}>}
 */
function breakLines(words, maxWidthPx, measure, lineHeightPx, opts = {}) {
  // **03.11 (ביקורת):** חיבור ההגדרה — runt-min-width-pct מגיע כ-runts מה-pipeline
  // וכ-runtMinPct מקריאות ישירות; שניהם נקראים (בעבר רק runtMinPct נקרא וההגדרה לא השפיעה).
  const runts = opts.runtMinPct != null ? opts.runtMinPct : (opts.runts != null ? opts.runts : 50);
  const items = buildItems(words, measure);
  const n = items.length;
  const cost = new Array(n + 1).fill(INF);
  const parent = new Array(n + 1).fill(-1);
  cost[0] = 0;

  for (let i = 0; i < n; i++) {
    if (cost[i] === INF) continue;
    if (items[i].kind === 'glue' && !items[i].internal) { // דלג על glue רגיל בהתחלת שורה;
      // glue פנימי (בתוך יחידת NBSP) אסור לדלג — הרוחב שלו חלק בלתי נפרד מהצמד.
      if (cost[i + 1] > cost[i]) { cost[i + 1] = cost[i]; parent[i + 1] = i; }
      continue;
    }
    let w = 0, stretch = 0, shrink = 0;
    for (let j = i; j < n; j++) {
      const it = items[j];
      if (it.kind === 'box') w += it.width;
      // **תיקון שורש (ביקורת 03.11): רוחב glue נכלל ברוחב הטבעי של השורה —
      // כמו ב-TeX (Σ תיבות + Σ רווחים). בעבר נצברו רק stretch/shrink ⇒ ה־DP
      // "חשב" ששורה נכנסת בעוד רוחבה הטבעי (כולל רווחים) חורג מהטור.
      else if (it.kind === 'glue') { w += it.width; stretch += it.stretch; shrink += it.shrink; }
      else if (it.kind === 'penalty') {
        if (it.forbidden) continue; // תוך-יחידה: אין כאן מקום שבירה (legalCut כבר מבטל); ההצברה נמשכת
        // סיום שורה (penalty סופי של הפסקה) — good break.
        // **תיקון שורש (ביקורת 03.11): השבירה הסופית היא צומת סוף-הפסקה n —
        // בעבר נכתבה ל-cost[j] (אינדקס הפריט עצמו, n−1) ⇒ cost[n] נותר INF לעולם
        // ⇒ ה־DP מעולם לא סיפק פתרון וכל שבירות השורות במנוע מאז S1 יצאו מהגיבוי
        // הגרידי (עם באג ה-NBSP). התיקון מחיה את Knuth-Plass בפועל.
        const slack = maxWidthPx - w;
        // raggedEnd: מתיחת סוף-שורה (D-79) — שורות ragged אינן נמדדות במתיחת
        // בין-מילים אלא בכניסה טבעית; היתרה עד לקצה הטור "נבלעת" במתיחת הסוף.
        const raggedEnd = opts.raggedEnd !== false;
        const effStretch = stretch + (raggedEnd ? maxWidthPx * RAGGED_END_STRETCH_FACTOR : 0);
        const ratio = slack >= 0 ? (effStretch > 0 ? slack / effStretch : 0) : (shrink > 0 ? slack / shrink : -2);
        let b = badness(ratio);
        if (b < INF && w < maxWidthPx * (runts / 100)) b += 60; // עונש runt בשורת הסיום
        if (b < INF) {
          const cand = cost[i] + b + LINE_DEMERIT;
          if (cand < cost[n]) { cost[n] = cand; parent[n] = i; }
        }
        break;
      }
      // **S5.1 (D-92-DP):** הדפדפן מרנדר רוחב טבעי (white-space:normal) —
      // שורה שרוחבה הטבעי חורג מהטור נעטפת בתצוגה (טקסט-על-טקסט) גם אם
      // היישוב יכול לכווץ רווחים ב-PDF. לכן המבחן ברוחב הטבעי, בלי shrink.
      // **S5.2 (תיקון 3 — המבחן היה מרחיב, לא שמרני):** בעבר `w > maxWidth+0.75`
      // אִפשר קווים ברוחב טבעי עד maxWidth+0.75px (ובכך גם קבלת חיתוכים עם
      // slack שלילי דרך כיווץ) — בזמן ש-FIT_EPS של המורשת שמרן (limit−eps).
      // כעת החיתוך נעצר מוקדם: שורה שאינה נכנסת ב-maxWidth−0.75 אינה מוארכת
      // עוד, וכל קו מקובל הוא ברוחב טבעי ≤ maxWidth−0.75 (גם בסוף פסקה —
      // הפנלטי הסופי נמדר רק אחרי שכל הפריטים עברו את אותו מבחן). מילה רחבה
      // מהטור עדיין יוצאת כשורה בפני עצמה דרך הגיבוי הגרידי (greedyFallback —
      // התקדמות מובטחת, טוקן בודד אינו נחסם: pushTok עם toks ריק אינו מוסף).
      if (w > maxWidthPx - 0.75) break; // חריגה שאינה ניתנת לתיקון — שמרני כמו FIT_EPS

      if (it.kind === 'box') {
        // מקומות שבירה חוקיים נקבעים **מבנית מראש** (static legal-cuts): cut בצומת c חוקי
        // רק אם items[c-1] הוא glue לא־פנימי ו‑items[c] תיבה שפותחת יחידה חדשה.
        // זה מבטל את באג V23: lock תלוי-נקודת-התחלה על צמתים משותפים ל‑DP.
        // (תיקון S3: הבדיקה הייתה בתוך הלולאה עם אינדקס שגוי j+2 — כל השברים נחסמו.)
        const cut = j + 1; // נקודת שבירה חוקית: אחרי תיבה, לפני ה‑glue העוקב
        if (!(items[cut].kind === 'glue' && !items[cut].internal && items[cut + 1] && items[cut + 1].kind === 'box')) continue;
        const slack = maxWidthPx - w;
        // **S5.2 (תיקון 3 — שמרנות בקבלת חיתוך):** קו שאינו נכנס ברוחב הטבעי
        // (slack < −FIT_EPS) הוא בלתי-אפשרי — badness INF, לא "כיווץ". המבחן
        // השמרני למעלה אמור למנוע הגעה לכאן; השמירה הכפולה מתעדת את הכוונה.
        if (slack < -0.75) continue;
        const raggedEnd = opts.raggedEnd !== false;
        const effStretch = stretch + (raggedEnd ? maxWidthPx * RAGGED_END_STRETCH_FACTOR : 0);
        const ratio = slack >= 0 ? (effStretch > 0 ? slack / effStretch : 0) : (shrink > 0 ? slack / shrink : -2);
        const b = badness(ratio);
        if (b >= INF) continue;
        const cand = cost[i] + b + LINE_DEMERIT;
        if (cand < cost[cut]) { cost[cut] = cand; parent[cut] = i; }
      }
    }
  }

  if (cost[n] === INF) return greedyFallback(items, maxWidthPx, measure, lineHeightPx);

  const cuts = [];
  let p = n;
  while (p > 0 && parent[p] >= 0) { cuts.push([parent[p], p]); p = parent[p]; }
  cuts.reverse();

  const lines = [];
  for (let k = 0; k < cuts.length; k++) {
    const [a, b] = cuts[k];
    // תת־קופסאות של אותה יחידת NBSP מאוחדות חזרה עם \u00A0 (הצמד שומר על זהותו)
    const rawBoxes = items.slice(a, b).filter(x => x.kind === 'box');
    const toks = [];
    let cur = null, prevPenaltyForbidden = false;
    for (let idx = a; idx < b; idx++) {
      const it = items[idx];
      if (it.kind === 'penalty' && it.forbidden) { prevPenaltyForbidden = true; continue; }
      if (it.kind !== 'box') continue;
      if (cur !== null && prevPenaltyForbidden) { cur += '\u00A0' + it.text; prevPenaltyForbidden = false; }
      else { if (cur !== null) toks.push(cur); cur = it.text; prevPenaltyForbidden = false; }
    }
    if (cur !== null) toks.push(cur);
    void rawBoxes;
    if (!toks.length) continue;
    // רוחב אמיתי: סכום תת־הקופסאות + רווחי ה‑glue שביניהן (כולל internal)
    let widthPx = 0;
    for (let idx = a; idx < b; idx++) {
      const it = items[idx];
      if (it.kind === 'box') widthPx += it.width;
      else if (it.kind === 'glue') widthPx += it.width;
    }
    lines.push({ words: toks, widthPx, heightPx: lineHeightPx, isLast: k === cuts.length - 1 });
  }
  return lines;
}

/**
 * מסלול גיבוי (כשה־DP לא מצא פתרון אפשרי, למשל מילה רחבה מהעמודה — אין מקף).
 * תיקון שורש (ביקורת 03.11, S13): בגיבוי חלים **אותם איסורי שבירה** כמו במסלול
 * הראשי — בעבר כל penalty חתם שורה, כולל `forbidden` (בין תתי־קופסות של יחידת
 * NBSP) ⇒ היחידה נקרעה בין שורות **ואיבדה את \u00A0 שלה** (אובדן תוכן, BRZ-15;
 * ורוחב פנימי נמדד כרווח רגיל). כעת:
 * 1. penalty אסור לעולם אינו מסיים שורה — היחידה משוחזרת כטוקן אחד עם \u00A0
 *    (זהה לשחזור המסלור הראשי).
 * 2. רוחב טוקן נצבר מהפריטים (תיבות + glue פנימי 0.26em) — זהה למסלור הראשי,
 *    לא מדידה מחודשת של מחרוזת NBSP (הייתה מודדת 0.4em פנימי — עיוות רוחב).
 * 3. התקדמות מובטחת: טוקן שגולש פותח שורה חדשה; טוקן רחב מהעמודה נשאר לבד
 *    בשורה משלו — אין לולאה ואין דילוג תוכן. מעבר אחד על הפריטים.
 */
function greedyFallback(items, maxWidthPx, measure, lineHeightPx) {
  const space = measure(' ');
  const lines = [];
  let toks = [];            // טוקנים של השורה הנוכחית
  let w = 0;                // רוחב השורה (כולל רווחים בין טוקנים)
  let cur = null, curW = 0, joinNext = false;  // טוקן בבנייה + רוחבו מהפריטים

  const flush = () => {
    if (!toks.length) return;
    lines.push({ words: toks, widthPx: w, heightPx: lineHeightPx, isLast: false });
    toks = []; w = 0;
  };
  const pushTok = () => {
    if (cur === null) return;
    // **S6.0 (R7-M2 — רווח רפאים בגיבוי הגרידי):** sp חושב לפי מצב השורה
    // **לפני** ה-flush ונוסף גם אחריו ⇒ כל שורה שנפתחה ב-flush נשאה רווח
    // אחד עודף ב-widthPx (מדידה שקרית לצרכי ריצת-שורה/איזון). תוקם:
    // הבדיקה וההוספה לפי המצב **אחרי** ההחלטה על flush.
    if (toks.length && w + space + curW > maxWidthPx - 0.75) flush(); // הטוקן הבא ייפתח שורה חדשה
    const sp = toks.length ? space : 0;
    toks.push(cur); w += sp + curW;
    cur = null; curW = 0; joinNext = false;
  };

  for (const it of items) {
    if (it.kind === 'penalty') {
      if (it.final) continue;            // סוף פסקה — הטיפול שלאחר הלולאה סוגר את האחרון
      if (it.forbidden) { joinNext = true; continue; } // אין חיתוך בתוך יחידה — לעולם
      continue;
    }
    if (it.kind === 'glue') {
      if (it.internal && cur !== null) { curW += it.width; } // רווח פנימי בתוך היחידה
      continue; // glue רגיל בין טוקנים: רוחבו נכנס כ־sp בעת pushTok
    }
    if (it.kind !== 'box') continue;
    if (cur !== null && joinNext) { cur += '\u00A0' + it.text; curW += it.width; joinNext = false; } // המשך הצמד — ואיפוס: המילה הרגילה הבאה לא תיבלע
    else { pushTok(); cur = it.text; curW = it.width; }
  }
  pushTok(); flush();
  if (lines.length) lines[lines.length - 1].isLast = true;
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// שלב 4 (§4.1-2/6/9) — breakItemSequence: הזנת הרצף הקנוני ל-Knuth–Plass.
// **הרחבת המנוע הקיים**, לא breaker חדש: אותם קבועים (STRETCH_RATIO/
// SHRINK_RATIO/LINE_DEMERIT/RAGGED_END_STRETCH_FACTOR), אותה פונקציית badness,
// אותו מבנה חיתוכים חוקיים סטטיים — על פריטי LineItem (מדודים מראש דרך
// measureItem היחיד) במקום words[]. breakLines(words) נשאר לנתיב הקיים עד
// להשלמת המעבר; שום סוג פריט (תמונה/סמן/פריט מותאם) אינו מקבל breaker משלו.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * breakItemSequence — שבירת רצף LineItem לשורות.
 * @param {Array<object>} items — רצף מ-buildLineSequences (בלי ה-penalty הסופי; נוסף כאן)
 * @param {number} maxWidthPx — רוחב הטור/האזור
 * @param {{runts?:number, raggedEnd?:boolean, lineWidthAt?: (lineIndex:number)=>number}} opts
 *   lineWidthAt: אילוצי אזור/שורה (§4.1-7 — wrap-around): רוחב אפקטיבי לפי מספר
 *   השורה (תמונה צפה מקטינה רוחב לשורות שבגובהה). אין מנגנון שבירה שני לטקסט
 *   שעוקף תמונה — אותו DP, אילוץ אחד.
 * @returns {{lines:Array<{from:number,to:number,badness:number,reason:string}>, fallback:boolean, diagnostics:Array}}
 */
function breakItemSequence(items, maxWidthPx, opts = {}) {
  const runts = opts.runts != null ? opts.runts : 50;
  const raggedEnd = opts.raggedEnd !== false;
  const lineWidthAt = typeof opts.lineWidthAt === 'function' ? opts.lineWidthAt : null;
  if (!Array.isArray(items) || !items.length) {
    return { lines: [], fallback: false, diagnostics: [{ code: 'empty-sequence', message: 'breakItemSequence: רצף ריק' }] };
  }
  const seq = items.concat([{ role: 'penalty', penaltyType: 'final', cost: 0, measuredAdvance: 0, internal: false, itemId: '#final' }]);
  const n = seq.length;
  const cost = new Array(n + 1).fill(INF);
  const parent = new Array(n + 1).fill(-1);
  const cutBad = new Array(n + 1).fill(0);
  const cutReason = new Array(n + 1).fill('');
  cost[0] = 0;
  // מספר השורה המשוער לצומת i — לאילוץ רוחב לפי שורה (wrap-around): מספיק קירוב
  // סדרתי (כל צומת שורה שווה קודם+1); קירוב זה נבדק בבדיקות wrap.
  const lineOf = new Array(n + 1).fill(0);

  for (let i = 0; i < n; i++) {
    if (cost[i] === INF) continue;
    const it = seq[i];
    if (it.role === 'glue' && !it.internal) {
      // דלג על glue רגיל בפתיחת שורה (כמו breakLines); glue פנימי של יחידה צמודה — אסור לדלג
      if (cost[i + 1] > cost[i]) { cost[i + 1] = cost[i]; parent[i + 1] = i; lineOf[i + 1] = lineOf[i]; }
      continue;
    }
    let w = 0, stretch = 0, shrink = 0;
    for (let j = i; j < n; j++) {
      const cur = seq[j];
      if (cur.role === 'box') w += cur.measuredAdvance;
      else if (cur.role === 'glue') {
        const g = glueWidths(cur);
        w += g.width; stretch += g.stretch; shrink += g.shrink;
      } else if (cur.role === 'penalty') {
        if (cur.penaltyType === 'forbidden') continue; // בתוך יחידה צמודה — אין חיתוך; ההצברה נמשכת
        // final — סוף הרצף: צומת n (אותו תיקון שורש של breakLines — לא אינדקס הפריט)
        const maxW = lineMax(lineWidthAt, lineOf[i], maxWidthPx);
        const slack = maxW - w;
        const effStretch = stretch + (raggedEnd ? maxW * RAGGED_END_STRETCH_FACTOR : 0);
        const ratio = slack >= 0 ? (effStretch > 0 ? slack / effStretch : 0) : (shrink > 0 ? slack / shrink : -2);
        let b = badness(ratio);
        if (b < INF && w < maxW * (runts / 100)) b += 60; // עונש runt בשורת הסיום
        if (b < INF) {
          const cand = cost[i] + b + LINE_DEMERIT;
          if (cand < cost[n]) { cost[n] = cand; parent[n] = i; cutBad[n] = b; cutReason[n] = 'final'; }
        }
        break;
      }
      // מבחן רוחב טבעי שמרני (S5.2 תיקון 3 — כמו breakLines; מילה רחבה מהטור תטופל
      // בערוץ ה-overflow המפורש של ה-fallback הדטרמיניסטי, עם אבחון — לא בשקט)
      const maxW = lineMax(lineWidthAt, lineOf[i], maxWidthPx);
      if (w > maxW - 0.75) break;

      if (cur.role === 'box') {
        // חיתוך חוקי: אחרי תיבה, כשאחריה glue לא-פנימי ואחריו תיבה (אותו כלל
        // סטטי של breakLines — מבטל נעילה תלוית-נקודת-התחלה)
        const cut = j + 1;
        if (!(seq[cut] && seq[cut].role === 'glue' && !seq[cut].internal && seq[cut + 1] && seq[cut + 1].role === 'box')) continue;
        const slack2 = maxW - w;
        if (slack2 < -0.75) continue; // כיווץ בלתי-אפשרי — INF מתועד
        const effStretch2 = stretch + (raggedEnd ? maxW * RAGGED_END_STRETCH_FACTOR : 0);
        const ratio2 = slack2 >= 0 ? (effStretch2 > 0 ? slack2 / effStretch2 : 0) : (shrink > 0 ? slack2 / shrink : -2);
        const b2 = badness(ratio2);
        if (b2 >= INF) continue;
        const cand2 = cost[i] + b2 + LINE_DEMERIT;
        if (cand2 < cost[cut]) { cost[cut] = cand2; parent[cut] = i; cutBad[cut] = b2; cutReason[cut] = 'legal-cut'; lineOf[cut] = lineOf[i] + 1; }
      }
    }
  }

  if (cost[n] === INF) {
    const fb = itemGreedyFallback(seq, maxWidthPx, opts);
    return { lines: fb.lines, fallback: true, diagnostics: fb.diagnostics };
  }
  const cuts = [];
  let p = n;
  while (p > 0 && parent[p] >= 0) { cuts.push({ from: parent[p], to: p, badness: cutBad[p], reason: cutReason[p] }); p = parent[p]; }
  cuts.reverse();
  // קציצות ריקות (glue בלבד — שלבי דילוג השרושים) אינן שורות; מסננים כמו ש-breakLines מסנן שורות ללא טוקנים.
  const real = cuts.filter((c) => {
    for (let k = c.from; k < c.to; k++) if (seq[k].role === 'box') return true;
    return false;
  });
  return { lines: real, fallback: false, diagnostics: [] };
}

/** רוחב אפקטיבי לשורה: אילוץ אזור (wrap) אם הוגדר, אחרת רוחב הטור. */
function lineMax(lineWidthAt, lineIdx, maxWidthPx) {
  return lineWidthAt ? lineWidthAt(lineIdx) : maxWidthPx;
}

/** רוחבי glue של פריט — מהמדידה שלו (sep נמדד דרך measureItem; מתיחות לפי הקבועים המרוכזים). */
function glueWidths(glueItem) {
  // פלובק ל-measuredAdvance לקריאות גולמיות של המנוע; הבנאי הרצף הקנוני מספקיים את הקישור המלא.
  const width = glueItem.measured && glueItem.measured.ok
    ? glueItem.measured.advance
    : (Number.isFinite(glueItem.measuredAdvance) ? glueItem.measuredAdvance : 0);
  return { width, stretch: width * STRETCH_RATIO, shrink: width * SHRINK_RATIO };
}

/**
 * ערוץ overflow דטרמיניסטי (§4.1-6 / §19 בהוראה): מעבר אחד, ללא לולאת fallback.
 * אותם איסורי שבירה (יחידה צמודה אינה נקרעת); פריט רחב מהרוחב — שורה משלו
 * + diagnostic מפורש. אין מחיקת פריט, אין המרה שקטה, אין שורה ריקה.
 */
function itemGreedyFallback(seq, maxWidthPx, opts = {}) {
  const lineWidthAt = typeof opts.lineWidthAt === 'function' ? opts.lineWidthAt : null;
  const lines = [];
  const diagnostics = [];
  let cur = [];             // אינדקסים של השורה הנוכחית
  let w = 0;
  let lineIdx = 0;
  const flush = (reason) => {
    if (!cur.length) return;
    lines.push({ from: cur[0], to: cur[cur.length - 1] + 1, badness: 0, reason: reason || 'overflow-own-line' });
    cur = []; w = 0; lineIdx++;
  };
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i];
    if (it.role === 'penalty') {
      if (it.penaltyType === 'final') continue;
      if (it.penaltyType === 'forbidden') continue; // יחידה צמודה — לעולם אינה נקרעת
      continue;
    }
    if (it.role === 'glue') {
      if (it.internal && cur.length) { w += glueWidths(it).width; } // רווח פנימי בתוך היחידה
      continue; // glue רגיל נכנס בעת פתיחת התיבה הבאה
    }
    // תיבה: רוחבה מהמדידה; תיבה רחבה מהרוחב — שורה משלה + אבחון מפורש
    const maxW = lineWidthAt ? lineWidthAt(lineIdx) : maxWidthPx;
    const bw = it.measuredAdvance;
    if (bw > maxW - 0.75) {
      diagnostics.push({ code: 'overflow-item-own-line', itemId: it.itemId, kind: it.kind, advancePx: +bw.toFixed(3), maxWidthPx: +maxW.toFixed(3), message: `פריט רחב מהרוחב — שורה בפני עצמו (${it.itemId})` });
      flush('overflow-own-line');
      cur = [i]; w = bw; flush('overflow-own-line');
      continue;
    }
    const addW = (cur.length ? leadingGlueWidth(seq, i) + bw : bw);
    if (cur.length && w + addW > maxW - 0.75) flush('overflow-wrap');
    if (cur.length) w += leadingGlueWidth(seq, i);
    cur.push(i); w += bw;
  }
  flush('overflow-final');
  return { lines, diagnostics };
}

/** רוחב ה-glue הרגיל שלפני תיבה i (הראשון שאינו פנימי/penalty משמאל). */
function leadingGlueWidth(seq, i) {
  for (let k = i - 1; k >= 0; k--) {
    const it = seq[k];
    if (it.role === 'penalty') continue;
    if (it.role === 'glue' && !it.internal) return glueWidths(it).width;
    if (it.role === 'box') return 0; // אין glue מיד לפני — יחידה צמודה מטופלת ב-penalty
  }
  return 0;
}

module.exports = { breakLines, badness, breakItemSequence, STRETCH_RATIO, SHRINK_RATIO, LINE_DEMERIT, RAGGED_END_STRETCH_FACTOR };
