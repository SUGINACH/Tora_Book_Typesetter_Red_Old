#!/usr/bin/env python3
# patch-modules.py — שלב 5 פרוסה 1: טלאים למודולי ה-layout (חוץ מ-dp-planner
# שמטופל ב-patch-dp-planner.py). מריץ משורש הריפו; נכשל ברעש על עוגן חסר.
import sys

def rep(path, old, new, label, count=1):
    s = open(path).read()
    if old not in s:
        print('MISSING:', label, '@', path); sys.exit(1)
    if s.count(old) != count:
        print('NOT-UNIQUE:', label, s.count(old), '@', path); sys.exit(1)
    open(path, 'w').write(s.replace(old, new, count))
    print('ok:', label)

R = 'red-build/src/engine/'

# ============ 1. column-flow.js — planningUsedHeight (SSOT; #16) ============
rep(R + 'layout/column-flow.js',
    "module.exports = { columnWidths, blockGapPx, isFullWidthBlock, colCapacityOf, buildPageTemplate };",
    """/**
 * **שלב 5 (חילוץ שורש מ-PR #16, S78/D-107 — גובה תפוס בזמן תכנון, מקור יחיד):**
 * Σ גבהי שורות + יתרת תקציב ההערות של העמוד — נרשם על הטור האחרון (F-17).
 * זו סמנטיקת ה-**תכנון** (לפני AQ — בלי מקדם מתיחה); סמנטיקת ה-**רינדור**
 * (עם aqStretch) חיה ב-balancing.usedHeight. עד כאן היו שני מימושים מקבילים
 * באותו שם בשני מודולים (dp-planner מקומי מול זה) — כעת צרכן יחיד.
 */
function planningUsedHeight(col, page) {
  let h = col.reduce((s, ln) => s + (ln.heightPx || 0), 0);
  if (page && page.fnReservedHeightPx > 0 && page.columns[page.columns.length - 1] === col) {
    h += page.fnReservedHeightPx; // נשמר פעם אחת — בסוף הטור האחרון
  }
  return h;
}

module.exports = { columnWidths, blockGapPx, isFullWidthBlock, colCapacityOf, planningUsedHeight, buildPageTemplate };""",
    'column-flow planningUsedHeight')

# ============ 2. footnote-budget.js — noteMetrics + lanes (SSOT; #16) ============
rep(R + 'layout/footnote-budget.js',
    "// src/engine/layout/footnote-budget.js — Footnote reservation (REQ-FN-01/02/07)\n'use strict';\n",
    "// src/engine/layout/footnote-budget.js — Footnote reservation (REQ-FN-01/02/07)\n'use strict';\n\nconst { assignFootnoteLanes } = require('./footnote-lanes'); // **שלב 5 (חילוץ שורש מ-PR #16):** מקור-אמת יחיד לחלוקת נתיבי המרזב\n",
    'footnote-budget import lanes')

rep(R + 'layout/footnote-budget.js',
    "/** פרופילי רוחב גופן לגוף ההערה (f-note-body-font). */\nconst NOTE_FONT_FACTORS = { 'David HB': 1.06, 'David': 1.04, 'Narkisim': 1.10, 'Nachlieli': 0.96, 'Alef': 1.02, 'Rubin': 1.05 };\n\nfunction noteHeight(note, settings, measure) {\n  const size = settings['body-font-size-pt'] * 0.8; // גופן הערה קטן\n  const lh = Math.round(size * (96 / 72) * 1.25);",
    """/** פרופילי רוחב גופן לגוף ההערה (f-note-body-font). */
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
  const { sizePt, lineHeightPx: lh } = noteMetrics(settings); // **שלב 5:** מקור יחיד לגודל/פיץ'""",
    'footnote-budget noteMetrics')

rep(R + 'layout/footnote-budget.js',
    "  const spaceW = measure(' ', size) * factor;",
    "  const spaceW = measure(' ', sizePt) * factor;",
    'noteHeight spaceW', 1)
rep(R + 'layout/footnote-budget.js',
    "  const mkW = mkTxt ? measure(mkTxt, size) * factor + spaceW : 0;",
    "  const mkW = mkTxt ? measure(mkTxt, sizePt) * factor + spaceW : 0;",
    'noteHeight mkW', 1)
rep(R + 'layout/footnote-budget.js',
    "    const ww = measure(word, size) * factor;",
    "    const ww = measure(word, sizePt) * factor;",
    'noteHeight ww', 1)

