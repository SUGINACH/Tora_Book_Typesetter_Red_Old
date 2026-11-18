// tests/e2e/s9b-h7-grammar-anchor.test.js — שלב 9b פרוסה 9b.3: דקדוק הכותרות המלא
// (מספר/ציטוט לפני המקף) + תזמון עוגן ביאורי-הצד + אימות H7 מורחב (§3.1–§3.3).
'use strict';

const path = require('path');
const fs = require('fs');
const { describe, it, assert, assertEq, report } = require('../harness');

const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { registerFont } = require('../../src/engine/typography/measure-api');
const { lexDocument, HEADING_RE } = require('../../src/engine/parser/dfa-lexer');
const { tokenizeDetailed } = require('../../src/engine/parser/block-tokenizer');
const { verifyH7Conversion, placeSideNotes } = require('../../src/engine/layout/side-notes');

const RB = path.join(__dirname, '..', '..');
function registerAllFonts() {
  const FONTS = [
    ['Guttman Rashi', 'Guttman-Rashi-Normal.ttf'], ['Frank Ruhl Libre', 'FrankRuhlLibre-VF.ttf'],
    ['Alpha', 'Alpha-Regular.ttf'], ['AlphaBlack', 'Alpha-Black.ttf'], ['AlphaLight', 'Alpha-Light.ttf'],
    ['Lia Sgula', 'Sgula-Regular.ttf'], ['Livorna', 'Livorna-Regular.ttf'], ['FrankReal', 'FrankReal-Regular.ttf'],
    ['David Libre', 'DavidLibre-Regular.ttf'], ['Hadassah Friedlaender', 'Hadassah-Friedlaender.ttf']
  ];
  for (const [fam, file] of FONTS) {
    const fp = path.join(RB, 'ui/assets/imud/fonts', file);
    if (fs.existsSync(fp)) { const r = registerFont(fam, fs.readFileSync(fp)); if (!r.ok) throw new Error(`registerFont(${fam}): ${r.error}`); }
  }
}

