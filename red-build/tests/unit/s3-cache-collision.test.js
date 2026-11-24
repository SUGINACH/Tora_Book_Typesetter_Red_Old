// tests/unit/s3-cache-collision.test.js — שלב 3, תיקון ביקורת PR #22:
// מפתח מטמון המדידה — בדיקות התנגשות מכוונות של אותו item.id עם תוכן שונה.
// הפגם שתוקן: item.id שימש לבדו כמפתח כשקיים מזהה ⇒ שני פריטים בעלי אותו
// מזהה ו-payload שונה קיבלו את אותה מדידה (correctness חמור).
// כל בדיקה כאן מייצרת במכוון collision של מזהים — לא מזהים שונים.
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const {
  measureItem, itemCacheStats, clearItemMeasureCache, environmentFingerprint,
  clearRegisteredFonts
} = require('../../src/engine/typography/measure-api');
const fontResolver = require('../../src/engine/typography/font-resolver');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');

const REPO = path.join(__dirname, '..', '..');
const ASSETS = path.join(REPO, 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const bytesOf = (fam) => { const e = CATALOG.find(x => x.family === fam); return fs.readFileSync(path.join(ASSETS, 'fonts', e.file)); };

function registerRealFonts() {
  fontResolver.clearFontResolver();
  const frl = fontResolver.registerFont('Frank Ruhl Libre', bytesOf('Frank Ruhl Libre'), { source: 'imud-catalog' });
  const dl = fontResolver.registerFont('David Libre', bytesOf('David Libre'), { source: 'imud-catalog' });
  return { frl, dl };
}

function tinyPng(w, h) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255,
      (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]), Buffer.from('IDAT'), Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'), Buffer.from([0, 0, 0, 0])
  ]);
}

/** נקודת בקרה: cache miss מוכח ע"י תוצאה שונה + אובייקט שונה; hit — אותו אובייקט. */
function stats() { return itemCacheStats().entries; }

