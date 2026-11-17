#!/usr/bin/env python3
# patch-dp-planner.py — שלב 5 פרוסה 1: dp-planner — FX-1/FX-3/FX-5 + flowCol
# + שמירת עמוד ריב + חותמי זנב + FX-2 mutates + findSplit מהמטריצה.
# מריץ משורש הריפו; עוגנים חד-ערכיים בלבד.
import sys

P = 'red-build/src/engine/layout/dp-planner.js'

def rep(old, new, label):
    global s
    if old not in s:
        print('MISSING:', label); sys.exit(1)
    if s.count(old) != 1:
        print('NOT-UNIQUE:', label, s.count(old)); sys.exit(1)
    s = s.replace(old, new, 1)
    print('ok:', label)

s = open(P).read()

# ---- יבואים ----
rep("const { getFootnotesReservedHeight, noteHeight } = require('./footnote-budget');",
    "const { getFootnotesReservedHeight, noteHeight, noteMetrics } = require('./footnote-budget'); // **שלב 5:** noteMetrics — מקור יחיד למדדי ההערה (חילוץ מ-#16)\nconst CM = require('./constraint-matrix'); // **שלב 5:** מטריצת האילוצים המאוחדת (חילוץ שורש מ-#16/#17)",
    'imports')
rep("const { blockGapPx, colCapacityOf } = require('./column-flow');",
    "const { blockGapPx, colCapacityOf, planningUsedHeight } = require('./column-flow'); // **שלב 5:** planningUsedHeight — מקור יחיד לגובה התפוס בזמן תכנון (חילוץ מ-#16)",
    'import column-flow')
rep("const { MARK_TAG } = require('../notes/markers');",
    "const { MARK_TAG } = require('../notes/markers'); // markerFragmentOf אינו נדרש כאן — הזיהוי לפי MARK_TAG ישירות (תבנית D-53)",
    'import markers')

# ---- usedHeight — מקור יחיד ----
rep("""  function usedHeight(col, page = cur) {
    let h = col.reduce((s, ln) => s + (ln.heightPx || 0), 0);
    if (page && page.fnReservedHeightPx > 0 && page.columns[page.columns.length - 1] === col) {
      h += page.fnReservedHeightPx; // נשמר פעם אחת — בסוף הטור האחרון
    }
    return h;
  }""",
    """  // **שלב 5 (חילוץ שורש מ-#16):** גובה תפוס בזמן תכנון — מקור יחיד
  // (column-flow.planningUsedHeight); סמנטיקת הרינדור (עם aqStretch) חיה
  // ב-balancing.usedHeight — שני דגלים, שני מקורות מתועדים.
  const usedHeight = (col, page = cur) => planningUsedHeight(col, page);""",
    'usedHeight -> planningUsedHeight')

# ---- FX-1 + flowCol: מצב + איפוס בעמוד חדש ----
rep("""  function newPage(type = PAGE_TYPES.REGULAR) {
    const isRecto = pages.length % 2 === 0; // עמוד 1 = recto""",
    """  // **FX-1 (דוח 06, שלב 5 — חילוץ שורש מ-#17):** נעילת ליווי — הטור שאומת
  // למחסנית כותרת+ליווי הוא startCol של ההצבה עד השלמת שורות הליווי;
  // נאפס בכל עמוד חדש.
  let escortLockCol = 0;
  let escortLinesNeeded = 0;
  // **שלב 5 (אילוץ קשה — סדר קריאה מבני):** מונוטוניות טורים לאורך הזרימה —
  // אחרי ששורה כלשהי הוצבה בטור c, שורות המשך באותו עמוד אינן רשאיות לחזור
  // לטור מוקדם ממנו (הקריאה עוברת col0 מלמעלה למטה ואז col1). בלי זה, המילוי
  // החמדני של pushLines יכול להכניס שורה מאוחרת לסוף col0 אחרי שהזרימה כבר
  // עברה ל-col1 (נמדד: 49 הפרות reading-order ב-very_long לאחר FX-5 — האריזה
  // הצפופה חשפה את הפגם שהיה קיים אך נדיר). תיקון השורש: האילוץ חי בהצבה
  // עצמה, לא בגילוי לאחר המעשה (protections).
  let flowCol = 0;

  function newPage(type = PAGE_TYPES.REGULAR) {
    escortLockCol = 0;
    escortLinesNeeded = 0;
    flowCol = 0;
    const isRecto = pages.length % 2 === 0; // עמוד 1 = recto""",
    'escort + flow state')

