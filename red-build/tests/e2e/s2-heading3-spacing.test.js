// tests/e2e/s2-heading3-spacing.test.js — שלב 2: ממצא משתמש מאומת — רווח תחתון של כותרת 3 במעבר שורה.
//
// **הדיווח (מאומת):** "הרווח הוחל לפני מעבר השורה של כותרת 3 עצמה, ולא בין
// הכותרת לבין התוכן שאחריה."
//
// **חקירת השורש (מתועדת ב-audits/STAGE2_MODEL_COVERAGE.md §5):**
//  - מקור הרווח: `legacy-imud-flow.js` — H3_SPAN_H = 38 = "span 34px + רווח 4px"
//    (כיול S4.14 על 13 מופעי חד-שורה בלבד בייחוס). הרווח התחתון אפוי **בתוך
//    גובה הפס לכל שורה** ולא כמאפיין של פריט הכותרת.
//  - ההחלה: שבירת S4.24/S74 (עטיפה ברוחב 60%) דוחפת פס span נפרד לכל שורה
//    (`y: curY + li*H3_SPAN_H`), והבלוק הבא נפתח מיד אחרי הפס האחרון
//    (`openBlock(curY + n*H3_SPAN_H)`). לכן: הפער המבני (4px) מופיע **בין שורות
//    הכותרת עצמה** (לפני מעבר השורה) ואילו אחרי השורה האחרונה אין אף רווח
//    נוסף — ההיפוך המדויק של ההתנהגות הנדרשת.
//  - DOM ו-PDF חולקים את אותה סמנטיקה (שניהם ממרכזים בתוך תיבת 38px) —
//    אין מחלוקת בין מקרינים; השורש במודל הנתונים (הכותרת מיוצגת כ-N פסים
//    עצמאיים ולא כפריט אחד שהרווח שייך לו).
//  - סיווג התיקון: **שלב 4** (LineModel — הכותרת כפריט יחיד עם מקטעי שורה;
//    רווח תחתון אחרי השורה האחרונה בלבד) ואימות גאומטריה בשלב 5.
//    אין לתקן ב-CSS נקודתי או בתנאי חריג במקרין.
//
// **הבדיקה כאן:** fixture חוזה (כותרת 3 שנשברת לשתי שורות לפחות + פסקת גוף
// אחריה), מדידת הגאומטריה במודל העמודים, והוכחה ש-DOM ו-PDF צורכים את
// אותן עובדות. מצב החוזה הנוכחי (הפגם) נעול במפורש — נעילה מודעת, לא השלמה
// שקטה: כששלב 4 יתקן, הנעילה תישבר ותחייב עדכון מכוון של המפרט להלן.
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const { legacyTypeset, GEO, SINGLE_W } = require('../../src/engine/layout/legacy-imud-flow');
const { importImudSettings } = require('../../src/engine/core/legacy-settings-map');
const { getDefaultSettings, getSettingDefs } = require('../../src/engine/core/settings-registry');
const { registerFont, clearRegisteredFonts } = require('../../src/engine/typography/measure-api');
const { projectLegacyDocument } = require('../../src/engine/output/legacy-projector');
const { renderPage } = require('../../src/engine/output/dom-renderer');

const ASSETS = path.join(__dirname, '..', '..', 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const LEGACY_DEFAULTS = JSON.parse(fs.readFileSync(path.join(ASSETS, 'default_settings.json'), 'utf8'));
const bytesOf = (fam) => {
  const e = CATALOG.find(x => x.family === fam);
  return e ? fs.readFileSync(path.join(ASSETS, 'fonts', e.file)) : null;
};

function imudSettings() {
  const available = new Set(CATALOG.map(e => e.family));
  const { settings } = importImudSettings(LEGACY_DEFAULTS, new Set(getSettingDefs().map(r => r.id)), { availableFonts: available });
  return Object.assign({}, getDefaultSettings(), settings);
}
function registerCoreFonts(s) {
  clearRegisteredFonts();
  const fams = new Set([s['body-font'], s['f-note-body-font'], 'FrankReal', 'DavidLibre-Bold',
    'Hadassah Friedlaender', 'Frank Ruhl Libre', 'David Libre',
    s['header-recto-right-font'], s['header-verso-right-font'], s['heading-3-font']].filter(Boolean));
  for (const f of fams) { const b = bytesOf(f); if (b) registerFont(f, b); }
}

// ---------- DOM shim ----------
function makeDoc() {
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = v; }
    get textContent() { return this._text != null ? this._text : this.children.map(c => (c.text != null ? c.text : '')).join(''); }
    set textContent(v) { this._text = String(v); this.children = []; }
  }
  return { createElement: (t) => new El(t), createTextNode: (t) => ({ text: t }) };
}

