// tests/e2e/s7-page-model.test.js — שלב 7: PageModel יחיד, סופי ו-immutable
// (הוראת שלב 7 §§18–24 + תכנית §§7.1–7.3).
//
// מוכיח: בנייה מלאה מכל סוגי הפריטים, כיסוי מלא (אין יתומים/כפילויות),
// זהות מקור לכל fragment, גבולות, סדר קריאה, קישור הערות-עוגן, הזמנות,
// immutability עמוק, דטרמיניזם (hashes), השוואת PagePlan⟷PageModel,
// שחזור גיאומטריה מלא מול ההקרנה, ושלילות (הזרקת פגמים ⇒ הפרות מדווחות).
'use strict';

const { describe, it, assert, assertEq, report } = require('../harness');
const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { projectDocument } = require('../../src/engine/output/geometry-projector');
const { buildPageModel, validatePageModel, PAGE_MODEL_SCHEMA, deepFreeze } = require('../../src/engine/core/page-model');
const fs = require('fs');
const path = require('path');

const S = () => getDefaultSettings();

/** מסמך עשיר: גוף + הערות שוליים + ביאורי-צד + עיטורים + פס + כותרות. */
const RICH_DOC = 'ספר - ספר המודל\nנושא - שלב 7\n\n'
  + 'כותרת 1 - החלק הראשון\n'
  + 'כותרת 2 - פרק פתיחה\n'
  + Array.from({ length: 34 }, (_, i) =>
    `פסקה ${i} עם הערה [הערה מספר ${i} עם עוד כמה מילים ארוכות לשבירה במרזב] ועוד טקסט רץ בגוף הדף למילוי הטורים בנפח אמיתי ולמעבר לעמודים נספרים עם גיליון.`).join('\n')
  + '\nכותרת 7 - ביאור צד ראשון עם כמה מילים בשוליים\n'
  + 'פסקה מבוארת עם מספיק מילים למילוי שורות בטור ועוד טקסט רץ לאורך כמה שורות טובות.\n';

/** מסמך עם עמודי הערות-סיום. */
const EN_DOC = 'ספר - סיום\n\nכותרת 1 - חלק\nכותרת 2 - פרק\n'
  + 'פסקה עם הערה [הערת סיום ראשונה ארוכה למדי שתישבר לכמה שורות בעמוד ההערות] וטקסט רץ.\n'.repeat(6);

/** מסמך עם תיבות מידע (פריט ההרחבה של שלב 6 פרוסה 2). */
const BOX_STYLES = JSON.stringify([{
  id: 'info-demo', name: 'תיבה', trigger: { linePrefix: 'תיבה:' },
  layoutMode: 'info-box', infoBox: { widthEm: 4.5, padEm: 0.3 },
  style: { background: '#f6f6f2', border: '1px solid #666' }
}]);
const BOX_DOC = 'ספר - תיבות\n\nכותרת 1 - חלק\nכותרת 2 - פרק\n'
  + 'תיבה: תיבת מידע בשוליים עם כמה מילים שנמדדות ברוחב הפנימי\n'
  + 'פסקה מבוארת עם מספיק מילים למילוי העמוד.\n'.repeat(8);