# ---- FX-5: ensureRoomFor ----
rep("""  function ensureRoom(neededLines, opts = {}) {
    void opts;
    const cap = colCapacity(cur.template, cur);
    for (let c = 0; c < cur.columns.length; c++) {
      if (cap - usedHeight(cur.columns[c], cur) >= neededLines * lineH - 0.5) return c;
    }
    return -1;
  }""",
    """  /**
   * **FX-5 (דוח 06, שלב 5 — חילוץ שורש מ-#17):** בדיקת קיבולת ב-yPx אמיתיים.
   * הגרסה ההיסטורית (`ensureRoom(neededLines)`) מדדה `neededLines × lineH`
   * בעוד ההצבה צורכת heightPx — פער היחידות יצר עמודים ריקים פנטום (בלוק
   * שנכנס פיזית "נכשל" בבדיקה — FX-5) ובדיקות ליווי שקרסו על כותרות גבוהות
   * מ-lineH (FX-1). המחסנית כוללת את פער הכניסה של הבלוק (CM.stackHeightPx).
   */
  function ensureRoomFor(stackPx, fromCol = 0) {
    const cap = colCapacity(cur.template, cur);
    for (let c = fromCol; c < cur.columns.length; c++) {
      if (cap - usedHeight(cur.columns[c], cur) >= stackPx - CM.CAPACITY_EPS) return c;
    }
    return -1;
  }""",
    'ensureRoom -> ensureRoomFor')

# ---- pushLines: startCol + flowCol ----
rep("""  function pushLines(lines, meta = {}) {
    // grid-block-gap-pct: מרווח בין־בלוקי נצרך כאן — שורה ראשונה של בלוק חדש
    // סופגת את ה‑gap (פרופורציונלי לגובה שורה), כך שתקציב הטור כולל אותו.
    const gap = meta.firstOfBlock ? blockGapPx(settings, lineH) : 0;
    let pendingGap = gap;
    for (const ln of lines) {
      let placed = false;
      for (let c = 0; c < cur.columns.length && !placed; c++) {
        const needPx = ln.heightPx + pendingGap - 0.5;
        if (colCapacity(cur.template, cur) - usedHeight(cur.columns[c], cur) >= needPx) {
          cur.columns[c].push({ ...ln, meta, seq: seqCounter++ });
          pendingGap = 0;
          placed = true;
        }
      }""",
    """  function pushLines(lines, meta = {}, opts = {}) {
    // grid-block-gap-pct: מרווח בין־בלוקי נצרך כאן — שורה ראשונה של בלוק חדש
    // סופגת את ה‑gap (פרופורציונלי לגובה שורה), כך שתקציב הטור כולל אותו.
    // **FX-1 (דוח 06, שלב 5):** startCol — הצבה מכוונת-ליווי: הטור שאומת
    // למחסנית כותרת+ליווי הוא נקודת הפתיחה. סדר הקריאה נשמר מבנית — אין
    // הצבה לטור מוקדם יותר מנקודת הפתיחה.
    const startCol = Math.max(0, Math.min(opts.startCol != null ? opts.startCol : escortLockCol, cur.columns.length - 1));
    const gap = meta.firstOfBlock ? blockGapPx(settings, lineH) : 0;
    let pendingGap = gap;
    for (const ln of lines) {
      let placed = false;
      // **שלב 5 (סדר קריאה מבני):** החיפוש מתחיל בטור הזרימה הנוכחי — שום
      // שורה אינה חוזרת לטור מוקדם מהזרימה (ראה flowCol לעיל).
      for (let c = Math.max(startCol, flowCol); c < cur.columns.length && !placed; c++) {
        const needPx = ln.heightPx + pendingGap - 0.5;
        if (colCapacity(cur.template, cur) - usedHeight(cur.columns[c], cur) >= needPx) {
          cur.columns[c].push({ ...ln, meta, seq: seqCounter++ });
          pendingGap = 0;
          placed = true;
          flowCol = Math.max(flowCol, c); // מונוטוניות הזרימה
          // **FX-1:** נעילת ליווי — שורות גוף ראשונות אחרי הכותרת מקריעות את
          // המונה; בהשלמת שורות הליווי — שחרור הנעילה (ההצבה חוזרת לזרימה חופשית).
          if (escortLinesNeeded > 0 && ln.kind !== 'heading') {
            escortLinesNeeded--;
            if (escortLinesNeeded === 0) escortLockCol = 0;
          }
        }
      }""",
    'pushLines startCol+flowCol')

