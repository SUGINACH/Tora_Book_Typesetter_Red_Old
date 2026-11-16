// tests/layout/s5-unified-planner.test.js — שלב 5 פרוסה 1: בדיקות קבלה למתכנן המאוחד
// (הוראה §27 מותאמת לפרוסה; חילוץ שורש מאוחד מ-PR #16/#17).
// הוכחות: FX-1..FX-5 + flowCol + SSOT + טוהר המתכנן (אינו מודד/משנה מדדי שורה).
'use strict';

const { describe, it, assert, assertEq, report } = require('../harness');
const { planPages } = require('../../src/engine/layout/dp-planner');
const { generateCandidates } = require('../../src/engine/layout/candidate-generator');
const { runRetreatLoop } = require('../../src/engine/layout/retreat-loop');
const { assignFootnoteLanes } = require('../../src/engine/layout/footnote-lanes');
const { noteMetrics, getFootnotesReservedHeight } = require('../../src/engine/layout/footnote-budget');
const CM = require('../../src/engine/layout/constraint-matrix');
const { colCapacityOf } = require('../../src/engine/layout/column-flow');
const { Ledger } = require('../../src/engine/core/ledger');
const { EventLog } = require('../../src/engine/core/events');
const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

/** מדידת דמה דטרמיניסטית (entry יחיד של המתכנן — כמו env.measure בפרודקשן). */
const fakeMeasure = (t, sizePt) => String(t).length * 0.55 * (sizePt || 12) * (96 / 72);
fakeMeasure.impl = 'table';

/** בלוק סינתטי: n שורות בגובה hPx. */
function para(n, hPx, tokenId, extra = {}) {
  const lines = Array.from({ length: n }, (_, i) => ({
    words: [`${tokenId}-w${i}`], heightPx: hPx, widthPx: 100, isLast: i === n - 1, kind: 'paragraph', tokenId
  }));
  return { kind: 'paragraph', tokenId, lines, notes: [], part: 'p1', ...extra };
}
function heading(n, hPx, tokenId, level = 3) {
  const lines = Array.from({ length: n }, (_, i) => ({
    words: [`${tokenId}-h${i}`], heightPx: hPx, widthPx: 100, isLast: i === n - 1, kind: 'heading', level, tokenId
  }));
  return { kind: 'heading', tokenId, level, lines, notes: [], part: 'p1' };
}

/** הגדרות עם lineH ידוע (body 13pt × 1.5 ⇒ lineH=26) — כמו בניסוי FX בדוח 06. */
function fxSettings() {
  const s = getDefaultSettings();
  s['body-font-size-pt'] = 13;
  s['body-line-height'] = 1.5; // lineH = round(13 × 96/72 × 1.5) = 26
  return s;
}