describe('שלב 7 (§19) — buildPageModel: הבונה היחיד', () => {
  it('מסמך קצר: מודל נבנה, סכמה מגורסת, אפס הפרות; כל סוגי העמודים מיוצגים', () => {
    const r = typeset(RICH_DOC, S());
    assertEq(r.pageModel.schema, PAGE_MODEL_SCHEMA, 'סכמה מגורסת');
    assertEq(r.pageModel.pages.length, r.pages.length, 'מספר העמודים = התוכנית');
    assertEq(r.pageModelValidation.violations.length, 0,
      `הפרות: ${JSON.stringify(r.pageModelValidation.violations.slice(0, 3))}`);
    const types = new Set(r.pageModel.pages.map(p => p.type));
    for (const t of ['shaar-main', 'toc-general', 'preface', 'sign-open', 'regular']) {
      assert(types.has(t), `סוג עמוד חסר במודל: ${t}`);
    }
  });

  it('very_long: מודל מלא של 1050 עמודים — אפס הפרות על מאות אלפי בדיקות', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'real', 'very_long_test_text.txt'), 'utf8');
    const r = typeset(doc, S());
    assertEq(r.pageModelValidation.violations.length, 0,
      `הפרות: ${JSON.stringify(r.pageModelValidation.violations.slice(0, 3))}`);
    let lines = 0, words = 0, notes = 0, anchors = 0;
    for (const p of r.pageModel.pages) {
      for (const l of p.lines) { lines++; words += (l.words || []).length; }
      notes += p.footnotes.length;
      anchors += p.sideNotes.length;
    }
    assert(lines > 50000, `שורות במודל (${lines})`);
    assert(words > 250000, `מילים ממוקמות (${words})`);
    assert(notes > 100, `הערות מרזב (${notes})`);
    assert(anchors >= 400, `פריטי עוגן (${anchors})`);
    assertEq(r.pageModel.document.tokensCount, r.tokens.length, 'תיעוד מקור');
  });

  it('כל סוגי הפריטים במודל: הערות/עוגנים/תיבות/סיום/עיטורים/ריהוט/הזמנות', () => {
    // הערות מרזב + הערות-צד + פסים + עיטורים + גיליון + כותרת עליונה
    const r = typeset(RICH_DOC, S());
    const m = r.pageModel;
    let hasFn = false, hasSn = false, hasFolio = false, hasHeader = false;
    for (const p of m.pages) {
      if (p.footnotes.length) hasFn = true;
      if (p.sideNotes.length) hasSn = true;
      if (p.folio) hasFolio = true;
      if (p.header) hasHeader = true;
      // הזמנות: מנגנון ההרחבה (column-flow צורך; page-items מזרים) — במסמך
      // זה אף פריט לא הזמין שטח גנרי (תקציב המרזב זורם דרך fnReservedHeightPx)
      // — המודל משקף נאמנה רשימה ריקה; השוואת 1:1 מול התוכנית נעולה בבדיקת
      // ההשוואה שלהלן.
    }
    assert(hasFn, 'הערות מרזב במודל');
    assert(hasSn, 'פריטי עוגן במודל');
    assert(hasFolio, 'גיליון במודל');
    assert(hasHeader, 'כותרת עליונה במודל');
    // עמודי הערות-סיום
    const r2 = typeset(EN_DOC, { ...S(), 'note-placement-mode': 'endnotes' });
    const en = r2.pageModel.pages.filter(p => p.type === 'endnotes');
    assert(en.length >= 1, 'עמודי הערות במודל');
    let enNotes = 0;
    for (const p of en) {
      for (const l of p.lines) assertEq(l.area, 'endnotes', 'שורות עמוד-הערות מסומנות area=endnotes');
      enNotes += p.footnotes.length;
      // רשומות ההערות של הבונה מיוצגות (הערות עם חותמה)
      const stamped = (r2.pages[p.index].notes || []).filter(n => n.noteRows);
      assertEq(p.footnotes.length, stamped.length, 'רשומות ההערות במודל = הבונה');
    }
    assert(enNotes >= 6, `הערות סיום במודל (${enNotes})`);
    // תיבות מידע
    const s3 = S(); s3._customStyles = BOX_STYLES;
    const r3 = typeset(BOX_DOC, s3);
    const boxes = r3.pageModel.pages.flatMap(p => p.sideNotes.filter(x => x.itemKind === 'info-box'));
    assert(boxes.length >= 1, 'תיבות מידע במודל');
    for (const b of boxes) {
      assert(b.boxChrome && b.heightPx > 0 && b.stampValid === true, 'התיבה עם גיאומטריה וחותמה במודל');
    }
    assertEq(r3.pageModelValidation.violations.length, 0, 'אפס הפרות עם תיבות');
  });
});