describe('s9b-h7-grammar — דקדוק הכותרות: "מספר N" וציטוטים לפני המקף (D-91)', () => {
  registerAllFonts();

  it('HEADING_RE: הצורות של המקור מזוהות — עם מספר, עם ציטוט, ושתיהן', () => {
    const cases = [
      ['כותרת 7 - טקסט רגיל', 7, 'טקסט רגיל', null, null],
      ['כותרת 7 מספר 1 - מתניתין דיציאות', 7, 'מתניתין דיציאות', 1, null],
      ['כותרת 7 מספר 12 - טקסט ארוך מאוד שנמשך', 7, 'טקסט ארוך מאוד שנמשך', 12, null],
      ['כותרת 7 (מקור: הוצאה, 7, 367) - חובת שמירת מצב', 7, 'חובת שמירת מצב', null, '(מקור: הוצאה, 7, 367)'],
      ['כותרת 3 מספר 2 - ענף ביאור', 3, 'ענף ביאור', 2, null],
      ['כותרת 2 (מקור: רשויות, 2, 15) - סימן מצוטט', 2, 'סימן מצוטט', null, '(מקור: רשויות, 2, 15)'],
      ['כותרת 1 - חלק רגיל', 1, 'חלק רגיל', null, null],
    ];
    for (const [line, level, text, num, citation] of cases) {
      const m = String(line).match(HEADING_RE);
      assert(m != null, `לא זוהתה כותרת: ${line}`);
      assertEq(Number(m[2]), level, `רמה ב-${line}`);
      assertEq((m[6] || '').trim(), text, `טקסט ב-${line}`);
      assertEq(m[3] !== undefined ? Number(m[3]) : null, num, `מספר ב-${line}`);
      assertEq(m[4] && m[4].trim() ? m[4].trim() : null, citation, `ציטוט ב-${line}`);
    }
    // הצורות חלק/הקדמה — הרמה נגזרת בטוקנייזר (1/0), לא מקבוצת הכותרת
    for (const [line, text] of [['חלק א - פתיחה', 'פתיחה'], ['הקדמה - דברי מבוא', 'דברי מבוא']]) {
      const m = String(line).match(HEADING_RE);
      assert(m != null && m[2] === undefined, `זוהתה כותרת בצורת חלק/הקדמה: ${line}`);
      assertEq((m[6] || '').trim(), text, `טקסט ב-${line}`);
    }
    // שלילה: לא כותרת
    assert(!HEADING_RE.test('כותרת 8 - רמה מחוץ לטווח'), 'כותרת 8 אינה כותרת (הדקדוק האמיתי H0–H7)');
    assert(!HEADING_RE.test('פסקה רגילה בגוף הטקסט'), 'פסקה אינה כותרת');
  });

  it('טוקנייזר: מספר וציטוט נשמרים כשדות סמנטיים בטוקן ואינם נרנדרים', () => {
    const DOC = `ספר - בדיקת דקדוק

כותרת 1 - חלק ראשון
כותרת 7 מספר 1 - ביאור עם מספר
פסקה ראשונה מארחת את הביאור.
כותרת 7 (מקור: הוצאה, 7, 367) - ביאור עם ציטוט
פסקה שנייה מארחת ביאור נוסף.
כותרת 3 מספר 4 - ענף ממוספר
פסקה שלישית רגילה.
`;
    const lexed = lexDocument(DOC, {});
    const det = tokenizeDetailed(lexed.bodyLines, { fnOpen: '[', fnClose: ']' });
    const byRaw = new Map(det.tokens.map(t => [String(t.raw).trim(), t]));
    const h7num = byRaw.get('כותרת 7 מספר 1 - ביאור עם מספר');
    assert(h7num && h7num.type === 'heading' && h7num.level === 7, 'כותרת 7 מספר 1 — H7');
    assertEq(h7num.num, 1, 'num נשמר');
    assertEq(h7num.citation || null, null, 'אין ציטוט');
    const h7cit = byRaw.get('כותרת 7 (מקור: הוצאה, 7, 367) - ביאור עם ציטוט');
    assert(h7cit && h7cit.type === 'heading' && h7cit.level === 7, 'כותרת 7 עם ציטוט — H7');
    assertEq(h7cit.citation, '(מקור: הוצאה, 7, 367)', 'הציטוט נשמר כשדה סמנטי (§6.3 — אין אובדן מידע)');
    assertEq(String(h7cit.text).trim(), 'ביאור עם ציטוט', 'הטקסט אחרי המקף בלבד');
    const h3num = byRaw.get('כותרת 3 מספר 4 - ענף ממוספר');
    assert(h3num && h3num.type === 'heading' && h3num.level === 3, 'כותרת 3 מספר 4 — h3');
    assertEq(h3num.num, 4, 'num של h3 נשמר');
    // הרצה מלאה: מילות ההוראה אינן מרונדרות כתוכן
    const r = typeset(DOC, getDefaultSettings(), {});
    assert(r.contentPreserved === true, 'contentPreserved');
    const rendered = [];
    for (const pg of r.pages) {
      for (const col of (pg.columns || [])) for (const ln of col) rendered.push(...(ln.words || []).map(w => String(w && typeof w === 'object' ? w.t : w)));
      if (pg.spanning && pg.spanning.lines) for (const ln of pg.spanning.lines) rendered.push(...(ln.words || []).join(' ').split(/\s+/));
    }
    const flat = rendered.join(' ');
    assert(!/מספר 1 מרונדר|כותרת 7 מספר/.test(flat) || !flat.includes('ביאור עם מספר כותרת'), 'מילות הוראה לא דולפות לגוף');
    assert(!flat.includes('(מקור: הוצאה'), 'הציטוט אינו מרונדר כגוף (נצרך כמו הייחוס; נשמר במודל)');
  });

  it('ביאורי-צד: כל טוקני ה-H7 (כולל הצורות החדשות) מומרים ומוצבים בזהות מלאה', () => {
    const DOC = `ספר - מסמך רב-ביאורים

כותרת 1 - החלק
כותרת 7 - ביאור ראשון פשוט
כותרת 7 מספר 2 - ביאור שני עם מספר
כותרת 7 (מקור: רשויות, 7, 1204) - ביאור שלישי עם ציטוט
פסקה מארחת את שלושת הביאורים יחד עם עוד כמה מילים למילוי שטח.
כותרת 7 מספר 3 - ביאור רביעי
פסקה שנייה מארחת את הביאור הרביעי בלבד.
`;
    const r = typeset(DOC, getDefaultSettings(), {});
    const lexed = lexDocument(DOC, {});
    const det = tokenizeDetailed(lexed.bodyLines, { fnOpen: '[', fnClose: ']' });
    const h7Tokens = det.tokens.filter(t => t.type === 'heading' && t.level === 7);
    assertEq(h7Tokens.length, 4, `ארבעה טוקני H7 (זוהו ${h7Tokens.length})`);
    const placed = (r.sideNotes && r.sideNotes.placed) || [];
    assertEq(placed.length, 4, `ארבעה פריטים הוצבו (הוצבו ${placed.length})`);
    const byText = new Map(placed.map(p => [String(p.text).replace(/\s+/g, ' ').trim(), p]));
    for (const t of h7Tokens) {
      const p = byText.get(String(t.text).replace(/\s+/g, ' ').trim());
      assert(p != null, `ביאור "${t.text}" הוצב`);
      assertEq(String(p.ownToken), String(t.id), 'ownToken = טוקן המקור (לא anchorToken!)');
    }
    // אין ממצאי אימות
    const h7Issues = [...r.ledger.issues.values()].filter(x => String(x.kind).startsWith('h7-'));
    assertEq(h7Issues.length, 0, `אין ממצאי H7 (נמצאו: ${h7Issues.map(x => x.kind).join(',')})`);
  });

  it('תזמון: ביאור שהמארחת שלו בעמוד הבא נכנס לעמוד העוגן — לא לעמוד הקודם (F-9b-1)', () => {
    // מסמך שבו ה-H7 בסוף עמוד והפסקה המארחת נפתחת בעמוד הבא: מילוי מבוקר
    // המכריח מעבר עמוד בין ה-H7 למארחת.
    const filler = Array.from({ length: 90 }, (_, i) => `פסקת מילוי ${i} עם כמה מילים נוספות לתפוס שטח בעמודים ולהכריח שבירה מדויקת.`).join('\n');
    const DOC = `ספר - תזמון עוגן

כותרת 1 - החלק
${filler}
כותרת 7 - ביאור בסוף עמוד
פסקה מארחת שנפתחת כנראה בעמוד הבא בגלל המילוי שמעליה.
`;
    const r = typeset(DOC, getDefaultSettings(), {});
    const placed = (r.sideNotes && r.sideNotes.placed) || [];
    assertEq(placed.length, 1, 'ביאור אחד הוצב');
    const it = placed[0];
    // עמוד הופעת העוגן (המארחת) מול עמוד הפריט
    const firstPageByToken = new Map();
    for (const pg of r.pages) {
      const lines = [...(pg.spanning ? pg.spanning.lines : []), ...(pg.columns || []).flat()];
      for (const ln of lines) {
        const tok = ln.tokenId != null ? String(ln.tokenId) : (ln.meta && ln.meta.tokenId != null ? String(ln.meta.tokenId) : null);
        if (tok != null && !firstPageByToken.has(tok)) firstPageByToken.set(tok, pg.index);
      }
    }
    const anchorPage = firstPageByToken.get(String(it.anchorToken));
    assert(anchorPage != null, 'העוגן הוצב בגוף');
    assert(it.page <= anchorPage && anchorPage - it.page <= 1, `הפריט בעמוד ${it.page}, העוגן ב-${anchorPage}`);
    // התנאי הקשה: אם הפריט בעמוד אחר מהעוגן — זו דחיית נפח מתועדת, לא הצבה לפני העוגן
    const before = placed.filter(p => {
      const ap = firstPageByToken.get(String(p.anchorToken));
      return ap != null && p.page < ap;
    });
    assertEq(before.length, 0, `אף פריט לפני עוגנו (${before.length})`);
  });

  it('H7 ללא פסקה מארחת — ממצא מפורש, לא היעלמות בשקט', () => {
    const DOC = `ספר - זנב H7

כותרת 1 - החלק
פסקה יחידה בגוף.
כותרת 7 - ביאור זנבורי ללא מארחת
`;
    const r = typeset(DOC, getDefaultSettings(), {});
    const placed = (r.sideNotes && r.sideNotes.placed) || [];
    assertEq(placed.length, 1, 'הביאור לא נגנז (BRZ-15)');
    const finding = [...r.ledger.issues.values()].filter(x => x.kind === 'h7-without-host');
    assertEq(finding.length, 1, 'ממצא מפורש h7-without-host');
  });

  it('verifyH7Conversion מורחב — שלילות: טקסט שונה, עוגן שגוי, כפילות, חסר, לפני-עוגן', () => {
    const tokens = [
      { id: 't1', type: 'heading', level: 7, text: 'ביאור אלף' },
      { id: 't2', type: 'heading', level: 7, text: 'ביאור בית' },
      { id: 't3', type: 'heading', level: 7, text: 'ביאור גימל' },
    ];
    const pages = [
      { index: 0, columns: [[{ tokenId: 'h1' }], []], sideNotes: [] },
      { index: 1, columns: [[{ tokenId: 'h2' }], []], sideNotes: [] },
    ];
    const placement = {
      placed: [
        { ownToken: 't1', anchorToken: 'h1', text: 'ביאור אלף', page: 0 },
        { ownToken: 't1', anchorToken: 'h1', text: 'ביאור אלף', page: 0 }, // כפילות
        { ownToken: 't2', anchorToken: 'h1', text: 'ביאור שונה לגמרי', page: 0 }, // טקסט לא נשמר
        { ownToken: 't9', anchorToken: 'h1', text: 'פריט חסר מקור', page: 0 }, // חסר מקור
        // t3 חסר — h7-conversion-missing
      ],
      deferred: [{ ownToken: 't3', reason: 'no-room', page: 1 }], // דחוי שלא נסגר
    };
    const ms = verifyH7Conversion(tokens, pages, placement);
    const kinds = new Set(ms.map(m => m.kind));
    assert(kinds.has('h7-conversion-duplicate'), 'כפילות מזוהה');
    assert(kinds.has('h7-text-not-preserved'), 'טקסט שונה מזוהה');
    assert(kinds.has('side-item-without-h7-source'), 'פריט חסר-מקור מזוהה');
    assert(kinds.has('h7-conversion-missing'), 'חסר מזוהה');
    assert(kinds.has('h7-deferred-never-placed'), 'דחוי-לא-נסגר מזוהה');
    // עוגן שגוי (עם hostByH7) + הצבה לפני עוגן:
    const placement2 = {
      placed: [
        { ownToken: 't1', anchorToken: 'h2', text: 'ביאור אלף', page: 0 }, // העוגן h2 בעמוד 1 ⇒ הפריט לפני העוגן
        { ownToken: 't2', anchorToken: 'hXX', text: 'ביאור בית', page: 0 }, // עוגן שגוי מול הצפי
        { ownToken: 't3', anchorToken: 'h2', text: 'ביאור גימל', page: 1 },
      ],
      deferred: [],
    };
    const ms2 = verifyH7Conversion(tokens, pages, placement2, { hostByH7: new Map([['t2', 'h2']]) });
    const kinds2 = new Set(ms2.map(m => m.kind));
    assert(kinds2.has('h7-placed-before-anchor'), 'הצבה לפני עוגן מזוהה');
    assert(kinds2.has('h7-anchor-mismatch'), 'עוגן שגוי מזוהה');
    // תקין מלא — אפס ממצאים:
    const placement3 = {
      placed: [
        { ownToken: 't1', anchorToken: 'h1', text: 'ביאור אלף', page: 0 },
        { ownToken: 't2', anchorToken: 'h1', text: 'ביאור בית', page: 0 },
        { ownToken: 't3', anchorToken: 'h2', text: 'ביאור גימל', page: 1 },
      ],
      deferred: [],
    };
    const ms3 = verifyH7Conversion(tokens, pages, placement3, { hostByH7: new Map([['t1', 'h1'], ['t2', 'h1'], ['t3', 'h2']]) });
    assertEq(ms3.length, 0, `תקין מלא (ממצאים: ${JSON.stringify(ms3)})`);
  });
});

report();