describe('שלב 5 — מטריצת האילוצים (SSOT; חילוץ מ-#16/#17)', () => {
  it('חוזה: קבועים, חלון פיצול, תפר נקי, תפר מודע-ליווי, יתום-ביעד', () => {
    assertEq(CM.MIN_LINES_PER_SIDE, 2, 'MIN_LINES_PER_SIDE');
    assertEq(CM.ESCORT_MIN_LINES, 2, 'ESCORT_MIN_LINES');
    assertEq(CM.WIDOW_ORPHAN_MIN, 2, 'WIDOW_ORPHAN_MIN === MIN_LINES_PER_SIDE');
    assertEq(CM.CAPACITY_EPS, 0.5, 'CAPACITY_EPS');
    // **פרוסה 2 (חוזה החלון — מקור יחיד):** hi = min(lines−2, maxFit) — גם כלל
    // ≥2-לכל-צד וגם גבול הקיבולת בפועל. 5 שורות maxFit 2 ⇒ [2..2]; 5/3 ⇒ [2..3];
    // 10 שורות maxFit 3 ⇒ [2..3] (קיבולת כובלת); maxFit 1 ⇒ null (הזזה מלאה).
    assertEq(JSON.stringify(CM.legalSplitWindow(5, 2)), JSON.stringify({ lo: 2, hi: 2 }), 'window 5/2');
    assertEq(JSON.stringify(CM.legalSplitWindow(5, 3)), JSON.stringify({ lo: 2, hi: 3 }), 'window 5/3');
    assertEq(JSON.stringify(CM.legalSplitWindow(10, 3)), JSON.stringify({ lo: 2, hi: 3 }), 'window 10/3 — maxFit כובל');
    assertEq(CM.legalSplitWindow(3, 2), null, '3 שורות maxFit 2 — אין חלון');
    assertEq(CM.legalSplitWindow(5, 1), null, 'maxFit 1 — אין חלון');
    assertEq(CM.legalSplitWindow(10, 9), null, '10 שורות maxFit 9 — נשארת 1 ביעד — אין חלון');
    // מדיניות hard/soft מוכרזת (CONSTRAINT_POLICY)
    assertEq(CM.CONSTRAINT_POLICY.minLinesPerSide.type, 'hard', 'minLinesPerSide hard');
    assertEq(CM.CONSTRAINT_POLICY.strictDestMinimum.type, 'soft', 'strictDestMinimum soft');
    assertEq(CM.GAP_HEAD_POLICY, 'suppress-at-column-head', 'מדיניות פער בראש טור');
    // תפר נקי: אותה פסקה חוצה את הגבול עם ריצה בת שורה אחת מכל צד ⇒ לא נקי
    const mk = (tok, i) => ({ meta: { tokenId: tok }, words: [`w${i}`] });
    const seq = [mk('a', 1), mk('b', 1), mk('b', 2), mk('c', 1)];
    assertEq(CM.seamIsClean(seq, 2), false, 'widow: b חוצה עם שורה אחת מכל צד');
    assertEq(CM.seamIsClean(seq, 1), true, 'גבול בין פסקאות — נקי');
    const seq2 = [mk('b', 1), mk('b', 2), mk('b', 3), mk('b', 4)];
    assertEq(CM.seamIsClean(seq2, 2), true, 'ריצה בת 2+ מכל צד — נקי');
    // תפר מודע-ליווי: כותרת בתחתית col0 עם <2 שורות אחריה ⇒ לא נקי
    const seqH = [
      { kind: 'heading', meta: { tokenId: 'h' }, words: ['h'] },
      { kind: 'paragraph', meta: { tokenId: 'b' }, words: ['b1'] },
      { kind: 'paragraph', meta: { tokenId: 'c' }, words: ['c1'] }
    ];
    assertEq(CM.escortCleanBoundary(seqH, 2), false, 'כותרת עם שורה אחת בלבד אחריה');
    assertEq(CM.escortCleanBoundary(seqH, 3), true, 'הכותרת כולה ב-col0 עם 2 שורות');
    // מינימום ביעד (FX-4 + פרוסה 2 — strict כמדיניות רכה): פחות מ-2 נחסם
    // מראש על ידי החלון; בדיוק 2 (=המינימום החוקי) — מסומן לעונש strict.
    assertEq(CM.orphanAtDestination(6, 5), true, '5 נחתכות ⇒ 1 נותרת — מחוץ לחלון מיסודו');
    assertEq(CM.orphanAtDestination(6, 4), true, '4 נחתכות ⇒ בדיוק המינימום (2) — מסומן ל-strict');
    assertEq(CM.orphanAtDestination(6, 3), false, '3 נחתכות ⇒ 3 נותרות — מעל המינימום, לא מסומן');
    // מחסניות
    assertEq(CM.stackHeightPx([{ heightPx: 24.2 }, { heightPx: 24.2 }], 5), 53.4, 'stack עם פער כניסה');
    assertEq(CM.escortNeedLines(1, 5), 3, 'כותרת + 2 ליווי');
    assertEq(CM.escortNeedLines(1, 1), 2, 'כותרת + 1 (כל מה שיש)');
    assertEq(CM.widowOrphanPolicy({ 'prevent-widows-top': true, 'widow-strictness': 'strict' }).strictness, 'strict', 'מדיניות');
  });

  it('SSOT: footnote-lanes שקול ל-LPT ההיסטורי; noteMetrics נוסחה יחידה', () => {
    // שקילות מתמטית למימוש הקודם (גובה יורד, אינדקס עולה, חמדני לנמוך)
    for (const heights of [[], [10], [10, 20], [5, 5, 5], [30, 10, 20, 20, 5], [7, 7, 7, 7, 7, 7]]) {
      const notes = heights.map((h, i) => ({ heightPx: h, i }));
      const { lanes, totals } = assignFootnoteLanes(notes);
      const order = notes.map((n, i) => ({ i, h: n.heightPx })).sort((a, b) => b.h - a.h || a.i - b.i);
      const t = [0, 0]; const laneOf = new Map();
      for (const s of order) { const li = t[0] <= t[1] ? 0 : 1; t[li] += s.h; laneOf.set(s.i, li); }
      assertEq(Math.max(totals[0], totals[1]), Math.max(t[0], t[1]), 'totals שקולים: ' + JSON.stringify(heights));
      for (const n of notes) assertEq(lanes[0].includes(n.i), laneOf.get(n.i) === 0, 'אותו נתיב');
    }
    // noteMetrics — הנוסחה היחידה (0.8× גוף; פיץ' 1.25)
    const m = noteMetrics({ 'body-font-size-pt': 13 });
    assert(Math.abs(m.sizePt - 10.4) < 1e-9, 'sizePt');
    assertEq(m.lineHeightPx, Math.round(10.4 * (96 / 72) * 1.25), 'lineHeightPx');
    // תקציב 2 נתיבים דרך ה-SSOT
    const notes = [{ text: 'א א א', marker: 'א׳', heightPx: 30 }, { text: 'ב', marker: 'ב׳', heightPx: 20 }];
    const s = getDefaultSettings(); s['footnotes-enabled'] = true; s['footnote-columns'] = 2;
    assertEq(getFootnotesReservedHeight(notes, s, fakeMeasure), 30, '2 נתיבים: מקסימום הנתיבים');
  });
});

