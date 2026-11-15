// tests/unit/s3-immutability.test.js — שלב 3, תיקון ביקורת PR #22:
// immutability אמיתי של MeasuredItem — Object.freeze(out) לבדו אינו מקפיא
// מבנים פנימיים (segmentים, הזדמנויות שבירה, diagnostics, natural/fit/placement)
// ו-Map של measureDocumentModel אינו נאטם ע"י Object.freeze בלבד.
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const {
  measureItem, itemCacheStats, clearItemMeasureCache
} = require('../../src/engine/typography/measure-api');
const fontResolver = require('../../src/engine/typography/font-resolver');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { measureDocumentModel } = require('../../src/engine/measure/measure-model');

const REPO = path.join(__dirname, '..', '..');
const ASSETS = path.join(REPO, 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const bytesOf = (fam) => { const e = CATALOG.find(x => x.family === fam); return fs.readFileSync(path.join(ASSETS, 'fonts', e.file)); };

function registerRealFonts() {
  fontResolver.clearFontResolver();
  fontResolver.registerFont('Frank Ruhl Libre', bytesOf('Frank Ruhl Libre'), { source: 'imud-catalog' });
  fontResolver.registerFont('David Libre', bytesOf('David Libre'), { source: 'imud-catalog' });
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

/** סריקת השגה: כל אובייקט/מערך plain הנגיש מהשורש חייב להיות קפוא. */
function assertAllFrozen(root, label) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    assert(Object.isFrozen(v), `${label}: אובייקט נגיש לא קפוא — ${Object.prototype.toString.call(v)}`);
    if (Array.isArray(v)) { for (const x of v) stack.push(x); }
    else { for (const k of Object.keys(v)) stack.push(v[k]); }
  }
}

/** ניסיון מוטציה במצב strict אמור לזרוק TypeError על אובייקט קפוא. */
function assertMutationThrows(obj, prop, label) {
  let threw = false;
  try { 'use strict'; obj[prop] = 12345; } catch (e) { threw = e instanceof TypeError; }
  // גם אם לא נזרק (סביבה מתקמת) — הערך אסור שישתנה
  assert(threw || obj[prop] !== 12345, `${label}: המוטציה נבלעה`);
}

describe('שלב 3 — MeasuredItem: immutability אמיתי (עומק מלא)', () => {
  it('טקסט: כל מבנה פנימי קפוא — inkBounds, segments[i], breakOpportunities[i], diagnostics', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'im-t1', kind: 'text', payload: { runs: [
      { text: 'מילה ראשונה ', fontFamily: 'Frank Ruhl Libre' },
      { text: 'ומילה שנייה', fontFamily: 'Frank Ruhl Libre' }
    ] } };
    const m = measureItem(item, { sizePt: 12, lineHeight: 1.34, fontIds: [f, f] }, { direction: 'rtl', language: 'he' });
    assert(m.ok, m.code);
    assert(m.segments.length === 2 && m.breakOpportunities.length >= 2, 'יש מבנים לבדוק');
    assertAllFrozen(m, 'MeasuredItem(טקסט)');
    assertMutationThrows(m.inkBounds, 'left', 'inkBounds');
    assertMutationThrows(m.segments[0], 'advancePx', 'segment');
    assertMutationThrows(m.breakOpportunities[0], 'offset', 'break');
    assertMutationThrows(m, 'advance', 'התוצאה עצמה');
    try { m.segments.push({}); throw new Error('לא אמור להגיע'); } catch (e) { assert(e instanceof TypeError, 'push למערך segments נחסם: ' + e.message); }
  });
  it('תמונה: natural, fit, placement — כולם קפואים עמוק', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    const id = ar.addBytes('img/im.png', tinyPng(30, 18)).assetId;
    const item = { id: 'im-i1', kind: 'image', payload: { contentAssetId: id, resourcePath: 'img/im.png', widthPct: 60 }, constraints: { participates: 'inline', wrap: 'none' } };
    const m = measureItem(item, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 250 } });
    assert(m.ok, m.code);
    assertAllFrozen(m, 'MeasuredItem(תמונה)');
    assertMutationThrows(m.natural, 'width', 'natural');
    assertMutationThrows(m.fit, 'widthPct', 'fit');
    assertMutationThrows(m.placement, 'wrap', 'placement');
  });
  it('דחייה (ok:false) — גם היא בלתי-ניתנת לשינוי', () => {
    const bad = measureItem({ id: 'im-x', kind: 'mystery' }, {}, {});
    assert(!bad.ok);
    assertAllFrozen(bad, 'דחייה');
  });
  it('מוטציה של הקלט אחרי המדידה אינה משנה מדידה שכבר נוצרה', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'im-mut', kind: 'text', payload: { runs: [{ text: 'קלט מקורי', fontFamily: 'Frank Ruhl Libre' }] } };
    const style = { sizePt: 12, fontIds: [f] };
    const ctx = { direction: 'rtl', language: 'he' };
    const before = measureItem(item, style, ctx);
    const advBefore = before.advance;
    // שינוי האובייקט החיצוני שהועבר כקלט — המדידה שנוצרה לא תשתנה
    item.payload.runs[0].text = 'טקסט שהשתנה לחלוטין';
    style.sizePt = 40;
    ctx.direction = 'ltr';
    assertEq(before.advance, advBefore, 'המדידה הקיימת קפואה');
    assertEq(before.segments[0].text, 'קלט מקורי', 'התוכן בתוצאה מהזמן שנמדד');
    assertEq(before.direction, 'rtl', 'ההקשר נלכד בזמן המדידה');
    // מדידה חוזרת של הקלט שהשתנה — מפתח חדש, תוצאה חדשה
    const after = measureItem(item, { sizePt: 40, fontIds: [f] }, { direction: 'ltr', language: 'he' });
    assert(after !== before && Math.abs(after.advance - advBefore) > 0.001, 'קלט שהשתנה ⇒ מדידה חדשה');
  });
  it('מדידה חוזרת מחזירה תוצאה זהה (אותו אובייקט מהמטמון) — אין דליפת mutable', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'im-again', kind: 'text', payload: { runs: [{ text: 'עקביות מדידה', fontFamily: 'Frank Ruhl Libre' }] } };
    const style = { sizePt: 12, fontIds: [f] };
    const ctx = { direction: 'rtl', language: 'he' };
    const a = measureItem(item, style, ctx);
    const b = measureItem(item, style, ctx);
    assert(a === b, 'hit — אותו אובייקט');
    assertAllFrozen(b, 'תוצאה מהמטמון');
    assertEq(a.advance, b.advance);
    // שינוי ה-style (אובייקט הקלט) אחרי השימוש — רשומת המטמון נותרת קפואה ונקייה
    style.sizePt = 30;
    assertAllFrozen(measureItem(item, { sizePt: 12, fontIds: [f] }, ctx), 'רשומת מטמון אחרי שינוי קלט');
  });
});