# ---- FX-3: reserveNotes מחזיר תמונת-מצב ----
rep("""  const pendingBarNotes = [];
  function reserveNotes(blk) {
    const notes = (blk.notes || []);
    if (!notes.length) return;""",
    """  const pendingBarNotes = [];
  function reserveNotes(blk) {
    const notes = (blk.notes || []);
    if (!notes.length) return null;
    // **FX-3 (דוח 06, שלב 5):** תמונת-מצב לשחזור דטרמיניסטי — ההתחייבות
    // חייבת להיות הפיכה כל עוד הפסקה עודנה בהכרעת מיקום. snap.clean=false
    // אחרי פעולות בעלות תופעות לוואי (פיצול/העברה/החזרה לגוף) — אין שחזור
    // אחריהן (המשכים שנוצרו, מצב הבלוק וה-ledger אינם הפיכים בבטחה).
    const snap = { clean: true, footLenBefore: cur.footnotes.length, fnBefore: cur.fnReservedHeightPx || 0, pendingBefore: pendingBarNotes.slice() };""",
    'reserveNotes snapshot')

rep("""          pendingBarNotes.push({ ...n, text: restText, isContinuation: true, continuationOf: n.tokenId, mode: 'split-rest' });
          eventLog.emit('notes-budget', 'fn-split', { token: n.tokenId, marker: n.marker, barMax, firstWords: cutIdx }, cur.index);
          continue;""",
    """          pendingBarNotes.push({ ...n, text: restText, isContinuation: true, continuationOf: n.tokenId, mode: 'split-rest' });
          snap.clean = false; // נוצר המשך חדש — אין שחזור בטוח
          eventLog.emit('notes-budget', 'fn-split', { token: n.tokenId, marker: n.marker, barMax, firstWords: cutIdx }, cur.index);
          continue;""",
    'snap dirty: split')

rep("""        if (settings['long-footnote-policy'] === 'move-whole') {
          pendingBarNotes.push({ ...n, mode: 'moved-whole', deferredToNextPage: true });
          eventLog.emit('notes-budget', 'fn-moved-whole', { token: n.tokenId, marker: n.marker }, cur.index);
          continue;
        }""",
    """        if (settings['long-footnote-policy'] === 'move-whole') {
          pendingBarNotes.push({ ...n, mode: 'moved-whole', deferredToNextPage: true });
          snap.clean = false; // הועברה לעמוד הבא — אין שחזור בטוח
          eventLog.emit('notes-budget', 'fn-moved-whole', { token: n.tokenId, marker: n.marker }, cur.index);
          continue;
        }""",
    'snap dirty: move-whole')