rep(R + 'layout/footnote-budget.js',
    """  if (cols === 1) return heights.reduce((a, b) => a + b, 0);
  // 2 טורים: חלוקה שווה־גובה (greedy LPT דטרמיניסטית)
  const t = [0, 0];
  for (const h of [...heights].sort((a, b) => b - a)) { const i = t[0] <= t[1] ? 0 : 1; t[i] += h; }
  return Math.max(t[0], t[1]);
}

module.exports = { getFootnotesReservedHeight, noteHeight, laneWidth, NOTE_FONT_FACTORS };""",
    """  if (cols === 1) return heights.reduce((a, b) => a + b, 0);
  // 2 טורים: חלוקה שווה־גובה — **שלב 5 (חילוץ שורש מ-PR #16):** מקור יחיד
  // (footnote-lanes). שקול מתמטית למימוש הקודם (סדר גובה-יורד/אינדקס-עולה,
  // חמדני לנמוך) — נעול בבדיקת שקילות; מעתה תקציב/הקרנה/תצוגה משתפים את
  // אותה חלוקה ממקור אחד.
  const { totals } = assignFootnoteLanes(pageNotes, (n, i) => heights[i]);
  return Math.max(totals[0], totals[1]);
}

module.exports = { getFootnotesReservedHeight, noteHeight, noteMetrics, laneWidth, NOTE_FONT_FACTORS };""",
    'footnote-budget lanes + exports')

# ============ 3. markers.js — markerFragmentOf (SSOT; #16) ============
rep(R + 'notes/markers.js',
    "module.exports = { markerFor, makeCounter, hebrewMarkFinish, HEB_LETTERS, renumberPageScopedMarkers, MARK_TAG: '\\uE102' };",
    """/**
 * **שלב 5 (חילוץ שורש מ-PR #16, S78/D-107 — עוזר זיהוי סמן מתויג):**
 * חילוץ טקסט הסמן ממילת גוף — אותו פענוח של ה-pipeline (countKnown) ושל
 * המתכנן (הערות עוקבות-עוגן): מקור יחיד לתבנית D-53.
 *  - מילה עם E000 (הערה שנדחתה לגוף): הסמן הוא הפרגמנט שלפני ה-E000
 *    (עשוי להיות ממוזג לעוגן ב-NBSP — מנורמל לרווח לפני הפיצול).
 *  - מילה עם תג \\uE102 (סמן מתויג): הפרגמנט שאחרי התג עד NBSP/רווח.
 * @returns {string|null} — טקסט הסמן או null אם המילה אינה נושאת סמן.
 */
function markerFragmentOf(word) {
  const sw = String(word);
  if (sw.includes('\\uE000')) {
    const at = sw.indexOf('\\uE000');
    const frags = sw.slice(0, at).replace(/\\u00A0/g, ' ').split(' ').filter(Boolean);
    return frags.length ? frags[frags.length - 1] : null;
  }
  if (!sw.includes('\\uE102')) return null;
  const at = sw.indexOf('\\uE102');
  const frag = sw.slice(at + 1).split(/[\\u00A0 ]/)[0];
  return frag || null;
}

module.exports = { markerFor, makeCounter, hebrewMarkFinish, HEB_LETTERS, renumberPageScopedMarkers, markerFragmentOf, MARK_TAG: '\\uE102' };""",
    'markers markerFragmentOf')

# ============ 4. balancing.js — seamIsClean + escortCleanBoundary (#16/#17) ============
rep(R + 'layout/balancing.js',
    "const { colCapacityOf } = require('./column-flow'); // **S5.2 (P-2):** קיבולת הטור — מקור יחיד",
    "const { colCapacityOf } = require('./column-flow'); // **S5.2 (P-2):** קיבולת הטור — מקור יחיד\nconst { seamIsClean, escortCleanBoundary } = require('./constraint-matrix'); // **שלב 5:** תפר נקי + תפר מודע-ליווי — מקור יחיד (חילוץ שורש מ-#16/#17)",
    'balancing import')

