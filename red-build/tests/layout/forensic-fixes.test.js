// tests/layout/forensic-fixes.test.js — רגרסיות דוח 06 (2026-11-15):
// FX-1 הצבה מכוונת-ליווי | FX-2 אבחון סטטי מול תנודה | FX-3 התחייבות הערות בעמוד הסמן
// FX-4 עונש strict חי | FX-5 קיבולת ב-yPx (אין עמוד ריק פנטום) | FX-6 תיעוד gap
// דוח מלא: audits/06_FORENSIC_UNIFICATION_AUDIT_2026-11-15.md (פרק 4 — הוכחות, פרק 5 — שלב A).
'use strict';
const { describe, it, assert, assertEq, report } = require('../harness');
const { planPages } = require('../../src/engine/layout/dp-planner');
const { runRetreatLoop } = require('../../src/engine/layout/retreat-loop');
const { generateCandidates } = require('../../src/engine/layout/candidate-generator');
const { optimalSplit } = require('../../src/engine/layout/balancing');
const { runProtections } = require('../../src/engine/layout/protections-matrix');
const CM = require('../../src/engine/layout/constraint-matrix');
const { Ledger } = require('../../src/engine/core/ledger');
const { EventLog } = require('../../src/engine/core/events');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { buildPageTemplate } = require('../../src/engine/layout/page-templates');

const measure = (t) => t.length * 6; // מודד סינתטי דטרמיניסטי (כמו s5-s6)
const LINE_H = Math.round(getDefaultSettings()['body-font-size-pt'] * (96 / 72) * getDefaultSettings()['body-line-height']);
const CAP = buildPageTemplate('regular', getDefaultSettings(), true).contentBox.height;

const mk = (n, tok, hpx, tokId) => Array.from({ length: n }, (_, i) => ({
  words: [tok + i], widthPx: 200, heightPx: hpx, isLast: i === n - 1, kind: 'paragraph', tokenId: tokId || tok
}));
const blk = (lines, tok) => ({ kind: 'paragraph', tokenId: tok, lines, notes: [] });

function run(blocks, over = {}) {
  const s = { ...getDefaultSettings(), 'imbalance-max-delta-px': 1e9, ...over };
  return planPages(blocks, s, new EventLog('off'), new Ledger(), { measure });
}

// =====================================================================
describe('דוח 06 / FX-1 — הצבה מכוונת-ליווי: הכותרת ושורות הליווי בטור שאומת', () => {
  // הבנייה הפורנזית מהדוח: מילוי 39×24.2px ⇒ נותר 82.7px. בדיקת lineH ההיסטורית
  // דרשה 3×26−0.5=77.5 (עוברת), המחסנית האמיתית 37+5+24.2+5+24.2=94.9 (נכשלת)
  // ⇒ לפני התיקון הכותרת נשארה בתחתית הטור עם שורה אחת בלבד (after=1).
  const build = () => {
    const fill = mk(39, 'f', 24.2, 'fill');
    const heading = { kind: 'heading', level: 3, tokenId: 'h1', lines: [{ words: ['H'], widthPx: 200, heightPx: 37, kind: 'heading', level: 3, tokenId: 'h1' }] };
    const para = blk(mk(4, 'p', 24.2, 'p1'), 'p1');
    return run([blk(fill, 'fill'), heading, para]);
  };

  it('אין כותרת עם פחות מ-ESCORT_MIN_LINES שורות אחריה בטור (בגבולות הקיבולת)', () => {
    const r = build();
    const v = [];
    r.pages.forEach(pg => pg.columns.forEach((col, ci) => col.forEach((ln, li) => {
      if (ln.kind === 'heading') {
        const after = col.slice(li + 1).filter(x => x.kind !== 'heading').length;
        if (after < CM.ESCORT_MIN_LINES) v.push({ page: pg.index, col: ci, after });
      }
    })));
    assertEq(v.length, 0, `heading-escort violations must not survive placement (got ${JSON.stringify(v)})`);
  });

  it('הבדיקה וההצבה באותה יחידת מידה: escortStackHeightPx מחשב את המחסנית הפיזית', () => {
    const gap = () => 5;
    const head = { lines: [{ heightPx: 37 }] };
    const next = { lines: [{ heightPx: 24.2 }, { heightPx: 24.2 }, { heightPx: 24.2 }, { heightPx: 24.2 }] };
    assertEq(CM.escortStackHeightPx(head, next, gap), 37 + 5 + 24.2 + 5 + 24.2, 'stack = heading+gap+2 escort lines+gap');
    assertEq(CM.escortStackHeightPx(head, null, gap), 42, 'no following ⇒ heading stack only');
  });
});