rep("""        if (settings['long-footnote-policy'] === 'reject-to-body' && rejectToBody(n, `bar overflow ${h}>${barMax}`)) continue;""",
    """        if (settings['long-footnote-policy'] === 'reject-to-body' && rejectToBody(n, `bar overflow ${h}>${barMax}`)) {
          snap.clean = false; // מוטציית בלוק+lines — אין שחזור בטוח
          continue;
        }""",
    'snap dirty: reject-to-body')

rep("""    recomputeFnBudget(cur); // probe==reserved — פונקציה אחת (unified) לשני הצרכים
  }""",
    """    recomputeFnBudget(cur); // probe==reserved — פונקציה אחת (unified) לשני הצרכים
    return snap;
  }

  /**
   * **FX-3 (דוח 06, שלב 5):** שחזור דטרמיניסטי של התחייבות הערות — רק מנתיב
   * snap.clean (המשכים קודמים מוחזרים לתור; פעולות עם תופעות לוואי אינן הפיכות).
   */
  function uncommitNotes(page, snap) {
    page.footnotes.length = snap.footLenBefore;
    page.fnReservedHeightPx = snap.fnBefore;
    pendingBarNotes.length = 0;
    for (const p of snap.pendingBefore) pendingBarNotes.push(p);
  }

  /** **FX-3:** אינדקס שורת הסמן הראשונה של הבלוק (-1 אם אין). */
  function firstMarkerLineOf(blk) {
    return (blk.lines || []).findIndex(ln => (ln.words || []).some(w => String(w).includes(MARK_TAG)));
  }

  /**
   * **FX-3 (דוח 06, שלב 5):** התחייבות הערות בעמוד שבו שורת הסמן עומדת להיות
   * מוצבת, עם נסיגה דטרמיניסטית חד-פעמית אם התקציב חסם את שורת הסמן. F-17
   * נשמר לעמוד ההערה: התקציב נסגר בטרם שורת הסמן ושארית שורות הבלוק.
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
  }""",
    'FX-3 helpers')

# ---- הסרת ההתחייבות המוקדמת ----
rep("""    // תקציב הערות לפני מיקום (F-17 probe==reserved, כולל מדיניות הערה ארוכה)
    if (blk.kind === 'paragraph') reserveNotes(blk);""",
    """    // **FX-3 (דוח 06, שלב 5 — תיקון שורש):** התחייבות ההערות הועברה להכרעת
    // המיקום (להלן, אחרי ensureRoomFor/findSplit) — בעבר רצה כאן, לפני שהיה
    // ידוע היכן הפסקה תוצב: פסקה שנדחקה כולה לעמוד הבא הותירה את הערותיה
    // מאחור (סמן בעמוד N+1, טקסט ההערה במרזב עמוד N — הוכח בדוח 06, FX-3;
    // אף בדיקת הגנה לא זיהתה זאת: המילים כולן קיימות, רק הקולוקציה הופרה).""",
    'remove early reserveNotes')

# ---- הערות פסקת-צד לפני continue ----
rep("""      if (cs.layoutMode === 'side-note' && blk.asSideNote) {
        // הפסקה הופכת הערת צד מעוגנת לפסקה הבאה שאחריה (המארחת) — דפוס H7
        const host = blocks.slice(bi + 1).find(b => b.kind === 'paragraph' && !(b.customStyle && b.customStyle.layoutMode === 'side-note'));""",
    """      if (cs.layoutMode === 'side-note' && blk.asSideNote) {
        // הפסקה הופכת הערת צד מעוגנת לפסקה הבאה שאחריה (המארחת) — דפוס H7
        // **FX-3:** הערות פנימיות של פסקת צד מחויבות כאן — הענף continue
        // מדלג על ההצבה הרגילה (התנהגות קודמת נשמרת).
        if ((blk.notes || []).length) reserveNotes(blk);
        const host = blocks.slice(bi + 1).find(b => b.kind === 'paragraph' && !(b.customStyle && b.customStyle.layoutMode === 'side-note'));""",
    'side-note notes commit')