describe('שלב 3 — measureDocumentModel: מפת התוצאות קריאה-בלבד; דחיות וסטטיסטיקה קפואות', () => {
  it('set/delete/clear על measured זורקים — אין דרך לשנות תוצאות מדידה שנחתמו', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/doc.png', tinyPng(8, 12));
    const raw = 'כותרת 1 - חלק\nפסקה עם תמונה #img/doc.png# וטקסט [הערה] וסיום אמיתי.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const res = measureDocumentModel(model, {
      settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre', 'f-note-body-size-pt': 8 },
      assetResolver: ar
    });
    assert(res.ok, JSON.stringify(res.rejected));
    const firstId = res.measured.keys().next().value;
    for (const op of ['set', 'delete', 'clear']) {
      let threw = false;
      try { res.measured[op](op === 'set' ? [firstId, {}] : firstId); } catch (e) { threw = e instanceof TypeError; }
      assert(threw, `${op} על מפת המדידות חייב לזרוק TypeError`);
    }
    assertEq(res.measured.size, res.stats.measured, 'הגודל נשמר');
    assert(res.measured.get(firstId) && res.measured.has(firstId), 'קריאה עדיין עובדת');
    // איטרציה מלאה — אותו ממשק Map לקריאה
    let n = 0; for (const [k, v] of res.measured) { assert(v.itemId === k || v.itemId != null); n++; }
    assertEq(n, res.stats.measured, 'Symbol.iterator');
  });
  it('rejected ו-stats קפואים; דחייה מתועדת ולא נעלמת', () => {
    clearItemMeasureCache();
    const model = buildDocumentModel('כותרת 1 - חלק\nפסקה עם תמונה #img/missing.png# בפנים.\n', {});
    const res = measureDocumentModel(model, {
      settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' },
      assetResolver: null // אין resolver ⇒ התמונה נדחית במפורש, לא נעלמת
    });
    assert(!res.ok && res.rejected.length === 1, 'דחייה מפורשת: ' + JSON.stringify(res.rejected));
    assert(res.rejected[0].code === 'no-asset-resolver', res.rejected[0].code);
    assert(Object.isFrozen(res.rejected) && Object.isFrozen(res.rejected[0]), 'rejected קפוא');
    assert(Object.isFrozen(res.stats), 'stats קפוא');
    let threw = false;
    try { res.rejected.push({}); } catch (e) { threw = true; }
    assert(threw, 'דחיות לא ניתנות להרחבה');
  });
  it('מודל חסר — הפלט עדיין בלתי-ניתן לשינוי', () => {
    const res = measureDocumentModel(null, {});
    assert(!res.ok && res.rejected[0].code === 'no-model');
    let threw = false;
    try { res.measured.set('x', {}); } catch (e) { threw = true; }
    assert(threw, 'גם מפה ריקה חסומה לכתיבה');
  });
  it('דטרמיניזם לאורך סבבים: הרצה כפולה — אותם אובייקטים, הכל קפוא', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/det.png', tinyPng(8, 12));
    const model = buildDocumentModel('כותרת 1 - חלק\nפסקה לדטרמיניזם [עם הערה] וסיום.\n', { assets: ar });
    const ctx = { settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' }, assetResolver: ar };
    const a = measureDocumentModel(model, ctx);
    const b = measureDocumentModel(model, ctx);
    for (const [k, v] of a.measured) {
      assert(b.measured.get(k) === v, `אותו אובייקט עבור ${k}`);
      assertAllFrozen(v, `ערך ${k}`);
    }
  });
});

report('s3-immutability');