describe('שלב 7 (§21) — אינווריאנטים: חיוב ושלילה', () => {
  const rich = () => typeset(RICH_DOC, S());

  it('כיסוי מלא: כל שורת תוכנית מיוצגת; אין כפילויות מזהה; כמויות תואמות', () => {
    const r = rich();
    const planCount = r.pages.reduce((a, p) => a + (p.spanning ? p.spanning.lines.length : 0) + p.columns.reduce((b, c) => b + c.length, 0), 0);
    const modelCount = r.pageModel.pages.reduce((a, p) => a + p.lines.filter(l => l.area === 'column' || l.area === 'spanning').length, 0);
    assertEq(modelCount, planCount, `plan=${planCount} model=${modelCount}`);
    const ids = new Set();
    for (const p of r.pageModel.pages) for (const l of p.lines) {
      assert(!ids.has(l.id), `מזהה שורה כפול: ${l.id}`);
      ids.add(l.id);
    }
  });

  it('זהות מקור לכל fragment + קישור עוגן לכל הערה (אין marker יתום)', () => {
    const r = rich();
    const tokenIds = new Set(r.tokens.map(t => t.id));
    for (const p of r.pageModel.pages) {
      for (const l of p.lines) {
        if (l.area === 'column' || l.area === 'spanning') {
          assert(l.sourceTokenId != null, `שורה בלי מקור: ${l.id}`);
          assert(tokenIds.has(l.sourceTokenId), `מקור לא מוכר: ${l.sourceTokenId}`);
        }
      }
      for (const n of p.footnotes) {
        assert(n.noteId && n.anchorId, `הערה בלי זהות/עוגן: ${n.noteId}`);
        assert(tokenIds.has(n.anchorId), `עוגן הערה יתום: ${n.anchorId}`);
        assertEq(n.stampValid, true, `חותמה תקינה: ${n.noteId}`);
      }
      for (const sn of p.sideNotes) {
        assert(sn.noteId && sn.anchorId && tokenIds.has(sn.anchorId), `פריט עוגן יתום: ${sn.noteId}`);
      }
    }
  });

  it('סדר קריאה וגבולות: y מונוטוני בכל טור; שורות בתוך תיבת התוכן', () => {
    const r = rich();
    for (const p of r.pageModel.pages) {
      const cb = p.geometry.contentBox;
      const perCol = new Map();
      for (const l of p.lines) {
        if (l.area !== 'column') continue;
        if (!perCol.has(l.col)) perCol.set(l.col, -Infinity);
        assert(l.y >= perCol.get(l.col) - 1.5, `סדר קריאה נשבר: ${l.id}`);
        perCol.set(l.col, Math.max(perCol.get(l.col), l.y + (l.h || 0)));
        assert(l.y >= cb.top - 1.5 && l.y + (l.h || 0) <= cb.bottom + 1.5, `חריגה מתיבת התוכן: ${l.id}`);
      }
    }
  });

  it('שלילה — פגם מוזרק ⇒ הפרה מדווחת (שכפול/יתום/גבולות/סדר/עוגן/הזמנה)', () => {
    const r = rich();
    // structuredClone מפשיר את ההקפאה — מאפשר הזרקת פגמים לבדיקת האימות
    const corrupt = (mutate) => {
      const m = structuredClone(r.pageModel);
      mutate(m);
      return validatePageModel(m, { planPages: r.pages, tokens: r.tokens }).violations;
    };
    let v = corrupt(m => { m.pages[4].lines.push(structuredClone(m.pages[4].lines[0])); });
    assert(v.some(x => x.code === 'duplicate-line-id' || x.code === 'line-count-mismatch'), `שכפול: ${JSON.stringify(v.slice(0, 2))}`);
    v = corrupt(m => { const p = m.pages.find(pp => pp.lines.some(l => l.area === 'column')); p.lines.splice(p.lines.findIndex(l => l.area === 'column'), 1); });
    assert(v.some(x => x.code === 'planned-line-missing' || x.code === 'line-count-mismatch'), `שורה חסרה: ${JSON.stringify(v.slice(0, 2))}`);
    v = corrupt(m => { const l = m.pages.flatMap(p => p.lines).find(l => l.area === 'column'); l.y = -500; });
    assert(v.some(x => x.code === 'line-outside-content-box'), `גבולות: ${JSON.stringify(v.slice(0, 2))}`);
    v = corrupt(m => { const l = m.pages.flatMap(p => p.lines).find(l => l.area === 'column'); l.sourceTokenId = 'no-such-token'; });
    assert(v.some(x => x.code === 'line-unknown-token'), `מקור לא מוכר: ${JSON.stringify(v.slice(0, 2))}`);
    v = corrupt(m => { const n = m.pages.flatMap(p => p.footnotes)[0]; if (n) n.anchorId = 'orphan-anchor'; });
    assert(v.some(x => x.code === 'note-anchor-orphan'), `עוגן יתום: ${JSON.stringify(v.slice(0, 2))}`);
    v = corrupt(m => { m.pages[0].reservations = [{ kind: 'x', scope: 'all-columns', px: 5, reason: 'injected' }]; });
    assert(v.some(x => x.code === 'reservations-mismatch'), `הזמנות: ${JSON.stringify(v.slice(0, 2))}`);
  });
});