# ---- FX-1: ליווי מכוון-הצבה ----
rep("""    if (blk.kind === 'heading' && blk.level <= 6) {
      const following = (next && next.lines) ? next.lines.length : 0;
      if (following >= 1) {
        const needLines = 1 + Math.min(2, following); // כותרת + 2 שורות ליווי (או כמה שיש)
        let room = ensureRoom(needLines);
        if (room === -1) {
          flushPage(); cur = newPage(blk.level === 2 ? PAGE_TYPES.SIGN_OPEN : PAGE_TYPES.REGULAR);
          room = ensureRoom(needLines);
          if (room !== -1) {
            eventLog.emit('page-plan', 'heading-escort-push', { token: blk.tokenId, page: cur.index }, cur.index);
          } else {
            const rec = ledger.create('heading-escort', blk.tokenId, cur.index, { linesNeeded: needLines, capacityPx: colCapacity(cur.template, cur), lineHPx: lineH }, 'protections');
            ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'no column fits heading+escort even on fresh page (oversized block)');
          }
        }
      }
    }""",
    """    if (blk.kind === 'heading' && blk.level <= 6) {
      const following = (next && next.lines) ? next.lines.length : 0;
      if (following >= 1) {
        // **FX-1/FX-5 (דוח 06, שלב 5):** הבדיקה מודדת את המחסנית הפיזית האמיתית
        // (CM.escortStackHeightPx — גבהי הכותרת + פערי כניסה + שורות הליווי)
        // ותוצאתה מנוצלת להצבה מכוונת (escortLockCol/startCol) — בדיקה שאינה
        // קשורה להצבה יוצרת כותרות יתומות שאין להן תיקון (הוכח: FX-1 בדוח 06).
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
    }""",
    'FX-1 escort directed')

# ---- FX-5 + FX-3 + שמירת עמוד ריק במסלול ההצבה ----
rep("""    // REQ-BAL-01: candidate search עם capacityBefore/capacityAfter + הקשר הבלוק הבא
    const need = blk.lines.length;
    let chosenCol = ensureRoom(need);
    if (chosenCol === -1) {
      const splitAt = findSplit(blk, cur, colCapacity, usedHeight, lineH, ledger, eventLog, settings, generateCandidates);
      if (splitAt > 0) {
        pushLines(blk.lines.slice(0, splitAt - 1), { tokenId: blk.tokenId, part: 'first' });
        pushLines([blk.lines[splitAt - 1]], { tokenId: blk.tokenId, part: 'first', isLast: true });
        flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
        pushLines(blk.lines.slice(splitAt), { tokenId: blk.tokenId, part: 'rest' });
        continue;
      }
      flushPage(); cur = newPage(PAGE_TYPES.REGULAR);
      chosenCol = 0;
    }
    pushLines(blk.lines, { tokenId: blk.tokenId, firstOfBlock: true, docPart: blk.part });""",
    """    // REQ-BAL-01: candidate search עם capacityBefore/capacityAfter + הקשר הבלוק הבא
    // **FX-5 (דוח 06, שלב 5):** הקיבולת נמדדת ב-yPx אמיתיים (גבהים + פער כניסה)
    // — לא בהמרת lineH; בלוק שנכנס פיזית לא יידחק עוד לעמוד חדש (עמוד ריק פנטום).
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
      // **FX-5/#16 — שמירת עמוד ריק:** אם העמוד ריק משורות גוף — אין טעם לאטום
      // אותו; הבלוק נכנס לכאן (בעבר נאטם עמוד ריק עם הערות יתומות).
      if (cur.columns.some(c => c.length)) {
        flushPage();
        cur = newPage(PAGE_TYPES.REGULAR);
      }
      chosenCol = 0;
    }
    // **FX-3 (דוח 06, שלב 5):** התחייבות ההערות בעמוד שבו שורת הסמן נוחתת
    // בפועל. שורות שלפני הסמן ממלאות את העמודים הקודמים בלי תקציב (ההערה
    // לא תשהה שם); התקציב נסגר בטרם שורת הסמן ושארית השורות — F-17 נשמר
    // לעמוד ההערה.
    const hasNotes = blk.kind === 'paragraph' && (blk.notes || []).length && settings['footnotes-enabled'];
    const mIdx = hasNotes ? Math.max(0, firstMarkerLineOf(blk)) : 0;
    if (hasNotes && mIdx > 0) {
      pushLines(blk.lines.slice(0, mIdx), { tokenId: blk.tokenId, firstOfBlock: true, docPart: blk.part }, { startCol: escortLockCol });
    }
    if (hasNotes) reserveAtMarker(blk, mIdx > 0 ? blk.lines[mIdx] : null);
    pushLines(blk.lines.slice(mIdx), { tokenId: blk.tokenId, docPart: blk.part, ...(mIdx > 0 ? {} : { firstOfBlock: true }) }, { startCol: escortLockCol });""",
    'FX-5+FX-3+empty-guard placement')