describe('שלב 5 — FX-5: קיבולת ב-yPx אמיתיים (אין עמוד ריק פנטום)', () => {
  it('בלוק שנכנס פיזית לעמוד ריק אינו נדחק לעמוד חדש', () => {
    const s = fxSettings();
    const ev = new EventLog(); const lg = new Ledger();
    // בלוק של 40 שורות × 25px = 1000+gap ≤ קיבולת (1030.5). בעבר: ensureRoom(40)
    // דרש 40×26−0.5=1039.5 > cap ⇒ פליטה לעמוד חדש ⇒ עמוד ריק. כעת: המחסנית
    // האמיתית 1000+gap ≤ cap ⇒ נשאר בעמוד.
    const r = planPages([para(40, 25, 'p1')], s, ev, lg, { measure: fakeMeasure });
    const emptyPages = r.pages.filter(p => !p.columns.some(c => c.length)).length;
    assertEq(r.pages.length, 1, 'עמוד אחד בלבד (בעבר: 2 — הראשון ריק פנטום)');
    assertEq(emptyPages, 0, 'אין עמודים ריקים');
  });

  it('מילוי פיזי אמיתי: שני טורים מתמלאים לפני מעבר עמוד; אין פער יחידות ואין חריגה', () => {
    const s = fxSettings();
    const ev = new EventLog(); const lg = new Ledger();
    // 30+30 שורות × 24.2 = 1452 > קיבולת טור (1030.5) אבל < שני טורים — שני הבלוקים
    // באותו עמוד (col0+col1). בעבר, עם המרת lineH, בלוק שלם שנכנס פיזית נדחק
    // לעמוד חדש (פנטום). הוכחה: עמוד אחד, שני טורים מלאים, אפס חריגות.
    const r = planPages([para(30, 24.2, 'fill'), para(30, 24.2, 'p2')], s, ev, lg, { measure: fakeMeasure });
    assertEq(r.pages.length, 1, 'עמוד אחד — שני הטורים קולטים את הזרימה (בעבר: פיצול פנטום)');
    assert(r.pages[0].columns.every(c => c.length > 0), 'שני הטורים בשימוש');
    const used0 = r.pages[0].columns[0].reduce((sm, l) => sm + l.heightPx, 0);
    assert(used0 > 700, 'הטור הראשון מלא פיזית: ' + Math.round(used0));
    // ארבעה בלוקים ⇒ שני עמודים (זרימה חוצת-עמודים עדיין עובדת)
    const r2 = planPages([para(30, 24.2, 'a'), para(30, 24.2, 'b'), para(30, 24.2, 'c'), para(30, 24.2, 'd')], s, new EventLog(), new Ledger(), { measure: fakeMeasure });
    assert(r2.pages.length === 2, 'ארבעה בלוקים ⇒ שני עמודים: ' + r2.pages.length);
    assert(r2.pages.every(p => p.columns.every(c => c.reduce((sm, l) => sm + l.heightPx, 0) <= colCapacityOf(p, { fnBudget: false }) + 0.51)), 'אין חריגת קיבולת');
  });
});

