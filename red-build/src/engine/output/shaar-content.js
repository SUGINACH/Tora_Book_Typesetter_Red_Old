// src/engine/output/shaar-content.js — מודל תוכן עמודי השער (03.11(ד))
'use strict';

/**
 * **מקור יחיד (F-09) לתוכן המובנה של עמודי השער** — פורט renderMainShaar/
 * renderSubShaar/renderBackShaar של הפרויקט המקורי. נצרך על ידי שני הנתיבים:
 * dom-renderer (תצוגה חיה + ייצוא HTML) ו-geometry-projector (ייצוא PDF) —
 * כך שהשער נראה אותו דבר בכל הפלטים (עד כאן ההיטל לא כלל את תוכן השער
 * וה־PDF הראה עמודים ריקים).
 *
 * המודל: תיבה (מ"מ של המקור) + רשימת בלוקים (טקסט/גודל/משקל) + אופן פריסה:
 * 'between' = flex space-between (שער ראשי: בס״ד למעלה, שנה למטה), 'center'
 * = flex ממורכז (שער־משנה/אחורי). העיטור (כתר) הוא בלוק גרפי ללא טקסט —
 * ה-DOM מצייר אותו; ההיטל מדלג (במקור לא היה ייצוא PDF כלל).
 */

const MM_TO_PX = 96 / 25.4;

/** תיבת השער לפי הסוג — מיקומי המקור (מ"מ → פיקסלים). */
function shaarBoxOf(type) {
  const mm = (v) => Math.round(v * MM_TO_PX);
  if (type === 'shaar-main') {
    return { top: mm(20), bottom: mm(16), right: mm(15), left: mm(15), mode: 'between' };
  }
  if (type === 'shaar-sub') {
    return { top: mm(20), bottom: mm(20), right: mm(95), left: mm(15), mode: 'center' };
  }
  // shaar-back
  return { top: mm(22), bottom: mm(18), right: mm(15), left: mm(95), mode: 'center' };
}

/** פיצול מקף של כותרת חלק (renderSubShaar המקורי): main=לפני, sub=אחרי. */
function splitPartTitle(text) {
  let titleMain = String(text || '');
  let titleSub = '';
  if (/[-–—]/.test(titleMain)) {
    const parts = titleMain.split(/[-–—]/);
    titleMain = parts[0].trim();
    titleSub = parts.slice(1).join(' - ').trim();
  }
  return { titleMain, titleSub };
}

/**
 * בניית בלוקי תוכן השער. גישה מילולית להגדרות (דרישת סורק ה-phantom-key).
 * @param {object} page - עמוד CP5 (shaarInfo.title לשער־משנה, _metadata למטא)
 * @param {object} settings
 * @param {object} [metadata] - מטא המסמך (גובר _metadata)
 * @returns {{mode:string, box:object, blocks:Array<{cls,text,sizePt,bold,graphic}>}|null}
 */
