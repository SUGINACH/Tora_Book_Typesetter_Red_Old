// tests/e2e/s2-heading3-spacing.test.js — התאמת כותרת 3 ל-CSS המקורי בגרסאות Orange/Yellow/Green.
// החוזה המקורי: line-height:1.22; padding:8px 0 4px; margin-bottom:4px.
// כלומר: pitch טקסטואלי בלבד; top padding פעם אחת; bottom padding ו-margin פעם אחת בסוף.
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
const H3_SPAN_LINE_H = 13.5 * (96 / 72) * 1.22;
const H3_SPAN_TOP_PAD_PX = 8;
const H3_SPAN_BOTTOM_PAD_PX = 4;
const H3_SPAN_MARGIN_BOTTOM_PX = 4;
const H3_SPAN_H = H3_SPAN_LINE_H + H3_SPAN_BOTTOM_PAD_PX;
const TITLE_W_PCT = 0.6;    // S74: עטיפת כותרות 2/3 ב-60% מרוחב הפס
const H23_TITLE_W = SINGLE_W * TITLE_W_PCT;

const H3_TEXT = 'כותרת אופקית ארוכה במיוחד שנשברת לשתי שורות לפחות ברוחב העטיפה של שישים אחוזים מרוחב הפס המלא';
const DOC = [
  'כותרת 2 - פרק הבדיקה',
  'פסקת גוף ראשונה אחרי פתיחת הפרק, עם טקסט ממשי הממלא את ראש העמוד ומבטיח זרימה תקינה של הטורים בעמוד פתיחת הסימן.',
  `כותרת 3 - ${H3_TEXT}`,
  'פסקת הגוף שבאה מיד אחרי הכותרת האופקית, ומיקום השורה הראשונה שלה הוא המדד למרחק שבין סוף הכותרת לתחילת התוכן שאחריה.',
  'פסקת סיום עם טקסט אמיתי.'
].join('\n');

// כותרת 3 קצרה — חד-שורתית: חוזה אי-הרגרסיה לכיוול S4.14.
const DOC_SINGLE = [
  'כותרת 2 - פרק הבדיקה',
  'פסקת גוף ראשונה עם טקסט ממשי.',
  'כותרת 3 - שם קצר',
  'פסקת הגוף שבאה מיד אחרי הכותרת הקצרה, ומיקום שורתה הראשונה הוא המדד למרחק שבין סוף כותרת חד-שורתית לתוכן.',
  'פסקת סיום עם טקסט אמיתי.'
].join('\n');