describe('שלב 5 — FX-1: ליווי כותרת מכוונת-הצבה (הבדיקה מחוברת להצבה)', () => {
  it('כותרת + ליווי מוצבים יחד בטור שאומת; אין כותרת יתומה', () => {
    const s = fxSettings();
    const ev = new EventLog(); const lg = new Ledger();
    // מילוי col0 עד 82.7px פנויים; אחר כך כותרת (37) + פער (5) + 2 ליווי (24.2+5, 24.2)
    // = 94.9 > 82.7 ⇒ עמוד חדש + הצבה מכוונת. בעבר: הבדיקה עברה ביחידות lineH
    // (3×26−0.5=77.5 ≤ 82.7) ואז pushLines פיצל את הליווי — כותרת יתומה מוכחת (FX-1).
    const fill = para(41, 24.2, 'fill'); // 41×24.2 = 992.2 + gap
    const h = heading(1, 37, 'hh', 3);
    const escort = para(6, 24.2, 'esc');
    const r = planPages([fill, h, escort], s, ev, lg, { measure: fakeMeasure });
    let found = null;
    for (let pi = 0; pi < r.pages.length && !found; pi++) {
      for (let ci = 0; ci < r.pages[pi].columns.length && !found; ci++) {
        const idx = r.pages[pi].columns[ci].findIndex(l => l.tokenId === 'hh' || (l.meta && l.meta.tokenId === 'hh'));
        if (idx >= 0) found = { page: r.pages[pi], col: ci, idx, pi };
      }
    }
    assert(found, 'הכותרת הוצבה');
    const col = found.page.columns[found.col];
    const after = col.slice(found.idx + 1).filter(l => l.kind !== 'heading');
    assert(after.length >= 2, '≥2 שורות ליווי אחרי הכותרת באותו טור (קיבלנו ' + after.length + ')');
    // אין הפרת heading-escort בעמוד הכותרת
    const { runProtections } = require('../../src/engine/layout/protections-matrix');
    const vs = runProtections(found.page, s, lg).violations.filter(v => v.kind === 'heading-escort');
    assertEq(vs.length, 0, 'אין heading-escort בעמוד הכותרת');
    // אירוע ההצבה המכוונת נרשם
    const events = ev.events.map(e => e.label);
    assert(events.includes('heading-escort-push') || events.includes('heading-escort-directed'), 'אירוע ליווי מתועד: ' + JSON.stringify(events.slice(0, 10)));
  });
});

describe('שלב 5 — flowCol: מונוטוניות טורים (סדר קריאה מבני)', () => {
  it('שורה אינה חוזרת לטור מוקדם אחרי שהזרימה התקדמה', () => {
    const s = fxSettings();
    const ev = new EventLog(); const lg = new Ledger();
    // בלוק גדול שגולש ל-col1, ואז בלוק קטן — בעבר יכול היה להיכנס לסוף col0
    const big = para(60, 24.2, 'big');
    const small = para(3, 24.2, 'small');
    const r = planPages([big, small], s, ev, lg, { measure: fakeMeasure });
    for (const pg of r.pages) {
      let maxCol = 0;
      for (let ci = 0; ci < pg.columns.length; ci++) {
        for (const ln of pg.columns[ci]) {
          assert(ci >= maxCol, `שורה ${ln.seq} בטור ${ci} אחרי שהזרימה הגיעה לטור ${maxCol} (עמוד ${pg.index})`);
        }
        if (pg.columns[ci].length) maxCol = Math.max(maxCol, ci);
      }
    }
  });
});

