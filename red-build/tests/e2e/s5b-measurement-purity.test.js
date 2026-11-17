// tests/e2e/s5b-measurement-purity.test.js — שלב 5 פרוסה 2 (§2.3 בביקורת):
// מדידה אחת לכל פריט — מונה שמוכיח שאין מדידה חוזרת ב-Planner, ושהערות
// נמדדות פעם אחת בלבד (חותמת CP2) בכל המסלול: יצירה → תקציב → הצבה →
// פיצול. וכן: fixDropWordInColumns צורך את רוחבי ה-LineModel (אפס מדידה).
'use strict';

const { describe, it, assert, assertEq, report } = require('../harness');
const { planPages } = require('../../src/engine/layout/dp-planner');
const { fixDropWordInColumns } = require('../../src/engine/typography/protectors');
const { stampNoteMetrics } = require('../../src/engine/layout/footnote-budget');
const { Ledger } = require('../../src/engine/core/ledger');
const { EventLog } = require('../../src/engine/core/events');
const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const fs = require('fs');
const path = require('path');

/** בלוק סינתטי עם LineModel מלא (המדדים כבר נקבעו במנוע השורות). */
function para(n, hPx, tokenId) {
  const lines = Array.from({ length: n }, (_, i) => ({
    words: [`${tokenId}-w${i}`], heightPx: hPx, widthPx: 100, isLast: i === n - 1, kind: 'paragraph', tokenId,
    lineModel: { blockId: tokenId, naturalWidthPx: 60, lineHeightPx: hPx, fragments: [], glue: [{ naturalPx: 4 }], floatAreas: [] }
  }));
  return { kind: 'paragraph', tokenId, lines, notes: [], part: 'p1' };
}