describe('שלב 3 — מפתח מטמון: אותו item.id עם payload שונה ⇒ cache miss (תיקון שורש)', () => {
  it('אותו ID, טקסט שונה ⇒ מדידות שונות (לא אותה רשומה)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const i1 = { id: 'same-id', kind: 'text', payload: { runs: [{ text: 'שלום עולם', fontFamily: 'Frank Ruhl Libre' }] } };
    const i2 = { id: 'same-id', kind: 'text', payload: { runs: [{ text: 'טקסט אחר לגמרי ארוך יותר', fontFamily: 'Frank Ruhl Libre' }] } };
    const m1 = measureItem(i1, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    const m2 = measureItem(i2, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    assert(m1 !== m2, 'אובייקטים נפרדים — cache miss');
    assert(Math.abs(m1.advance - m2.advance) > 0.001, `רוחבים שונים בפועל (${m1.advance} מול ${m2.advance})`);
  });
  it('אותו ID, תמונה שונה ⇒ מדידות שונות', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    const idA = ar.addBytes('img/a.png', tinyPng(8, 12)).assetId;
    const idB = ar.addBytes('img/b.png', tinyPng(64, 32)).assetId;
    const i1 = { id: 'same-img', kind: 'image', payload: { contentAssetId: idA, resourcePath: 'img/a.png' } };
    const i2 = { id: 'same-img', kind: 'image', payload: { contentAssetId: idB, resourcePath: 'img/b.png' } };
    const m1 = measureItem(i1, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 400 } });
    const m2 = measureItem(i2, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 400 } });
    assert(m1 !== m2, 'cache miss');
    assert(m1.natural.width !== m2.natural.width && m1.natural.height !== m2.natural.height, `טבעי שונה (${m1.natural.width}x${m1.natural.height} מול ${m2.natural.width}x${m2.natural.height})`);
    assert(Math.abs(m1.height - m2.height) > 1, `גבהים שונים לפי יחס (${m1.height} מול ${m2.height})`);
  });
  it('אותו ID, רוחב זמין שונה ⇒ cache miss וגודל תצוגה שונה', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    const id = ar.addBytes('img/c.png', tinyPng(20, 10)).assetId;
    const item = { id: 'same-w', kind: 'image', payload: { contentAssetId: id, resourcePath: 'img/c.png', widthPct: 100 } };
    const m1 = measureItem(item, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 200 } });
    const m2 = measureItem(item, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 400 } });
    assert(m1 !== m2, 'cache miss');
    assertEq(Math.round(m1.width), 200, 'רוחב מאילוץ ראשון');
    assertEq(Math.round(m2.width), 400, 'רוחב מאילוץ שני');
  });
  it('אותו ID, widthPct שונה ⇒ cache miss', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    const id = ar.addBytes('img/d.png', tinyPng(20, 10)).assetId;
    const i1 = { id: 'same-pct', kind: 'image', payload: { contentAssetId: id, resourcePath: 'img/d.png', widthPct: 50 } };
    const i2 = { id: 'same-pct', kind: 'image', payload: { contentAssetId: id, resourcePath: 'img/d.png', widthPct: 80 } };
    const m1 = measureItem(i1, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 200 } });
    const m2 = measureItem(i2, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 200 } });
    assert(m1 !== m2, 'cache miss');
    assertEq(Math.round(m1.width), 100, '50%');
    assertEq(Math.round(m2.width), 160, '80%');
  });
  it('אותו ID, גופן שונה ⇒ cache miss ורוחב שונה', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f1 = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const f2 = fontResolver.fontIdOfAlias('David Libre');
    const item = { id: 'same-font', kind: 'text', payload: { runs: [{ text: 'מילה משותפת', fontFamily: 'Frank Ruhl Libre' }] } };
    const m1 = measureItem(item, { sizePt: 12, fontIds: [f1] }, { direction: 'rtl' });
    const m2 = measureItem(item, { sizePt: 12, fontIds: [f2] }, { direction: 'rtl' });
    assert(m1 !== m2, 'cache miss');
    assert(Math.abs(m1.advance - m2.advance) > 0.001, `משפחות שונות נמדדות שונה (${m1.advance} מול ${m2.advance})`);
    assertEq(m1.segments[0].fontId, f1);
    assertEq(m2.segments[0].fontId, f2);
  });
  it('אותו ID, ריצות גופן שונות (font runs) ⇒ cache miss', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f1 = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const f2 = fontResolver.fontIdOfAlias('David Libre');
    const i1 = { id: 'same-runs', kind: 'text', payload: { runs: [
      { text: 'ש', fontFamily: 'Frank Ruhl Libre' }, { text: 'לום', fontFamily: 'Frank Ruhl Libre' }
    ] } };
    const i2 = { id: 'same-runs', kind: 'text', payload: { runs: [
      { text: 'ש', fontFamily: 'Frank Ruhl Libre' }, { text: 'לום', fontFamily: 'David Libre' }
    ] } };
    const m1 = measureItem(i1, { sizePt: 12, fontIds: [f1, f1] }, { direction: 'rtl' });
    const m2 = measureItem(i2, { sizePt: 12, fontIds: [f1, f2] }, { direction: 'rtl' });
    assert(m1 !== m2, 'cache miss');
    assertEq(m1.segments.length, 2); assertEq(m2.segments.length, 2);
    assertEq(m2.segments[1].fontId, f2, 'הריצה השנייה בגופן השונה');
  });
  it('אותו ID, אילוצי רוחב שונים בטקסט ⇒ מפתחות נפרדים (constraints במפתח)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'same-cons', kind: 'text', payload: { runs: [{ text: 'אילוץ', fontFamily: 'Frank Ruhl Libre' }] } };
    const before = stats();
    const m1 = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'rtl', constraints: { availableWidthPx: 100 }, constraintsKey: 'w100' });
    const m2 = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'rtl', constraints: { availableWidthPx: 300 }, constraintsKey: 'w300' });
    assert(m1 !== m2, 'cache miss');
    assert(stats() >= before + 2, 'שתי רשומות נפרדות');
  });
});