// ── ה-Fixture: מסמך תקין מבחינה מבנית (כל כותרת עם טקסט, טקסט בין כותרות,
//    כותרת אחרונה עם תוכן אמיתי) — לפי תנאי המשתמש למסמכי בדיקה. ──
const H3_SPAN_H = 38;     // legacy-imud-flow.js:720 — 34 span + 4 gap (S4.14)
const TITLE_W_PCT = 0.6;  // S74: עטיפת כותרות 2/3 ב-60% מרוחב הפס
const H23_TITLE_W = SINGLE_W * TITLE_W_PCT;

const H3_TEXT = 'כותרת אופקית ארוכה במיוחד שנשברת לשתי שורות לפחות ברוחב העטיפה של שישים אחוזים מרוחב הפס המלא';
const DOC = [
  'כותרת 2 - פרק הבדיקה',
  'פסקת גוף ראשונה אחרי פתיחת הפרק, עם טקסט ממשי הממלא את ראש העמוד ומבטיח זרימה תקינה של הטורים בעמוד פתיחת הסימן.',
  `כותרת 3 - ${H3_TEXT}`,
  'פסקת הגוף שבאה מיד אחרי הכותרת האופקית, ומיקום השורה הראשונה שלה הוא המדד למרחק שבין סוף הכותרת לתחילת התוכן שאחריה.',
  'פסקת סיום עם טקסט אמיתי.'
].join('\n');

/** מוצא את העמוד שבו כותרת 3 נשברת למספר פסים + את רצף הפסים. */
function findWrappedH3(result) {
  for (const pg of result.pages) {
    const bands = (pg.bands || []).filter(b => b.kind === 'h3-title');
    // רצף רציף של פסי h3 (אותה כותרת: הפער בין פסים עוקבים = גובה הפס; הראשון נושא tokenId)
    for (let i = 0; i < bands.length; i++) {
      let j = i;
      while (j + 1 < bands.length && Math.abs(bands[j + 1].y - bands[j].y - H3_SPAN_H) < 0.01) j++;
      if (j > i) {
        const seq = bands.slice(i, j + 1);
        if (seq[0].tokenId != null && seq.slice(1).every(b => b.tokenId == null)) {
          return { page: pg, bands: seq };
        }
      }
      i = j;
    }
  }
  return null;
}