# ---- חותמי זנב + אבחון ניקוז ----
rep("""  if (pendingBarNotes.length) {
    const last = pages[pages.length - 1];
    for (const n of pendingBarNotes) {
      last.footnotes.push({ ...n }); // mode/isContinuation preserved (moved-whole stays whole)
    }""",
    """  if (pendingBarNotes.length) {
    const last = pages[pages.length - 1];
    const { lineHeightPx: tailLineH } = noteMetrics(settings); // **שלב 5 (#16):** מקור יחיד למדדי ההערה
    for (const n of pendingBarNotes) {
      // **שלב 5 (חילוץ שורש מ-#16 — חותמי מדדים בניקוז הזנב):** התקציב
      // (recomputeFnBudget) מחשב את הגובה מ-noteHeight ממילא, אך ההקרנה
      // צורכת את n.heightPx/n.lineH — בלי החותמים, המשך שנדחף לסוף המסמך
      // מתקדם שורה אחת בלבד ושורותיו חופפות את ההערה שאחריו (תקציב≠הקרנה —
      // בדיוק מחלקת הכשל ש-S70/S71.1 רדפו אחריה).
      last.footnotes.push({
        ...n, // mode/isContinuation preserved (moved-whole stays whole)
        ...(n.heightPx != null ? {} : { heightPx: noteHeight(n, settings, measureFn) }),
        ...(n.lineH != null ? {} : { lineH: tailLineH })
      });
    }""",
    'tail metrics stamping')

# ---- FX-2: repairFns עם mutates:false ----
rep("""    repairFns: {
      'column-imbalance': (violations, c) => {
        for (const v of violations) {
          const pg = pages.find(p => `page#${p.index}` === v.target);
          if (pg) balancePageSafe(pg, c.settings, c.ledger);
        }
      },
      'reading-order-break': (violations, c) => {
        for (const v of violations) {
          const rec = c.ledger.issues.get(v.ledgerRef);
          if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'line moved backward in reading order (bug-guard P0-3; not auto-repaired)');
        }
      },
      'widow-bottom': (violations, c) => {
        for (const v of violations) {
          const rec = c.ledger.issues.get(v.ledgerRef);
          if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'no legal split exists (documented compromise)');
        }
      },
      'orphan-top': (violations, c) => {
        for (const v of violations) {
          const rec = c.ledger.issues.get(v.ledgerRef);
          if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'no legal split exists (documented compromise)');
        }
      }
    },""",
    """    repairFns: (() => {
      // **FX-2 (דוח 06, שלב 5):** תיקוני רישום-בלבד מסומנים mutates:false —
      // לולאת הנסיגה לא תתייג עוד הפרה סטטית (שאין לה תיקון פעיל) כ"תנודה
      // בין תיקונים מתחרים". התווית ההיסטורית היתה אבחון שקרי: שום תיקון לא רץ.
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
      return {
        'column-imbalance': (violations, c) => {
          for (const v of violations) {
            const pg = pages.find(p => `page#${p.index}` === v.target);
            if (pg) balancePageSafe(pg, c.settings, c.ledger);
          }
        },
        'reading-order-break': markReadingOrderBlocked,
        'widow-bottom': markNoLegalSplit,
        'orphan-top': markNoLegalSplit
      };
    })(),""",
    'FX-2 mutates:false')