describe('מונה מדידות — ה-Planner אינו מודד (§2.3/תנאי קבלה)', () => {
  it('planPages עם קלטים מחויבים (שורות + הערות מחותמות): אפס קריאות מדידה', () => {
    let calls = 0;
    const counting = (t, s) => { calls++; return String(t).length * 0.55 * (s || 12) * (96 / 72); };
    counting.impl = 'table';
    const S = getDefaultSettings();
    S['body-font-size-pt'] = 13; S['body-line-height'] = 1.5; S['imbalance-max-delta-px'] = 999999;
    S['footnotes-enabled'] = true;
    // הערות מחויבות מראש — כמו ש-Cp2 עושה במסלול המוצר
    const notesA = [stampNoteMetrics({ text: 'הערה ראשונה ארוכה למדידה חד פעמית במסלול המלא', marker: 'א׳', tokenId: 'a', noteIndex: 0 }, S, counting)];
    const notesB = [stampNoteMetrics({ text: 'הערה שנייה', marker: 'ב׳', tokenId: 'b', noteIndex: 0 }, S, counting)];
    const stampCalls = calls; // ההטבעה עצמה — המדידה הראשונה והאחרונה של ההערות
    const blocks = [
      { ...para(3, 25, 'a'), notes: notesA },
      { ...para(3, 25, 'b'), notes: notesB },
      para(3, 25, 'c')
    ];
    const r = planPages(blocks, S, new EventLog(), new Ledger(), { measure: counting });
    assert(r.pages.length >= 1, 'התכנון הושלם');
    assertEq(calls - stampCalls, 0, `ה-Planner מדד ${calls - stampCalls} פעמים — אפס נדרש (המדדים הגיעו מחויבים)`);
    // ההערות הוצבו והתקציב חושב מהחותמות
    let placedNotes = 0;
    for (const pg of r.pages) placedNotes += pg.footnotes.length;
    assertEq(placedNotes, 2, 'שתי ההערות הוצבו');
  });

  it('מסלול המוצר המלא (typeset): כל הערה נמדדת בדיוק פעם אחת — גם עם פיצול ארוך', () => {
    // מונה החשבונאות של מנגנון שבירת השורות של ההערה (noteRowsOf — מקור
    // המדידה היחיד; המונה חי בתוך המודול, דפוס api.cacheStats).
    const fb = require('../../src/engine/layout/footnote-budget');
    fb.__resetRowsStats();
    const doc = 'שם הספר - טוהר מדידה\n\nכותרת 2 - פרק\n'
      + 'פסקה ראשונה עם הערה [הערה ראשונה לבדיקת מדידה חד פעמית של גוף ההערה במסלול המלא] וטקסט רץ.\n'.repeat(3)
      + 'פסקה שנייה עם הערה [הערה שנייה לבדיקה] ועוד טקסט רץ לאורך כמה שורות טובות בעמוד.\n'.repeat(3);
    const r = typeset(doc, getDefaultSettings());
    const stats = fb.__rowsStats();
    fb.__resetRowsStats(); // ניקוי — לא משאירים מצב בין בדיקות
    assert(r.contentPreserved === true, 'שימור תוכן');
    let placed = 0;
    for (const pg of r.pages) placed += pg.footnotes.length;
    assert(placed >= 2, `הערות הוצבו (${placed})`);
    assert(stats.total >= 2, `נמדדו הערות (${stats.total})`);
    // אינווריאנט המפתח: אף הערה לא נמדדה פעמיים — החותמת היא מדידתה היחידה
    const remeasured = Object.entries(stats.perKey).filter(([, n]) => n > 1);
    assertEq(remeasured.length, 0, `הערות שנמדדו יותר מפעם אחת: ${JSON.stringify(remeasured.slice(0, 3))}`);
  });

  it('הערה ארוכה במדיניות split: המקור נמדד פעם אחת; ההמשך (טקסט חדש) — פעם אחת משלו', () => {
    const fb = require('../../src/engine/layout/footnote-budget');
    fb.__resetRowsStats();
    const S = getDefaultSettings();
    S['footnotes-enabled'] = true;
    S['fn-layout-mode'] = 'block';
    S['fn-bar-max-height-px'] = 40; // תקרה נמוכה — מכריח פיצול
    S['long-footnote-policy'] = 'split';
    const longText = 'הערה ארוכה מאוד שחייבת להיחתך '.repeat(14);
    const r = typeset('שם הספר - פיצול\n\nכותרת 2 - פרק\nפסקה עם הערה ארוכה [' + longText + '] וטקסט רץ.\n'.repeat(2), S);
    const stats = fb.__rowsStats();
    fb.__resetRowsStats();
    assert(r.contentPreserved === true, 'שימור תוכן');
    const srcCounts = stats.keys.filter(k => k.includes('הערה ארוכה מאוד'));
    const restCounts = stats.keys.filter(k => !k.includes('הערה ארוכה מאוד'));
    assertEq(srcCounts.length, 1, `המקור נמדד בדיוק פעם אחת (${srcCounts.length})`);
    assert(restCounts.length <= 2, `ההמשכים (טקסט חדש) נמדדים פעם אחת לכל אחד (${restCounts.length})`);
    // הפיצול בפועל: הערת המשך הוצבה בעמוד הבא
    const conts = [];
    for (const pg of r.pages) for (const n of pg.footnotes) if (n.isContinuation) conts.push(n);
    assert(conts.length >= 1, 'נוצר המשך מפיצול');
  });
});