function buildShaarBlocks(page, settings, metadata) {
  if (!page || !page.type || !/^shaar-/.test(page.type)) return null;
  const meta = metadata || page._metadata || {};
  const bookTitle = settings['imud-book-title'] || meta['שם הספר'] || meta['ספר'] || meta['title'] || 'שם הספר';
  const subtitle = settings['imud-book-subtitle'] || meta['נושא'] || '';
  const desc = settings['imud-book-desc'] || meta['נושא מפורט'] || '';
  const sections = settings['imud-book-sections'] || meta['פרטי מהדורא'] || '';
  const author = settings['imud-book-author'] || meta['שם המחבר'] || '';
  const year = settings['imud-book-year'] || meta['מקום ושנת הוצאה'] || '';

  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 12; };
  const box = shaarBoxOf(page.type);
  const B = [];

  if (page.type === 'shaar-main') {
    B.push({ cls: 'bsd-header', text: 'בס״ד', sizePt: num(settings['shaar-year-size-pt']), bold: true, letterSpacingPx: 5 });
    B.push({ cls: 'book-title-main', text: bookTitle, sizePt: num(settings['shaar-title-size-pt']) });
    B.push({ cls: 'book-subtitle', text: subtitle, sizePt: num(settings['shaar-subtitle-size-pt']), bold: true });
    B.push({ cls: 'shaar-crown', text: '', sizePt: 0, graphic: 'crown-main' });
    B.push({ cls: 'book-description', text: desc, sizePt: num(settings['shaar-desc-size-pt']) });
    B.push({ cls: 'book-sections-summary', text: sections, sizePt: num(settings['shaar-sections-size-pt']), bold: true });
    B.push({ cls: 'author-block', text: author, sizePt: num(settings['shaar-author-size-pt']) });
    B.push({ cls: 'publication-footer', text: year, sizePt: num(settings['shaar-year-size-pt']), bold: true, letterSpacingPx: 1 });
  } else if (page.type === 'shaar-sub') {
    const { titleMain, titleSub } = splitPartTitle(page.shaarInfo && page.shaarInfo.title);
    B.push({ cls: 'book-title-main', text: titleMain, sizePt: 36 });
    if (titleSub) {
      B.push({ cls: 'shaar-crown', text: '', sizePt: 0, graphic: 'crown-sub' });
      B.push({ cls: 'book-subtitle', text: titleSub, sizePt: num(settings['shaar-subtitle-size-pt']), bold: true });
    }
  } else {
    // **9b.5 (D-107 + F-9a-8):** ארבעת מקטעי השער האחורי — פורט renderBackShaar
    // של המקור: כותרת «כל הזכויות שמורות» (13.5pt) + זכויות יוצרים (10pt) +
    // הוצאה/פרסום (11pt) + קשר (10pt) + פרטים נוספים (9.5pt). מקור הערך:
    // שדה ההגדרה גובר (ייבוא inp-book-back-*; shaar-back-text ההיסטורי לזכויות);
    // נפילה למטא המסמך. **אין כותרת-ספר/מחבר/שנה בשער האחורי** (כמו במקור
    // שהופורט — עד כאן הוצגו שם בטעות), ו**אין ערכים מומצאים** — בלי ערך
    // אין מקטע (§6.2 בהוראת 9b).
    const copyright = settings['imud-book-back-copyright'] || settings['shaar-back-text'] || meta['שמירת זכויות'] || '';
    const publisher = settings['imud-book-back-publishing'] || meta['פרטי הוצאה לאור'] || '';
    const contact = settings['imud-book-back-contact'] || meta['פרטי קשר'] || '';
    const extra = settings['imud-book-back-extra'] || meta['פרטים נוספים'] || '';
    const pushSection = (value, sizePt) => {
      String(value).split('\n').map(l => l.trim()).filter(Boolean)
        .forEach(l => B.push({ cls: 'back-shaar-text-line', text: l, sizePt }));
    };
    if (copyright) B.push({ cls: 'back-shaar-copyright-header', text: 'כל הזכויות שמורות', sizePt: 13.5, bold: true });
    pushSection(copyright, 10);
    pushSection(publisher, 11);
    pushSection(contact, 10);
    pushSection(extra, 9.5);
  }
  return { mode: box.mode, box, blocks: B.filter(b => b.graphic || String(b.text || '').length) };
}

/** משפחות הגופן של הבלוקים — לפי ההגדרות (גישה מילולית לסורק). */
function shaarFontOf(cls, settings) {
  switch (true) {
    case cls.includes('bsd-header'):
    case cls.includes('publication-footer'): return settings['shaar-year-font'];
    case cls.includes('book-title-main'): return settings['shaar-title-font'];
    case cls.includes('book-subtitle'): return settings['shaar-subtitle-font'];
    case cls.includes('book-description'): return settings['shaar-desc-font'];
    case cls.includes('book-sections-summary'): return settings['shaar-sections-font'];
    case cls.includes('author-block'): return settings['shaar-author-font'];
    case cls.includes('back-shaar-copyright-header'):
    case cls.includes('back-shaar-text-line'): return settings['shaar-back-text-font'];
    default: return '';
  }
}

/** **פרוסה 3 (§2.2 — הדיו מגיע מהמודל):** SVG הכתרים של השערים — מקור יחיד.
 * עד כאן היו מוטמעים בתוך dom-renderer.renderShaarContent (innerHTML) —
 * המקרין של ה-PageModel חייב את אותו דיו בדיוק; ההטבעה עוברת לכאן ושני
 * המקרינים צורכים ממקור אחד (אין עותק שני של הנתיבים). */
function crownSvgOf(graphic) {
  if (graphic === 'crown-sub') {
    return '<svg viewBox="0 0 300 30" xmlns="http://www.w3.org/2000/svg"><path d="M10,15 Q75,5 140,15 Q145,10 150,5 Q155,10 160,15 Q225,5 290,15 Q225,25 160,15 Q155,20 150,25 Q145,20 140,15 Q75,25 10,15 Z" fill="#222"/></svg>';
  }
  return '<svg viewBox="0 0 400 40" xmlns="http://www.w3.org/2000/svg"><circle cx="200" cy="20" r="10" fill="none" stroke="#000" stroke-width="4.5"/><circle cx="200" cy="20" r="4.5" fill="#000"/><path d="M182,20 C182,24 165,27 140,27 C90,27 40,22 5,20 C40,18 90,13 140,13 C165,13 182,16 182,20 Z" fill="#000"/><path d="M218,20 C218,24 235,27 260,27 C310,27 360,22 395,20 C360,18 310,13 260,13 C235,13 218,16 218,20 Z" fill="#000"/></svg>';
}

module.exports = { buildShaarBlocks, shaarBoxOf, shaarFontOf, crownSvgOf, splitPartTitle, MM_TO_PX };