s = open(R + 'layout/balancing.js').read()
start_marker = "  // גבול-תפר נקי (ווידוא/יתום קלאסיים, מבוסס ריצות tokenId):"
end_marker = "\n  };"
si = s.index(start_marker)
ei = s.index(end_marker, si) + len(end_marker)
new_fn = """  // גבול-תפר נקי — **שלב 5:** constraint-matrix.seamIsClean (מקור יחיד; חילוץ
  // שורש מ-#16) + escortCleanBoundary (חילוץ שורש מ-#17, דוח 06 פרק 4 —
  // סתירת ליווי×איזון): גבול "נקי" הוא גם נקי מווידוא/יתום (לפי ריצות tokenId
  // ב-meta — לא דגלי part, שאינם מעידים על מיקום בבלוק; נלכד בניפוי EXT-8)
  // וגם אינו מותיר כותרת בתחתית הטור עם <ESCORT_MIN_LINES שורות אחריה —
  // אחרת האיזון עצמו יוצר הפרת heading-escort שאין לה תיקון.
  const cleanBoundary = (k) => seamIsClean(seq, k) && escortCleanBoundary(seq, k);"""
open(R + 'layout/balancing.js', 'w').write(s[:si] + new_fn + s[ei:])
print('ok: balancing cleanBoundary')

# ============ 5. candidate-generator.js — maxFit חי (#16) + FX-4 (#17) ============
rep(R + 'layout/candidate-generator.js',
    "const { blockGapPx } = require('./column-flow');",
    "const { blockGapPx } = require('./column-flow');\nconst { MIN_LINES_PER_SIDE, orphanAtDestination } = require('./constraint-matrix'); // **שלב 5:** חלון הפיצול + עונש strict חי — מקור יחיד (חילוץ שורש מ-#16/#17)",
    'cg import')

rep(R + 'layout/candidate-generator.js',
    """ * @param {object} blk        בלוק עם .lines (נמדדו)
 * @param {number} cur        שורות שנכנסות כרגע לטור
 * @param {number} colCapacityPx
 * @param {object} settings
 * @param {object} ledger     Ledger (core/ledger) — כתיבת סיבה לכל דחייה (S5.1.10)
 */
function generateCandidates(blk, cur, colCapacityPx, settings, ledger) {
  const out = [];
  const lineH = blk.lineHeightPx || 20;
  const gap = blockGapPx(settings, lineH);
  for (let cut = 2; cut < blk.lines.length; cut++) {""",
    """ * **שלב 5 — שני תיקוני שורש מאוחדים (חילוץ מ-#16/#17):**
 *  - **מועמד מוגבל למקום הפנוי (#16):** פרמטר `cur` (maxFit — השורות שנכנסות
 *    במקום הפנוי) היה **מת**: המועמד המנצח נבחר לפי איזון בלבד ויכול היה
 *    לחרוג מהמקום הפנוי ⇒ pushLines פלט את העודף בפליטה מרומזת ⇒ עמוד
 *    כמעט-ריק באמצע הספר (נמדד: עמוד עם 4+4 שורות בלבד; מקורו cut=16 מול
 *    maxFit≈8). כעת מועמד שחורג מ-maxFit נדחה HARD עם רישום סיבה (D-11).
 *  - **FX-4 (#17, דוח 06):** העונש ההיסטורי `cut < 2` היה בלתי-ספיק לעולם
 *    (הלולאה מתחילה ב-cut = 2) — widow-strictness=strict לא שינה דבר
 *    (מדיניות שקרית כלפי המשתמש). התנאי הנכון: החלק השני קצר מהמינימום ⇒
 *    יתום בראש היעד (orphanAtDestination).
 *
 * @param {object} blk        בלוק עם .lines (נמדדו)
 * @param {number} cur        maxFit — שורות שנכנסות במקום הפנוי (גבול עליון חוקי למועמדים)
 * @param {number} colCapacityPx
 * @param {object} settings
 * @param {object} ledger     Ledger (core/ledger) — כתיבת סיבה לכל דחייה (S5.1.10)
 */
function generateCandidates(blk, cur, colCapacityPx, settings, ledger) {
  const maxFit = Number(cur) || 0; // **שלב 5:** maxFit חי — גבול עליון חוקי למועמדים
  const out = [];
  const lineH = blk.lineHeightPx || 20;
  const gap = blockGapPx(settings, lineH);
  for (let cut = MIN_LINES_PER_SIDE; cut < blk.lines.length; cut++) {
    // HARD reject: חיתוך שחורג מהמקום הפנוי — החלק הראשון לא ייכנס לעמוד (#16)
    if (cut > maxFit) {
      if (ledger) ledger.create('candidate-rejected', `${blk.tokenId}@${cut}`, null, { why: 'exceeds-free-space', cut, maxFit }, 'candidate-gen');
      continue;
    }""",
    'cg signature + maxFit')