// =====================================================================
describe('דוח 06 / FX-2 — אבחון נסיגה הוגן: הפרה סטטית אינה מתויגת "תנודה"', () => {
  const mkCtx = (repairFn) => {
    const ledger = new Ledger();
    const events = [];
    const eventLog = { emit: (cat, name, data) => events.push({ cat, name, data }) };
    const page = { index: 0, columns: [[]], template: { columns: [{ x: 0, w: 100 }], contentBox: { height: 500 } } };
    return {
      ctx: {
        pages: [page], settings: getDefaultSettings(), ledger, eventLog,
        repairFns: { 'widow-bottom': repairFn },
        assess: () => [{ kind: 'widow-bottom', target: 'page#0c0', page: 0, evidence: {} }],
      },
      ledger, events,
    };
  };

  it('repairFn ledger-only (mutates:false) + הפרה קבועה ⇒ retreat-static, לא oscillation-detected', () => {
    const noop = () => {};
    noop.mutates = false;
    const { ctx, ledger, events } = mkCtx(noop);
    const r = runRetreatLoop(ctx);
    assertEq(r.converged, false, 'לא התכנס');
    assert(!events.some(e => e.name === 'oscillation-detected'), 'אין תיוג תנודה על הפרה שלא זזה');
    assert(events.some(e => e.name === 'retreat-static'), 'יש אירוע retreat-static הוגן');
    const rec = ledger.issues.get(r.compromise);
    assertEq(rec.status, 'correction-blocked', 'סטטוס הוגן: אין תיקון פעיל — לא "תחרות תיקונים"');
  });

  it('repairFn משנה-פריסה (ברירת מחדל) + חתימה חוזרת ⇒ תנודה אמיתית נשמרת כמו שהיא', () => {
    const { ctx, ledger, events } = mkCtx(() => {}); // בלי דגל mutates — נחשב משנה (תאימות לאחור)
    const r = runRetreatLoop(ctx);
    assert(events.some(e => e.name === 'oscillation-detected'), 'תנודה אמיתית עדיין מזוהה');
    const rec = ledger.issues.get(r.compromise);
    assertEq(rec.status, 'competing-repair-side-effect', 'הסטטוס ההיסטורי נשמר לתנודה אמיתית');
  });

  it('חיווט dp-planner: תיקוני הרישום-בלבד מסומנים mutates:false', () => {
    // בדיקת חוזה: הקובץ מחייב את הסימון (מנע נסיגה שקטה להתנהגות הישנה)
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/engine/layout/dp-planner.js'), 'utf8');
    assert(/markNoLegalSplit\.mutates\s*=\s*false/.test(src), 'markNoLegalSplit.mutates = false קיים');
    assert(/markReadingOrderBlocked\.mutates\s*=\s*false/.test(src), 'markReadingOrderBlocked.mutates = false קיים');
  });
});