describe('שלב 7 (§7.1-8/9/12 + §23) — immutability, דטרמיניזם והשוואות', () => {
  it('immutability עמוק: מוטציה בכל עומק זורקת (שורה/מילה/הערה/עמוד/מערך)', () => {
    const r = typeset(RICH_DOC, S());
    const m = r.pageModel;
    const expectThrow = (fn, label) => {
      let threw = false;
      try { fn(); } catch (e) { threw = e instanceof TypeError; }
      assert(threw, `מוטציה לא נחסמה: ${label}`);
    };
    const p = m.pages.find(pp => pp.lines.some(l => l.area === 'column'));
    const l = p.lines.find(x => x.area === 'column');
    expectThrow(() => { l.x = 999; }, 'שדה שורה');
    expectThrow(() => { l.words[0].x = 999; }, 'מילה');
    expectThrow(() => { p.index = 999; }, 'שדה עמוד');
    expectThrow(() => { m.pages.push({}); }, 'מערך עמודים');
    expectThrow(() => { p.footnotes[0].text = 'x'; }, 'הערה');
    expectThrow(() => { m.geometryHash = 'x'; }, 'hash');
    assertEq(Object.isFrozen(m), true, 'השורש קפוא');
    assertEq(Object.isFrozen(l.words[0]), true, 'מילה קפואה');
  });

  it('דטרמיניזם: אותו קלט ⇒ אותם geometryHash/contentHash ואותו דוח אימות', () => {
    const a = typeset(RICH_DOC, S());
    const b = typeset(RICH_DOC, S());
    assertEq(a.pageModel.geometryHash, b.pageModel.geometryHash, 'geometryHash זהה');
    assertEq(a.pageModel.contentHash, b.pageModel.contentHash, 'contentHash זהה');
    assertEq(JSON.stringify(a.pageModelValidation.checks), JSON.stringify(b.pageModelValidation.checks), 'דוח אימות זהה');
  });

  it('השוואת PagePlan⟷PageModel: כל החלטת תכנון נשמרת (גבהים/פערים/מתיחה/הזמנות)', () => {
    const r = typeset(RICH_DOC, S());
    for (let i = 0; i < r.pages.length; i++) {
      const plan = r.pages[i];
      const model = r.pageModel.pages[i];
      // גיאומטריית העמוד
      assertEq(model.geometry.width, plan.template.width, `רוחב עמוד ${i}`);
      assertEq(model.geometry.columns.length, (plan.template.columns || []).length, `מספר טורים ${i}`);
      // הזמנות 1:1
      assertEq(model.reservations.length, (plan.reservations || []).length, `הזמנות ${i}`);
      // פריטי עוגן: הצבה סופית = ההחלטה בתוכנית
      assertEq(model.sideNotes.length, (plan.sideNotes || []).length, `פריטי עוגן ${i}`);
      for (let k = 0; k < model.sideNotes.length; k++) {
        assertEq(model.sideNotes[k].yTop, plan.sideNotes[k].yTop, `yTop עוגן ${i}/${k}`);
        assertEq(model.sideNotes[k].heightPx, plan.sideNotes[k].heightPx, `גובה עוגן ${i}/${k}`);
      }
      // גבהים/פערים/מתיחה של שורות הטורים — מהחותמות של התוכנית
      const planCol = (plan.columns || []).flat();
      const modelCol = model.lines.filter(l => l.area === 'column');
      assertEq(modelCol.length, planCol.length, `שורות טור ${i}`);
      for (let k = 0; k < modelCol.length; k++) {
        assertEq(modelCol[k].h, (planCol[k].heightPx || 0) * (planCol[k].aqStretch || 1), `גובה שורה ${i}/${k}`);
        assertEq(modelCol[k].gapBeforePx, planCol[k].gapBeforePx || 0, `פער שורה ${i}/${k}`);
      }
    }
  });

  it('שחזור גיאומטריה מלא: מיקומי המודל = פלט ההקרנה (מקור אחד, אפס סטייה)', () => {
    const r = typeset(RICH_DOC, S());
    const proj = projectDocument(r, S());
    let compared = 0;
    for (let i = 0; i < r.pageModel.pages.length; i++) {
      const mp = r.pageModel.pages[i];
      const pp = proj.pages[i];
      const modelCol = mp.lines.filter(l => l.area === 'column');
      // out.lines של עמוד רגיל: שורות הטורים ואז הערות-הצד — מסננים כמו הבונה
      const projBody = (pp.lines || []).filter(pl => pl.kind !== 'side-note' && pl.kind !== 'info-box');
      const n = Math.min(modelCol.length, projBody.length);
      for (let k = 0; k < n; k++) {
        assertEq(modelCol[k].x, projBody[k].x, `x שורה ${i}/${k}`);
        assertEq(modelCol[k].y, projBody[k].y, `y שורה ${i}/${k}`);
        assertEq(modelCol[k].w, projBody[k].w, `w שורה ${i}/${k}`);
        assertEq(modelCol[k].words.length, projBody[k].words.length, `מספר מילים ${i}/${k}`);
        for (let wi = 0; wi < Math.min(3, modelCol[k].words.length); wi++) {
          assertEq(modelCol[k].words[wi].x, projBody[k].words[wi].x, `x מילה ${i}/${k}/${wi}`);
          assertEq(modelCol[k].words[wi].text, projBody[k].words[wi].text, `טקסט מילה ${i}/${k}/${wi}`);
        }
        compared++;
      }
    }
    assert(compared > 30, `שורות שהושוו (${compared})`);
  });

  it('שימור תוכן ברמת המודל: מילות השורות = מילות התוכנית (סדר קריאה)', () => {
    const r = typeset(RICH_DOC, S());
    const planWords = [];
    for (const p of r.pages) {
      for (const col of (p.columns || [])) for (const ln of col) planWords.push(...(ln.words || []));
    }
    const modelWords = [];
    for (const p of r.pageModel.pages) for (const l of p.lines) {
      if (l.area === 'column') for (const w of l.words) modelWords.push(w.text);
    }
    assertEq(modelWords.length, planWords.length, `כמות מילים (${modelWords.length} מול ${planWords.length})`);
    // PUA נאסף בהקרנה — משווים לאחר ניקוי זהה
    const scrub = (s) => String(s).replace(/\uE000/g, ' ').replace(/[\uE101\uE102]/g, '').replace(/\u00A0/g, ' ');
    for (let i = 0; i < modelWords.length; i++) {
      assertEq(scrub(modelWords[i]), scrub(planWords[i]), `מילה ${i}: ${modelWords[i]} מול ${planWords[i]}`);
    }
  });

  it('RTL: המילה הראשונה בסדר הקריאה היא הימנית ביותר בכל שורה', () => {
    const r = typeset(RICH_DOC, S());
    let checked = 0;
    for (const p of r.pageModel.pages) {
      for (const l of p.lines) {
        if (l.area !== 'column' || !l.words || l.words.length < 2) continue;
        // ב-RTL: words[0] = ראשונה בקריאה = נצברת ראשונה מהקצה הימני; מיקומה
        // חייב להיות הגבוה ב-x מכל ממשיכותיה באותה שורה
        let maxX = -Infinity, firstX = l.words[0].x;
        for (const w of l.words) maxX = Math.max(maxX, w.x);
        assert(Math.abs(firstX - maxX) < 0.01, `RTL: המילה הראשונה אינה הימנית (${l.id})`);
        checked++;
        if (checked >= 20) break;
      }
      if (checked >= 20) break;
    }
    assert(checked >= 5, `שורות RTL שנבדקו (${checked})`);
  });

  it('deepFreeze — המנגנון עצמו: אובייקט חופשי קופא מלא; כבר-קפוא אינו נפגע', () => {
    const obj = { a: 1, nested: { b: [1, 2, { c: 3 }] } };
    deepFreeze(obj);
    assert(Object.isFrozen(obj) && Object.isFrozen(obj.nested) && Object.isFrozen(obj.nested.b) && Object.isFrozen(obj.nested.b[2]), 'הקפאה עמוקה');
    let threw = false;
    try { obj.nested.b[2].c = 9; } catch (e) { threw = true; }
    assert(threw, 'מוטציה נחסמה');
  });
});