describe('שלב 5 — FX-3: הערות מחויבות בעמוד שורת הסמן (קולוקציה)', () => {
  it('סמן הערה וטקסט ההערה באותו עמוד — גם כשהפסקה נדחקת כולה לעמוד הבא', () => {
    const s = getDefaultSettings();
    s['footnotes-enabled'] = true;
    s['footnote-reset-policy'] = 'continuous';
    // פסקאות מילוי עד סוף העמוד; הפסקה עם ההערה לא נכנסת בשלמותה ואין פיצול חוקי
    // (הבנאי מייצר מסמך שבו הסמן בשורה האחרונה של פסקה ארוכה).
    const doc = ['שם הספר - בדיקת קולוקציה'];
    for (let i = 0; i < 40; i++) doc.push('פסקת מילוי מספר ' + i + ' עם טקסט אחיד למילוי העמודים והטורים בצורה יציבה.');
    const notePara = [];
    for (let i = 0; i < 14; i++) notePara.push('שורת גוף לפני הסמן מספר ' + i + ' עם עוד כמה מילים למילוי רוחב השורה בטור');
    const markerLine = 'וזו השורה עם הסמן [הערה שצריכה ללוות את הסמן שלה בעמוד שלו] ועוד מילים אחריה.';
    const doc2 = [...doc, ...notePara, markerLine, 'פסקת סיום אמיתית אחרי ההערה עם עוד טקסט לזרימה.'];
    const res = typeset(doc2.join('\n'), s);
    assert(res.contentPreserved, 'תוכן נשמר');
    // קולוקציה: לכל הערה במרזב, עמוד הסמן שלה === עמוד ההערה
    let checked = 0;
    for (let pi = 0; pi < res.pages.length; pi++) {
      const pg = res.pages[pi];
      for (const n of (pg.footnotes || [])) {
        if (n.tokenId == null) continue;
        // עמוד הופעת הסמן של אותו טוקן
        let markerPage = -1;
        for (let pj = 0; pj < res.pages.length && markerPage < 0; pj++) {
          const lines = [...(res.pages[pj].spanning ? res.pages[pj].spanning.lines : []), ...res.pages[pj].columns.flatMap(c => c)];
          if (lines.some(l => (l.tokenId === n.tokenId || (l.meta && l.meta.tokenId === n.tokenId)) && (l.words || []).some(w => String(w).includes('\uE102')))) markerPage = pj;
        }
        if (markerPage >= 0) {
          checked++;
          assertEq(pi, markerPage, `קולוקציה: הערה ${n.marker} בעמוד ${pi} אך סמנה בעמוד ${markerPage}`);
        }
      }
    }
    assert(checked >= 1, 'לפחות הערה אחת נבדקה: ' + checked);
  });
});

describe('שלב 5 — FX-2: הפרדת הפרה סטטית מתנודה בלולאת הנסיגה', () => {
  it('הפרה סטטית עם תיקון רישום-בלבד ⇒ retreat-static, לא תנודה', () => {
    const ledger = new Ledger();
    const ev = new EventLog();
    const page = {
      index: 0, type: 'regular', chapterOpening: false, terminalResidual: false,
      template: { contentBox: { height: 1000 }, columns: [{ w: 300 }, { w: 300 }] },
      columns: [
        [{ meta: { tokenId: 'a', part: 'first' }, words: ['x'], heightPx: 20, seq: 0, widthPx: 10, measureW: 300, kind: 'paragraph' }],
        []
      ],
      footnotes: [], sideNotes: [], fnReservedHeightPx: 0
    };
    const noRepair = (violations, c) => { // widow-bottom: קיים בסדר התיקונים של הלולאה
      for (const v of violations) {
        const rec = c.ledger.issues.get(v.ledgerRef);
        if (rec) c.ledger.transition(rec.issue_id, 'correction-blocked', 'protections', 'ledger-only');
      }
    };
    noRepair.mutates = false;
    const assess = (pg, s, lg) => {
      // הפרה סטטית קבועה — widow-bottom (קיים בסדר התיקונים של הלולאה)
      const rec = lg.create('widow-bottom', 'p0c0', 0, {}, 'protections');
      return [{ kind: 'widow-bottom', target: 'page#0c0', page: 0, evidence: {}, ledgerRef: rec.issue_id }];
    };
    const r = runRetreatLoop({ pages: [page], settings: {}, ledger, eventLog: ev, repairFns: { 'widow-bottom': noRepair }, assess });
    const events = ev.events.map(e => e.label);
    assert(events.includes('retreat-static'), 'אירוע retreat-static נרשם (לא oscillation-detected): ' + JSON.stringify(events));
    assert(!events.includes('oscillation-detected'), 'אין תיוג תנודה שקרי');
    assertEq(r.converged, false, 'לא התכנס — הפרה אמיתית נשארת');
    const kinds = [...ledger.issues.values()].filter(x => x.kind === 'rollback-compromise');
    assert(kinds.length >= 1, 'פשרה מתועדת');
    const reason = JSON.stringify([...ledger.issues.values()].map(x => x.status));
    assert(reason.includes('correction-blocked'), 'הסיבה: correction-blocked (סטטית) — ' + reason.slice(0, 120));
  });
});