// =====================================================================
describe('דוח 06 / FX-3 — התחייבות הערות בעמוד שורת הסמן (קולוקציה)', () => {
  it('פסקה שנדחקת כולה לעמוד הבא — ההערה עוברת איתה (לא נשארת מאחור)', () => {
    // קליברציה מהדוח: שני טורים מלאים עם <2×lineH פנויים; פסקת 2 שורות עם
    // הערה בשורתה הראשונה אינה נכנסת כלל ⇒ הפסקה כולה עוברת עמוד.
    let found = null;
    for (let n = 60; n <= 90 && !found; n++) {
      const fills = [];
      for (let i = 0; i < n; i++) fills.push(blk(mk(1, 'f' + i, 24, 'f' + i), 'f' + i));
      const pLines = mk(2, 'n', 24, 'pNote');
      pLines[0].words = ['\uE102א׳', 'n1']; // סמן מתויג בשורה הראשונה
      const notePara = { kind: 'paragraph', tokenId: 'pNote', lines: pLines, notes: [{ text: 'note follows its marker', marker: 'א׳', tokenId: 'pNote', noteIndex: 0, part: 1 }] };
      const r = run([...fills, notePara]);
      const markerPage = r.pages.findIndex(pg => pg.columns.some(c => c.some(l => (l.words || []).some(w => String(w).includes('\uE102')))));
      const fnPage = r.pages.findIndex(pg => (pg.footnotes || []).length > 0);
      if (markerPage >= 0 && fnPage >= 0 && markerPage !== fnPage) found = { n, markerPage, fnPage };
    }
    assertEq(found, null, `הערה נטשה את עוגנה (found=${JSON.stringify(found)}) — חייבת להתחייב בעמוד הסמן`);
  });

  it('הסמן בשורה מאוחרת של פסקה חוצת-עמודים — ההערה בעמוד הסמן, לא בעמוד הפתיחה', () => {
    // עמוד מלא כמעט לגמרי; פסקה ארוכה שהסמן שלה בשורה האחרונה — הסמן נופל
    // בעמוד הבא; ההערה חייבת להיות שם (לא בעמוד שבו הפסקה נפתחה).
    const S0 = getDefaultSettings();
    const lineH = Math.round(S0['body-font-size-pt'] * (96 / 72) * S0['body-line-height']);
    let bad = 0, checked = 0;
    for (let fill = 30; fill <= 44; fill++) {
      const fills = [blk(mk(fill, 'a', 24, 'fa'), 'fa'), blk(mk(fill, 'b', 24, 'fb'), 'fb')];
      const pLines = mk(8, 'p', 24, 'pLate');
      pLines[7].words = ['\uE102ב׳', 'p7']; // הסמן בשורה האחרונה של הפסקה
      const notePara = { kind: 'paragraph', tokenId: 'pLate', lines: pLines, notes: [{ text: 'late marker note', marker: 'ב׳', tokenId: 'pLate', noteIndex: 0, part: 1 }] };
      const r = run([...fills, notePara]);
      const markerPage = r.pages.findIndex(pg => pg.columns.some(c => c.some(l => (l.words || []).some(w => String(w).includes('\uE102')))));
      const fnPage = r.pages.findIndex(pg => (pg.footnotes || []).some(n => n.tokenId === 'pLate'));
      if (markerPage >= 0 && fnPage >= 0) {
        checked++;
        if (fnPage < markerPage) bad++; // הערה לפני הסמן — הכיוון הפסול
      }
    }
    assert(checked > 0, 'הקליברציה חייבת לייצר לפחות מקרה אחד נבדק');
    assertEq(bad, 0, `${bad}/${checked} הערות הוצבו לפני הסמן שלהן — ההתחייבות חייבת להיות בעמוד הסמן`);
  });
});

// =====================================================================
describe('דוח 06 / FX-4 — עונש widow-strictness=strict חי (היה מת: cut<2 בלתי-ספיק)', () => {
  it('חיתוך המשאיר שורת המשך בודדת ביעד נענש 1e9 תחת strict (ולא תחת normal)', () => {
    const blk4 = { tokenId: 'x', lineHeightPx: 20, lines: [{ heightPx: 20 }, { heightPx: 20 }, { heightPx: 20 }, { heightPx: 20 }] };
    const strict = generateCandidates(blk4, 2, 100, { 'widow-strictness': 'strict' }, null);
    const normal = generateCandidates(blk4, 2, 100, { 'widow-strictness': 'normal' }, null);
    const strictMap = new Map(strict.map(c => [c.cut, c.score]));
    const normalMap = new Map(normal.map(c => [c.cut, c.score]));
    // cut=3 ⇒ rest=1 שורה ⇒ יתום בראש היעד — חייב עונש מלא תחת strict
    assert(strictMap.get(3) >= 1e9, `cut=3 (rest=1) חייב עונש strict (got ${strictMap.get(3)})`);
    assert(normalMap.get(3) < 1e9, 'תחת normal אין עונש (התנהגות קודמת)');
    // cut=2 ⇒ rest=2 — חוקי בשני המצבים
    assertEq(strictMap.get(2), normalMap.get(2), 'חיתוך חוקי אינו נענש בשני המצבים');
  });
});