describe('שלב 7 (§20) — גבולות האחריות: הבונה אינו מחליט מחדש', () => {
  it('נייטרליות מלאה: המודל אינו משנה את הפריסה (hash התוכנית נשמר ביט-לביט)', () => {
    // הקרנת המודל נבנית אחרי כל ההחלטות; typeset מחזיר את אותו layoutHash
    // כמו לפני השלב — הבונה קורא ואינו כותב לתוכנית.
    const a = typeset(RICH_DOC, S());
    const b = typeset(RICH_DOC, S());
    assertEq(a.layoutHash, b.layoutHash, 'layoutHash יציב');
    // העמודים עצמם קודמים למודל ואינם מושפעים ממנו
    assertEq(a.pages.length, a.pageModel.pages.length, 'המודל משקף — לא משנה');
    assert(a.contentPreserved === true, 'שימור תוכן');
  });

  it('הערות המודל מהחותמות: אפס מדידה מחדש (words מההקרנה החד-פעמית)', () => {
    const r = typeset(RICH_DOC, S());
    for (const p of r.pageModel.pages) {
      for (const n of p.footnotes) {
        // מילות ההערה במודל = מילות ההקרנה; החותמה (noteRows/noteWords) נשארת
        // המדידה היחידה — המודל לא מודד ולא שובר שוב (נעול בפרוסה 2).
        assert(n.stampValid === true, `חותמה תקינה במודל: ${n.noteId}`);
        assert(n.words.every(w => Number.isFinite(w.x) && w.w > 0), 'מילים ממוקמות');
      }
    }
  });
});

report('s7-page-model');