# ---- findSplit: maxFit אמיתי + חלון מהמטריצה ----
rep("""  const cap = colCapacity(cur.template, cur);
  const free = cap - usedHeight(cur.columns[cur.columns.length - 1], cur);
  const maxFit = Math.floor(free / lineH);
  if (maxFit < 2 || blk.lines.length - maxFit < 2) return 0; // אין פיצול חוקי → הזזה מלאה""",
    """  const cap = colCapacity(cur.template, cur);
  const free = cap - usedHeight(cur.columns[cur.columns.length - 1], cur);
  // **FX-5 (דוח 06, שלב 5):** maxFit נספר מהגבהים האמיתיים — לא מהמרת lineH;
  // המרת היחידות ההיסטורית פסלה פיצולים חוקיים (גם כאן, לא רק ב-ensureRoom).
  const firstFit = Math.floor(free / lineH);
  let maxFit = firstFit;
  while (maxFit > 0 && maxFit * lineH > free) maxFit--;
  // **שלב 5 (#16):** חלון הפיצול החוקי — מקור יחיד (constraint-matrix.legalSplitWindow):
  // ≥2 שורות לכל צד (SRS §5.1). null ⇒ אין פיצול חוקי → הזזה מלאה.
  if (!CM.legalSplitWindow(blk.lines.length, maxFit)) return 0; // אין פיצול חוקי → הזזה מלאה""",
    'findSplit real-px + window')

open(P, 'w').write(s)
print('DP-PLANNER: ALL PATCHES APPLIED')

# ---- אבחון ניקוז זנב (אחרי הכתיבה — תוספת נפרדת) ----
s = open(P).read()
old_tail = """    recomputeFnBudget(last);
    eventLog.emit('notes-budget', 'fn-tail-continuation', { count: pendingBarNotes.length, page: last.index }, last.index);
    pendingBarNotes.length = 0;"""
new_tail = """    recomputeFnBudget(last);
    // **שלב 5 (אין fallback שקט):** ההמשכים חייבים להישמר (BRZ-15 — אין אובדן
    // תוכן), אך אם תקציבם חורג מקיבולת העמוד האחרון — נרשם אבחון מפורש
    // (fn-tail-overflow) במקום גלישה שקטה. זהו מצב פתולוגי מבני (המשכים
    // שנצברו בסוף המסמך); לתקנת השורש המלאה נדרש מנגנון עמודי-גלישה להערות
    // — שלב B של התוכנית (דוח 06).
    const tailCap = colCapacityOf(last, { fnBudget: false });
    const tailUsed = planningUsedHeight(last.columns[last.columns.length - 1], last);
    if (tailUsed > tailCap + CM.CAPACITY_EPS) {
      const rec = ledger.create('fn-tail-overflow', `tail@p${last.index}`, last.index,
        { usedPx: Math.round(tailUsed), capPx: Math.round(tailCap), notes: pendingBarNotes.length }, 'notes-budget');
      ledger.transition(rec.issue_id, 'persists', 'notes-budget', 'tail continuations exceed last-page capacity (structural; documented — stage B)');
    }
    eventLog.emit('notes-budget', 'fn-tail-continuation', { count: pendingBarNotes.length, page: last.index }, last.index);
    pendingBarNotes.length = 0;"""
assert old_tail in s, 'tail drain anchor'
s = s.replace(old_tail, new_tail, 1)
open(P, 'w').write(s)
print('ok: tail overflow diagnostic')