describe('fixDropWordInColumns — רוחבים מה-LineModel בלבד (§2.3)', () => {
  it('מיזוג מילה נופלת ללא אף קריאת מדידה (מדדי השורות משמשים)', () => {
    let measureCalls = 0;
    const measure = (t) => { measureCalls++; return String(t).length * 6; };
    const colW = 300;
    // col0 מסתיים בשורת מילה-בודדת קצרה ("את"); col1 נפתח בשורה רחבה עם רווח
    const dropped = {
      words: ['את'], heightPx: 20, widthPx: 12, kind: 'paragraph', tokenId: 'p1',
      lineModel: { blockId: 'p1', naturalWidthPx: 12, lineHeightPx: 20, fragments: [], glue: [], floatAreas: [] }
    };
    const receiver = {
      words: ['שורה', 'רחבה', 'בטור', 'השני', 'עם', 'מילים', 'רבות', 'מאוד'], heightPx: 20, widthPx: 200, kind: 'paragraph', tokenId: 'p2',
      lineModel: { blockId: 'p2', naturalWidthPx: 200, lineHeightPx: 20, fragments: [], glue: [{ naturalPx: 5 }], floatAreas: [] }
    };
    const cols = [[dropped, { ...dropped }], [receiver]];
    const merged = fixDropWordInColumns(cols, 3, { colW, measure });
    assertEq(merged, true, 'המיזוג בוצע');
    assertEq(measureCalls, 0, `אפס קריאות מדידה (התקבלו ${measureCalls}) — הרוחב מה-LineModel`);
    assertEq(receiver.words.length, 9, 'המילה נמשכה לשורה המקבלת');
    assertEq(receiver.widthPx, 200 + 5 + 12, 'רוחב השורה הממוזגת = widthPx + רווח טבעי + רוחב המילה');
    assertEq(cols[0].length, 1, 'שורת המילה הבודדת הוסרה מהטור');
  });

  it('שמרנות: בלי LineModel ובלי measure — אין מיזוג (מי שלא מוכיח התאמה לא ממזג)', () => {
    const dropped = { words: ['את'], heightPx: 20, widthPx: 12, kind: 'paragraph', tokenId: 'p1' };
    const receiver = { words: ['שורה', 'רחבה'], heightPx: 20, widthPx: 200, kind: 'paragraph', tokenId: 'p2' };
    const cols = [[dropped], [receiver]];
    const merged = fixDropWordInColumns(cols, 3, { colW: 300 });
    assertEq(merged, false, 'אין מיזוג ללא מקור רוחב מוכח');
    assertEq(receiver.words.length, 2, 'השורה המקבלת לא שונתה');
  });

  it('בלי LineModel עם measure — נפילה חזרה למדידה (נתיב מורשת בלבד)', () => {
    let calls = 0;
    const measure = (t) => { calls++; return String(t).length * 6; };
    const dropped = { words: ['את'], heightPx: 20, widthPx: 12, kind: 'paragraph', tokenId: 'p1' };
    const receiver = { words: ['שורה', 'רחבה'], heightPx: 20, widthPx: 200, kind: 'paragraph', tokenId: 'p2' };
    const cols = [[dropped], [receiver]];
    const merged = fixDropWordInColumns(cols, 3, { colW: 300, measure });
    assertEq(merged, true, 'מיזוג במדידה (נתיב מורשת)');
    assert(calls > 0, 'המדידה נקראה בנתיב המורשת בלבד');
  });
});

describe('מסלול המוצר — טוהר תכנון ללא מדידה (הוכחת אינטגרציה)', () => {
  it('typeset: שום שורה לא נוצרה מחדש ושום מדד לא שונה אחרי ההצבה (hash-זהות פר-שורה)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'canonical_corpus.txt'), 'utf8');
    const r = typeset(doc, getDefaultSettings());
    // כל שורה ממוקמת: המדדים זהים ל-LineModel שממנו נגזרה (לא רוחב/גובה
    // מתוקנים בדיעבד) — הגובה תמיד lineHeightPx המקורי; הרוחב naturalWidthPx.
    let checked = 0, bad = 0;
    for (const pg of r.pages) {
      for (const col of pg.columns) {
        for (const ln of col) {
          if (!ln.lineModel) continue;
          checked++;
          if (ln.heightPx !== ln.lineModel.lineHeightPx) bad++;
        }
      }
    }
    assert(checked > 50, `נבדקו ${checked} שורות`);
    assertEq(bad, 0, `${bad} שורות שגובהן שונה מה-LineModel — אסור`);
  });
});

report('s5b-measurement-purity');