// =====================================================================
describe('דוח 06 / FX-5 — קיבולת ב-yPx אמיתיים: אין עמוד ריק פנטום', () => {
  it('בלוק 40×25px (1005 ≤ cap) נכנס לעמוד אחד — לא נדחק לשניים עם עמוד ריק', () => {
    // לפני התיקון: ensureRoom דרש 40×lineH(26)−0.5=1039.5 > cap ⇒ flushPage
    // על עמוד ריק ⇒ [[0,0],[20,20]] (הוכחה בדוח, פרק 4).
    const r = run([blk(mk(40, 'a', 25, 'a'), 'a')]);
    const emptyPages = r.pages.filter(p => p.columns.every(c => c.length === 0));
    assertEq(emptyPages.length, 0, `עמודים ריקים פנטום (got ${r.pages.map(p => p.columns.map(c => c.length))})`);
    assertEq(r.pages.length, 1, 'בלוק שנכנס פיזית ממוקם בעמוד אחד');
  });
});

// =====================================================================
describe('דוח 06 — סתירת ליווי×איזון נאטמה: cleanBoundary מודע-ליווי', () => {
  it('optimalSplit לא יבחר גבול שמשאיר כותרת עם <2 שורות אחריה בטור המקור', () => {
    const H = (i) => ({ kind: 'heading', level: 3, heightPx: 30, words: ['h' + i], meta: { tokenId: 'h' + i } });
    const L = (i, tok) => ({ kind: 'paragraph', heightPx: 20, words: [tok + i], meta: { tokenId: tok } });
    // רצף: 10 שורות טקסט, כותרת, שורה אחת בלבד אחריה, ואז עוד 10 שורות
    const seq = [];
    for (let i = 0; i < 10; i++) seq.push(L(i, 'pA'));
    seq.push(H(0));
    seq.push(L(0, 'pB'));
    for (let i = 0; i < 10; i++) seq.push(L(i, 'pC'));
    const cols = [seq.slice(0, 11), seq.slice(11)]; // כותרת אחרונה בטור 0 עם 0 שורות אחריה
    const best = optimalSplit(cols, { cap: 10000 });
    // הגבול הנבחר אסור שישאיר את הכותרת (מיקום 10 ברצף) עם <2 שורות אחריה בטור 0
    const headingAt = 10;
    const k = best ? best.k : -1;
    let after = 0;
    for (let j = headingAt + 1; j < k; j++) if (seq[j].kind !== 'heading') after++;
    const badBoundary = k > headingAt && after < CM.ESCORT_MIN_LINES;
    assert(!badBoundary, `הגבול k=${k} משאיר כותרת עם ${after} שורות בלבד בטור המקור`);
    assert(best && best.clean, 'הגבול הנבחר מסומן clean רק אם הוא באמת נקי מליווי ומווידוא/יתום');
  });

  it('constraint-matrix: הקבועים זהים לערכים ההיסטוריים (אין שינוי מדיניות בשלב A)', () => {
    assertEq(CM.ESCORT_MIN_LINES, 2, 'REQ-BAL-10: 2 שורות ליווי');
    assertEq(CM.WIDOW_ORPHAN_MIN, 2, 'widow/orphan: 2/2');
    assertEq(CM.CAPACITY_EPS, 0.5, 'סבילות קיבולת כמו ב-dp-planner');
  });
});

// =====================================================================
describe('דוח 06 / FX-6 — תיעוד: פער בלוקים הוא שער כניסה בלבד (החלטה ארכיטקטונית פתוחה)', () => {
  it('regression-documentation: blockGap מעלה את סף הכניסה אך אינו נצבר בגובה הטור (מצב מתועד מדוח 06, פרק 4)', () => {
    // התנהגות קיימת, מתועדת בכוונה בשלב A (שינויה היה משנה hash של כל מסמך
    // רב-בלוקי — נדחה לשלב B, ראו דוח 06 סעיף 5.2.3). הבדיקה מקפיאה את
    // הסמנטיקה המדויקת כדי ששינוי לא מכוון לא יחמוק.
    const gap = 5;
    // שתי שורות של 30px עם פער כניסה 5: נכנסות ל-64px פנויים (30+5+30−0.5 ≤ 64)
    // אבל הגובה הנצבר בטור הוא 60 בלבד — ה-gap אינו נרשם בשום מקום.
    const lines = mk(2, 'g', 30, 'gapTest');
    const r = run([{ kind: 'paragraph', tokenId: 'gapTest', lines, notes: [] },
                   blk(mk(1, 'z', 3, 'z'), 'z')]);
    const colUsed = r.pages[0].columns[0].reduce((s, l) => s + l.heightPx, 0);
    assertEq(colUsed, 63, 'הגובה הנצבר = סכום heightPx בלבד (gap = שער כניסה, לא גובה — מתועד)');
  });
});

report();