describe('שלב 2 — ממצא רווח כותרת 3 (fixture: כותרת נשברת + פסקת גוף)', () => {

  it('ההגדרות: הרווח התחתון של כותרת 3 מוגדר בגובה הפס (H3_SPAN_H) — מקור הממצא', () => {
    // מקור ההגדרה: legacy-imud-flow.js:720 — הרווח (4px) אפוי בגובה הפס לכל שורה.
    assertEq(H3_SPAN_H, 38, 'אם הקבוע השתנה — עדכן את הבדיקה הזו במכוון');
    // רוחב העטיפה של S74 — התנאי לשבירת הכותרת למספר שורות.
    assertEq(Math.round(H23_TITLE_W), Math.round(SINGLE_W * 0.6), 'רוחב עטיפה שונה מהחוזה');
  });

  it('ה-Fixture תקין: הכותרת נשברת לשתי שורות לפחות ואחריה פסקת גוף', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const found = findWrappedH3(r);
    assert(found, 'לא נמצאה כותרת 3 שנשברת למספר שורות — הפיקסטורה אינה מקיימת את תנאי הבדיקה');
    assert(found.bands.length >= 2, `צפויות 2+ שורות כותרת, התקבלו ${found.bands.length}`);
    // הכותרת עדיין פריט אחד מבחינת המקור: ה-tokenId על השורה הראשונה בלבד.
    assert(found.bands[0].tokenId != null, 'השורה הראשונה חייבת לשאת את זהות הכותרת');
    clearRegisteredFonts();
  });

  it('מדידת הגאומטריה: מיקום תחילת הכותרת, גובה כל שורותיה, מיקום סיומה', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const { page, bands } = findWrappedH3(r);
    const headingTopStack = bands[0].y - 8;        // הפסים מוזזים +8 מהמחסנית (layoutStack)
    const headingEndStack = bands[bands.length - 1].y - 8 + H3_SPAN_H;
    for (const b of bands) assertEq(b.h, H3_SPAN_H, 'כל שורות הכותרת חייבות גובה פס זהה');
    // הפער בין שורות הכותרת עצמה (pitch):
    const pitch = bands[1].y - bands[0].y;
    assertEq(pitch, H3_SPAN_H, 'המרחק בין שורות הכותרת = גובה פס מלא (כולל הרווח התחתון)');
    // תחילת התוכן שאחרי הכותרת — שורת הגוף הראשונה בטור הימני מתחת לפסים:
    const colLines = (page.columns[0] || []).filter(u => u.y >= headingEndStack - 0.01);
    assert(colLines.length >= 1, 'אין שורות גוף אחרי הכותרת באותו עמוד — הרחב את הפיקסטורה');
    const contentTop = colLines[0].y;
    const gapAfter = contentTop - headingEndStack;
    // ── תיעוד הממצא המאומת (נעילת מצב, לא אישור תקינות): ──
    // הרווח המבני בין שורות הכותרת: pitch − 34 (גובה ה-span עצמו) = 4px.
    // הרווח המבני אחרי הכותרת: gapAfter הנוכחי (0 נוסף — הבלוק נפתח מיד).
    const gapInsidePerLineBreak = pitch - (H3_SPAN_H - 4);
    // D-S2H3 — הפגם המאומת: הרווח פועל לפני מעבר השורה ולא אחרי הכותרת:
    assert(gapInsidePerLineBreak === 4 && gapAfter === 0,
      `מצב הפגם השתנה (בין-שורות: ${gapInsidePerLineBreak}px, אחרי-כותרת: ${gapAfter}px) — `
      + 'אם שלב 4 תוקן: עדכן מפרט התנהגות זה והפוך את הנעילה למפרט הרצוי (0 בין שורות, 4+ אחרי האחרונה)');
    clearRegisteredFonts();
  });

  it('המפרט הרצוי (לתיקון בשלב 4) — מתועד ונבדק שאינו מושלם עדיין', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const { page, bands } = findWrappedH3(r);
    const headingEndStack = bands[bands.length - 1].y - 8 + H3_SPAN_H;
    const pitch = bands[1].y - bands[0].y;
    const colLines = (page.columns[0] || []).filter(u => u.y >= headingEndStack - 0.01);
    const contentTop = colLines[0].y;
    const specMet = (pitch === H3_SPAN_H - 4) && (contentTop - headingEndStack >= 4);
    // תנאי הקבלה של המפרט: רווח 0 בין שורות הכותרת; הרווח התחתון פעם אחת, אחרי
    // השורה האחרונה בלבד. כרגע המפרט אינו מושלם — הבדיקה מוכיחה זאת במפורש
    // ותישבר ברגע שהתיקון ינחת (מחייב עדכון מכוון של שתי הבדיקות הקודמות).
    assert(specMet === false, 'המפרט כבר מושלם?! עדכן את התיעוד — הפגם D-S2H3 תוקן מבלי שהמפרט עודכן');
    clearRegisteredFonts();
  });

  it('DOM ו-PDF צורכים את אותן עובדות גאומטריה (אותו y/h לכל שורת כותרת)', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const { page, bands } = findWrappedH3(r);

    // PDF — המקרין מקבל את אותם פסים (y/h/baseline):
    const proj = projectLegacyDocument(r, s);
    const ppage = proj.pages[page.index];
    assert(ppage, 'עמוד הפרויקציה חסר');
    const pdfBandLines = ppage.lines.filter(l => l.kind === 'h3-title');
    assert(pdfBandLines.length >= bands.length, 'שורות כותרת חסרות במקרן ה-PDF');
    for (let i = 0; i < bands.length; i++) {
      const pb = pdfBandLines.find(l => Math.abs(l.y - bands[i].y) < 0.01 && Math.abs(l.h - bands[i].h) < 0.01);
      assert(pb, `ל-PDF אין את שורת הכותרת ${i} באותן קואורדינטות (${bands[i].y}/${bands[i].h})`);
    }
    // הבסיס ב-PDF נגזר מהתיבה (baselineOf) — אותה סמנטיקה של מרכוז בתוך 38px:
    for (const pb of pdfBandLines) {
      assert(pb.h === H3_SPAN_H, 'גובה שורת כותרת ב-PDF שונה מהמודל');
    }

    // DOM — אותם פסים בדיוק (top/height/line-height מאותו מקור):
    const doc = makeDoc();
    const el = renderPage(page, s, doc);
    const domBands = el.children.filter(c => String(c.className || '').includes('band--h3-title'));
    assert(domBands.length >= bands.length, 'שורות כותרת חסרות ב-DOM');
    const px = (v) => Number(String(v).replace(/px$/, ''));
    for (let i = 0; i < bands.length; i++) {
      const match = domBands.find(c => Math.abs(px(c.style.top) - bands[i].y) < 0.01 && Math.abs(px(c.style.height) - bands[i].h) < 0.01);
      assert(match, `ל-DOM אין את שורת הכותרת ${i} באותן קואורדינטות`);
      assertEq(px(match.style.lineHeight), H3_SPAN_H, 'line-height שורת כותרת ב-DOM שונה מהמודל');
    }
    clearRegisteredFonts();
  });
});

report('s2-heading3-spacing');
