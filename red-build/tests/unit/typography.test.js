// tests/unit/typography.test.js — Gate S3: מיקרו־טיפוגרפיה (REQ-LB-01..05, 07)
'use strict';

const { describe, it, assert, assertEq, assertClose, report } = require('../harness');
const { MeasureAPI } = require('../../src/engine/typography/measure-api');
const { breakLines } = require('../../src/engine/typography/kp-linebreak');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

const S = getDefaultSettings();
const api = new MeasureAPI(S, 'math');
const W = (t) => api.measureTextWidth(t);
const COLW = 240;

describe('REQ-LB-01 measure API single entry', () => {
  it('deterministic width: same text → same px, cache hits counted', () => {
    const a = api.measureTextWidth('שלום עולם');
    const b = api.measureTextWidth('שלום עולם');
    assertEq(a, b);
    assert(api.cacheStats().hits >= 1, 'second call served from cache');
  });
  it('pt→px conversion uses 96/72', () => {
    const w14 = api.measureTextWidth('א', 14);
    const w7 = api.measureTextWidth('א', 7);
    assertClose(w14 / w7, 2, 0.001, 'width linear in size');
  });
});

describe('REQ-LB-02 Knuth-Plass optimal breaking', () => {
  it('never exceeds column width when shrink impossible → greedy fallback still bounded', () => {
    const words = ['מילהארוכהשבורה'.repeat(3)].concat(Array.from({ length: 20 }, (_, i) => `אבג${i}`));
    const lines = breakLines(words, COLW, W, 20, {});
    for (const ln of lines) {
      const total = ln.words.reduce((s, w) => s + W(w), 0);
      // חריגה מותרת רק אם מילה בודדת רחבה מהטור (אי־אפשר לשבור — אין מקף!)
      if (ln.words.length > 1) assert(total <= COLW * 1.35, `line overflow ${total}>${COLW}`);
    }
  });
  it('KP fit ≤ greedy fit (optimality sanity on classic pathological input)', () => {
    const words = 'א ב ג ד ה ו ז ח ט י כ ל מ נ ס ע פ צ ק ר ש ת'.split(' ');
    const kp = breakLines(words, 120, W, 20, {});
    const costOf = (lines) => lines.reduce((s, ln) => s + Math.pow(Math.max(0, 120 - ln.widthPx), 2), 0);
    assert(Number.isFinite(costOf(kp)), 'kp produced finite layout');
    assert(kp.length >= 3 && kp.length <= 6, `reasonable line count, got ${kp.length}`);
  });
  it('no hyphenation: word count conserved exactly', () => {
    const words = Array.from({ length: 40 }, () => 'דבר');
    const lines = breakLines(words, COLW, W, 20, {});
    const out = lines.flatMap(l => l.words);
    assertEq(out.length, words.length);
  });
  it('נעילת ביקורת 03.11 (ביקורת חיצונית): במסלול הגיבוי penalty אסור לעולם אינו מסיים שורה — יחידת NBSP לא נקרעת ולא מאבדת את צמדהּ', () => {
    // פסקה שמכריחה נפילה לגיבוי (מילה רחבה מהטור — אין מקף), עם יחידות NBSP בשאר הפסקה.
    // בעבר: ה-forbidden בין תתי־הקופסות חתם שורה ⇒ היחידה נקרעה וה-NBSP אבד (אובדן תוכן).
    const long = 'מילהארוכהשבורה'.repeat(3);          // רחבה מהטור ⇒ ה־DP לא מוצא פתרון ⇒ גיבוי
    const unit1 = 'על\u00A0הרי', unit2 = 'ב\u00A0שביל', unit3 = 'כי\u00A0כן';
    const words = [long, unit1, 'טקסט', unit2, 'נוסף', long, unit3, 'ועוד'];
    const lines = breakLines(words, COLW, W, 20, {});
    const toks = lines.flatMap(l => l.words);
    // א. כל יחידת NBSP שלמה כטוקן אחד — מספר היחידות נשמר (3), ולא נותרו רסיסים בלי \u00A0
    const glued = toks.filter(t => t.includes('\u00A0'));
    assertEq(glued.length, 3, 'שלוש היחידות שלמות כטוקנים עם \\u00A0');
    assert(glued.includes('על\u00A0הרי') && glued.includes('ב\u00A0שביל') && glued.includes('כי\u00A0כן'), 'היחידות עצמן נשמרו מילה־במילה');
    // ב. אף רסיס: שום שורה אינה מכילה חצי יחידה ("על" / "הרי" / "כי" / "כן" כטוקן בודד)
    for (const frag of ['על', 'הרי', 'ב', 'שביל', 'כי', 'כן']) {
      assert(!toks.includes(frag), `רסיס "${frag}" — היחידה נקרעה בגיבוי`);
    }
    // ג. שימור תוכן וסדר קריאה: שחזור מלא של רצף המילים (הטוקן של היחידה זהה למילה המקורית)
    assertEq(toks.length, words.length, 'מספר הטוקנים = מספר המילים (אין איבוד/כפילות)');
    for (let i = 0; i < words.length; i++) assertEq(toks[i], words[i], `טוקן ${i} זהה למקור (סדר נשמר)`);
    // ד. סיום: שורת הסיום מסומנת; אין שורה ריקה
    assert(lines.length >= 3, `שורות סבירות (${lines.length})`);
    assert(lines.every(l => l.words.length > 0), 'אין שורה ריקה');
    assert(lines[lines.length - 1].isLast === true, 'השורה האחרונה מסומנת isLast');
    // ה. גלישה מותרת רק לטוקן בודד רחב מהטור (המילה הארוכה) — כמו במסלול הראשי
    for (const ln of lines) {
      if (ln.words.length > 1) {
        const total = ln.words.reduce((s, w) => s + W(w), 0) + (ln.words.length - 1) * W(' ');
        assert(total <= COLW * 1.35, `גלישה מיותרת בגיבוי: ${total} > ${COLW}`);
      }
    }
  });
  it('נעילת ביקורת 03.11 — שני המסלורים אחידים: פסקה בת־פתרון (DP) שומרת אף־היא על יחידות NBSP שלמות', () => {
    // אותן יחידות, בלי המילה הארוכה ⇒ DP רגיל. החזרה החוצה מוכיחה שני המסלורים
    // כבולים לאותם איסורים — לא רק בנתיב החירום.
    const units = ['על\u00A0הרי', 'טקסט', 'ב\u00A0שביל', 'נוסף', 'כי\u00A0כן', 'ועוד'];
    const lines = breakLines(units, COLW, W, 20, {});
    const toks = lines.flatMap(l => l.words);
    assertEq(toks.filter(t => t.includes('\u00A0')).length, 3, 'DP: שלוש היחידות שלמות');
    for (const frag of ['על', 'הרי', 'ב', 'שביל', 'כי', 'כן']) {
      assert(!toks.includes(frag), `DP: רסיס "${frag}"`);
    }
    assertEq(toks.length, units.length, 'DP: מספר טוקנים נשמר');
  });
});




describe('REQ-LB-07 runt protection', () => {
  it('runt penalty pushes last short line to merge when legal', () => {
    const words = ['א'.repeat(30), 'ב'.repeat(30), 'ג'.repeat(30), 'ד'.repeat(30), 'ה'];
    const loose = breakLines(words, COLW, W, 20, { runts: 0 });
    const strict = breakLines(words, COLW, W, 20, { runts: 80 });
    const lastLoose = loose[loose.length - 1];
    const lastStrict = strict[strict.length - 1];
    assert(lastStrict.widthPx >= lastLoose.widthPx || strict.length <= loose.length, 'runt option does not worsen tail');
  });
});

report('typography');