/** מוצא את העמוד שבו כותרת 3 נשברת למספר פסים + את רצף הפסים. */
function findWrappedH3(result) {
  for (const pg of result.pages) {
    const bands = (pg.bands || []).filter(b => b.kind === 'h3-title');
    for (let i = 0; i < bands.length; i++) {
      let j = i;
      while (j + 1 < bands.length && Math.abs(bands[j + 1].y - bands[j].y - H3_SPAN_LINE_H) < 0.01) j++;
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

describe('D-S2H3 — מפרט רווח תחתון של כותרת 3 (תוקן בשורש; fixture: כותרת נשברת + פסקת גוף)', () => {

  it('ההגדרות: הקבועים של גאומטריית הכותרת — מקור החוזה', () => {
    assert(Math.abs(H3_SPAN_TOP_PAD_PX + H3_SPAN_LINE_H + H3_SPAN_BOTTOM_PAD_PX + H3_SPAN_MARGIN_BOTTOM_PX - 38) < 0.05,
      'כותרת חד-שורתית שומרת על גובה כולל של 38px לפי ה-CSS הישן');
    assert(Math.abs(H3_SPAN_LINE_H - 21.96) < 0.05, 'line-height המקורי 1.22 על 13.5pt');
    assertEq(Math.round(H23_TITLE_W), Math.round(SINGLE_W * 0.6), 'רוחב עטיפה שונה מהחוזה');
  });

  it('ה-Fixture תקין: הכותרת נשברת לשתי שורות לפחות ואחריה פסקת גוף', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const found = findWrappedH3(r);
    assert(found, 'לא נמצאה כותרת 3 שנשברת למספר שורות — הפיקסטורה אינה מקיימת את תנאי הבדיקה');
    assert(found.bands.length >= 2, `צפויות 2+ שורות כותרת, התקבלו ${found.bands.length}`);
    assert(found.bands[0].tokenId != null, 'השורה הראשונה חייבת לשאת את זהות הכותרת');
    assert(found.bands.slice(1).every(b => b.tokenId == null), 'כל שורות ההמשך שייכות לאותה כותרת (אותו פריט מקור)');
    clearRegisteredFonts();
  });

  it('המפרט הרצוי — pitch שווה ל-line-height המקורי 1.22', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const { bands } = findWrappedH3(r);
    for (let i = 1; i < bands.length; i++) {
      assert(Math.abs((bands[i].y - bands[i - 1].y) - H3_SPAN_LINE_H) < 0.05,
        `ה-pitch בין שורה ${i - 1} לשורה ${i} חייב להיות line-height מקורי בלבד; התקבל ${bands[i].y - bands[i - 1].y}`);
    }
    // שורות ביניים: גובה השורה בלבד — הרווח התחתון אינו נכנס בין השורות.
    for (let i = 0; i < bands.length - 1; i++) {
      assert(Math.abs(bands[i].h - H3_SPAN_LINE_H) < 0.05, `שורת ביניים ${i} חייבת line-height מקורי (ללא ריפוד/מרווח); התקבל ${bands[i].h}`);
    }
    clearRegisteredFonts();
  });

  it('המפרט הרצוי — הרווח התחתון פעם אחת בלבד, אחרי השורה האחרונה, לפני התוכן', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC, s, {});
    const { page, bands } = findWrappedH3(r);
    // הפס האחרון: 38 = 34 (שורה) + 4 (הרווח התחתון היחיד).
    const last = bands[bands.length - 1];
    assert(Math.abs(last.h - H3_SPAN_H) < 0.05, 'הפס האחרון נושא את הרווח התחתון (38=34+4)');
    // קואורדינטות מחסנית (הפסים מוצגים ב+8; שורות הטור בקואורדינטות המחסנית):
    const BAND_STACK_OFFSET = 8;
    const lastLineTextEndStack = last.y + H3_SPAN_LINE_H;
    const colLines = (page.columns[0] || []).filter(u => u.y >= lastLineTextEndStack - 0.01);
    assert(colLines.length >= 1, 'אין שורות גוף אחרי הכותרת באותו עמוד — הרחב את הפיקסטורה');
    const contentTop = colLines[0].y;
    const gap = contentTop - lastLineTextEndStack;
    assert(Math.abs(gap - (H3_SPAN_BOTTOM_PAD_PX + H3_SPAN_MARGIN_BOTTOM_PX)) < 0.05,
      `המרחק מסוף השורה האחרונה לתוכן חייב להיות 8px (padding 4 + margin 4); התקבל ${gap}px`);
    // תיבת הפס כוללת padding-bottom של 4px; אחריה נשאר margin-bottom של 4px.
    const lastBandEndStack = last.y + last.h;
    assert(Math.abs((contentTop - lastBandEndStack) - H3_SPAN_MARGIN_BOTTOM_PX) < 0.05,
      `margin-bottom חייב להיות 4px; התקבל ${contentTop - lastBandEndStack}px`);
    clearRegisteredFonts();
  });

  it('אי-רגרסיה לכותרת חד-שורתית — גובה כולל 38px לפי ה-CSS המקורי', () => {
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(DOC_SINGLE, s, {});
    let found = null;
    for (const pg of r.pages) {
      const b = (pg.bands || []).find(x => x.kind === 'h3-title');
      if (b) { found = { page: pg, band: b }; break; }
    }
    assert(found, 'לא נמצאה כותרת 3 חד-שורתית');
    assertEq(found.band.h, H3_SPAN_H, 'תיבת שורת הכותרת כוללת line-height + padding-bottom');
    const single = (found.page.bands || []).filter(x => x.kind === 'h3-title' && x.tokenId != null);
    assertEq(single.length, 1, 'כותרת חד-שורתית אחת בלבד עם tokenId');
    const contentAfter = (found.page.columns[0] || []).filter(u => u.y >= found.band.y - 0.01);
    if (contentAfter.length) {
      const first = contentAfter.find(u => u.y >= found.band.y + H3_SPAN_H - 0.01);
      assert(first, 'התוכן אחרי כותרת חד-שורתית נפתח אחרי top padding + line-height + bottom padding + margin');
    }
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
    // הבסיס ב-PDF נגזר מהתיבה (baselineOf) — מרכוז בתוך התיבה של אותה שורה.
    for (let i = 0; i < pdfBandLines.length; i++) {
      const pb = pdfBandLines[i];
      const expectedH = H3_SPAN_LINE_H;
      assertEq(pb.h, expectedH, `גובה שורת כותרת ${i} ב-PDF שונה מהמודל`);
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
      assertEq(px(match.style.lineHeight), H3_SPAN_LINE_H, 'line-height שורת כותרת ב-DOM חייב להתאים ל-CSS הישן');
    }
    clearRegisteredFonts();
  });
});

report('s2-heading3-spacing');