describe('שלב 3 — מפתח מטמון: אותו קלט בדיוק ⇒ hit; בידוד סביבות ונכסים', () => {
  it('אותו קלט בדיוק ⇒ cache hit ואותה תוצאה (אותו אובייקט)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'hit-1', kind: 'text', payload: { runs: [{ text: 'בדיקת החזה', fontFamily: 'Frank Ruhl Libre' }] } };
    const style = { sizePt: 12, lineHeight: 1.34, fontIds: [f] };
    const ctx = { direction: 'rtl', language: 'he' };
    const a = measureItem(item, style, ctx);
    const b = measureItem(item, style, ctx);
    assert(a === b, 'cache hit — אותו אובייקט');
    assertEq(a.advance, b.advance);
  });
  it('אותו resourcePath עם תוכן נכס שונה ⇒ אין שיתוף מטמון שגוי', () => {
    registerRealFonts();
    clearItemMeasureCache();
    // resolver א': img/x.png = 8x12 ; resolver ב': אותה הפניה, תוכן אחר (16x20 — יחס שונה)
    const arA = new AssetResolver();
    arA.addBytes('img/x.png', tinyPng(8, 12));
    const arB = new AssetResolver();
    arB.addBytes('img/x.png', tinyPng(16, 20));
    const item = { id: 'path-same', kind: 'image', payload: { assetId: null, resourcePath: 'img/x.png', widthPct: 100 } };
    const mA = measureItem(item, { sizePt: 12 }, { assetResolver: arA, constraints: { availableWidthPx: 400 } });
    const mB = measureItem(item, { sizePt: 12 }, { assetResolver: arB, constraints: { availableWidthPx: 400 } });
    assert(mA !== mB, 'cache miss');
    assertEq(mA.natural.width, 8, 'טבעי מ-resolver א');
    assertEq(mB.natural.width, 16, 'טבעי מ-resolver ב — התוכן החדש, לא הישן');
    assert(Math.abs(mA.height - mB.height) > 1, `גבהים שונים לפי יחס (${mA.height} מול ${mB.height})`);
  });
  it('interleaving של מסמכים שונים: אותו מזהה בשני מסמכים — כל אחד מקבל את המדידה שלו, והחזרה אליו היא hit', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const style = { sizePt: 12, fontIds: [f] };
    const ctx = { direction: 'rtl', language: 'he' };
    const docA = { id: 'inter', kind: 'text', payload: { runs: [{ text: 'מסמך א תוכן', fontFamily: 'Frank Ruhl Libre' }] } };
    const docB = { id: 'inter', kind: 'text', payload: { runs: [{ text: 'מסמך ב תוכן שונה', fontFamily: 'Frank Ruhl Libre' }] } };
    // שילוב מכוון: A, B, A, B — החזרה ל-A חייבת להחזיר את מדידת A (hit), לא את B
    const a1 = measureItem(docA, style, ctx);
    const b1 = measureItem(docB, style, ctx);
    const a2 = measureItem(docA, style, ctx);
    const b2 = measureItem(docB, style, ctx);
    assert(a1 === a2 && b1 === b2, 'חזרה לכל מסמך = hit');
    assert(a1 !== b1, 'מסמכים שונים לא משתפים רשומה');
    assert(Math.abs(a1.advance - b1.advance) > 0.001, 'התוכן שונה ⇒ הרוחב שונה');
    // המדידה שהוחזרה היא של התוכן הנכון — עמידות מפני החלפה שקטה
    const wA = require('../../src/engine/typography/measure-api').MeasureAPI.forFontId(f, { 'body-font-size-pt': 12 }).measureTextWidth('מסמך א תוכן', 12, 0);
    assert(Math.abs(a1.advance - wA) < 1e-9, 'a1 = מדידת תוכן א');
  });
  it('מפתח קנוני: סדר מפתחות אובייקט שונה ב-payload זהה תוכנית ⇒ אותה מדידה (hit)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    // אותם נתונים, סדר הכנסת מפתחות שונה — הסריאליזציה הקנונית ממיינת
    const i1 = { id: 'ord', kind: 'text', payload: { runs: [{ fontFamily: 'Frank Ruhl Libre', text: 'סדר מפתחות' }] } };
    const i2 = { id: 'ord', kind: 'text', payload: { runs: [{ text: 'סדר מפתחות', fontFamily: 'Frank Ruhl Libre' }] } };
    const m1 = measureItem(i1, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    const m2 = measureItem(i2, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    assert(m1 === m2, 'סדר מפתחות אינו חלק מהתוכן — hit לגיטימי');
  });
  it('חית סביבה מגיבה לזהות התוכן: אותו שם, בתים שונים ⇒ חית שונה', () => {
    fontResolver.clearFontResolver();
    fontResolver.registerFont('Same Name', bytesOf('Frank Ruhl Libre'));
    const fp1 = environmentFingerprint();
    fontResolver.clearFontResolver();
    fontResolver.registerFont('Same Name', bytesOf('David Libre'));
    const fp2 = environmentFingerprint();
    assert(fp1 !== fp2, 'זהות תוכן שונה ⇒ חית שונה');
    assert(fp1.includes('fnt-') && fp2.includes('fnt-'), 'החית מזהויות כתובות-תוכן');
    clearRegisteredFonts();
    assert(environmentFingerprint().endsWith('fonts=none'), 'ניקוי — חית נקייה');
  });
});

report('s3-cache-collision');