rep(R + 'layout/candidate-generator.js',
    """    const score = Math.abs(capacityBefore - (colCapacityPx - after))
      + (settings['widow-strictness'] === 'strict' && cut < 2 ? 1e9 : 0);""",
    """    const score = Math.abs(capacityBefore - (colCapacityPx - after))
      + (settings['widow-strictness'] === 'strict' && orphanAtDestination(blk.lines.length, cut) ? 1e9 : 0); // **FX-4:** התנאי הנכון""",
    'cg FX-4 score')

# ============ 6. retreat-loop.js — FX-2 (הפרה סטטית מופרדת מתנודה) ============
rep(R + 'layout/retreat-loop.js',
    """  const { pages, settings, ledger, eventLog, repairFns, assess } = ctx;
  const history = []; // [{signature}]
  let iteration = 0;""",
    """  const { pages, settings, ledger, eventLog, repairFns, assess } = ctx;
  const history = []; // [{signature}]
  // **FX-2 (דוח 06, שלב 5 — חילוץ שורש מ-#17):** האם רץ תיקון משנה-פריסה
  // (mutates !== false) באיטרציה שהקליטה כל חתימה. חתימה חוזרת בלי מוטציה
  // מאז שנראתה = הפרה סטטית (אין תיקון פעיל) — לא "תנודה בין תיקונים
  // מתחרים" (התווית ההיסטורית שקרה אבחונית: שום תיקון לא רץ ושום דבר לא
  // השתנה). גלאי התנודה יורה מעתה רק על תנודה אמיתית.
  const historyMutated = []; // [bool] מקביל ל-history
  let iteration = 0;""",
    'rl historyMutated')

rep(R + 'layout/retreat-loop.js',
    """    // זיהוי תנודה: החתימה חוזרת על עצמה בתוך חלון
    const recent = history.slice(-OSCILLATION_WINDOW);
    if (recent.some(h => h === signature)) {
      // ping-pong → הקפאת הפשרה הטובה ביותר שנצפתה.""",
    """    // זיהוי תנודה: החתימה חוזרת על עצמה בתוך חלון
    const recent = history.slice(-OSCILLATION_WINDOW);
    const repeatIdx = recent.findIndex(h => h === signature);
    if (repeatIdx !== -1) {
      const histIdx = history.length - recent.length + repeatIdx;
      if (!historyMutated[histIdx]) {
        // **FX-2:** הפרה סטטית — החתימה חוזרת בלי שאף תיקון משנה-פריסה רץ
        // מאז שנראתה. הקפאה מתועדת עם סיבה מדויקת (לא תיוג של תחרות שלא היתה).
        const persisted = recordRemaining(ledger, allViolations, 'protections', `static violation @iter${iteration} (no mutating repair)`, seen);
        const rec = ledger.create('rollback-compromise', `loop@iter${iteration}`, null, { signature, reason: 'static violation' }, 'protections');
        ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'violation persists unchanged — no mutating repair available (documented compromise)');
        eventLog.emit('protections', 'retreat-static', { iteration, signature });
        return { converged: false, iterations: iteration, compromise: rec.issue_id, persisted, frozenSignatures: history };
      }
      // ping-pong אמיתי (מוטציה רצה והחתימה חזרה) → הקפאת הפשרה הטובה ביותר שנצפתה.""",
    'rl static detection')

rep(R + 'layout/retreat-loop.js',
    """    history.push(signature);
    lastSignature = signature;""",
    """    history.push(signature);
    historyMutated.push(false);
    lastSignature = signature;""",
    'rl push mutated')

rep(R + 'layout/retreat-loop.js',
    """      repairFns[kind](ofKind, ctx);
      repairedAny = true;""",
    """      const fn = repairFns[kind];
      fn(ofKind, ctx);
      // **FX-2:** תיקון שמסומן mutates:false אינו משנה פריסה — אינו ראיה לתחרות
      if (fn.mutates !== false) historyMutated[historyMutated.length - 1] = true;
      repairedAny = true;""",
    'rl repair mutates flag')

print('ALL MODULE PATCHES APPLIED')