describe('שלב 5 — FX-4: עונש strict חי (חלון מועמדים)', () => {
  it('widow-strictness=strict מעניש חיתוך שמשאיר יתום ביעד; normal אינו', () => {
    const blk = { tokenId: 't1', lines: Array.from({ length: 6 }, () => ({ heightPx: 20, words: ['w'] })), lineHeightPx: 20 };
    const strict = generateCandidates(blk, 4, 500, { 'widow-strictness': 'strict', 'grid-block-gap-pct': 0 }, null);
    const normal = generateCandidates(blk, 4, 500, { 'widow-strictness': 'normal', 'grid-block-gap-pct': 0 }, null);
    const scoreOf = (arr, cut) => { const c = arr.find(x => x.cut === cut); if (!c) throw new Error('cut ' + cut + ' אינו בחלון: ' + JSON.stringify(arr.map(x => x.cut))); return c.score; };
    // **פרוסה 2 (strict כמדיניות רכה מוכרזת):** החלון [2..4] חוסם מראש חיתוך
    // שמשאיר <2 ביעד; strict מעניש 1e9 את מי שמשאיר **בדיוק את המינימום** (cut=4
    // משאיר 2) — ואינו מעניש חיתוך עמוק יותר (cut=3 משאיר 3).
    assert(scoreOf(strict, 4) > 1e8, 'strict: מינימום חוקי ביעד מעונש (' + scoreOf(strict, 4) + ')');
    assert(scoreOf(normal, 4) < 1e3, 'normal: ללא עונש (' + scoreOf(normal, 4) + ')');
    assert(scoreOf(strict, 3) < 1e3, 'strict: חיתוך עמוק (3 נותרות) אינו מעונש');
    // חיתוך שמשאיר 1 ביעד (cut=5) אינו קיים כלל — החלון חוסם אותו מראש
    assert(!strict.some(c => c.cut === 5), 'cut=5 מחוץ לחלון — לא נוצר כלל');
    // maxFit חי: מועמד שחורג מהמקום הפנוי נדחה (חילוץ #16) — החלון עצמו כובל
    const capped = generateCandidates(blk, 3, 500, { 'grid-block-gap-pct': 0 }, null);
    assert(!capped.some(c => c.cut > 3), 'אף מועמד מעל maxFit');
    assert(capped.length > 0, 'יש מועמדים חוקיים בטווח');
  });
});

describe('שלב 5 — טוהר המתכנן (§27: אין מדידה מחדש ואין שינוי מדדי שורה)', () => {
  it('לכל שורה בפלט: המדדים זהים ל-LineModel וההתייחסות נשמרת', () => {
    const doc = 'שם הספר - טוהר המתכנן\n' + 'פסקה עם הערה [הערה לטוהר] וטקסט לבדיקת שימור המדדים.\n'.repeat(8) + 'פסקת סיום אמיתית.\n';
    const res = typeset(doc, getDefaultSettings());
    let checked = 0;
    for (const pg of res.pages) {
      for (const col of pg.columns) {
        for (const ln of col) {
          if (!ln.lineModel) continue;
          checked++;
          assertEq(ln.heightPx, ln.lineModel.lineHeightPx, 'הגובה לא שונה על ידי המתכנן');
          assertEq(ln.widthPx, ln.lineModel.naturalWidthPx, 'הרוחב הטבעי לא שונה');
          assert(Array.isArray(ln.words) && ln.words.length > 0, 'המילים נגזרות ולא נבנו מחדש');
        }
      }
    }
    assert(checked > 5, 'שורות נבדקו: ' + checked);
    assertEq(res.contentPreserved, true, 'תוכן נשמר');
  });
});

report('s5-unified-planner');
