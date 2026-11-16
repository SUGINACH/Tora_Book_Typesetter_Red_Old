// tests/unit/s3-measure.test.js — שלב 3: מדידה קנונית (§3.1-5..13, §3.3)
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const {
  MeasureAPI, measureItem, environmentFingerprint, itemCacheStats, clearItemMeasureCache
} = require('../../src/engine/typography/measure-api');
const fontResolver = require('../../src/engine/typography/font-resolver');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { measureDocumentModel } = require('../../src/engine/measure/measure-model');
const { ptToPx, pxToPt, mmToPx, roundPx } = require('../../src/engine/typography/units');

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

describe('שלב 3 — Font Resolver: זהות, מטריקות, fallback מאובחן', () => {
  it('זהות content-addressed מהבתים + מטריקות מטבלאות אמת', () => {
    const { frl } = registerRealFonts();
    assert(frl.ok && /^fnt-[0-9a-f]{14}$/.test(frl.fontId), frl.fontId);
    const m = frl.record.metrics;
    assert(m.unitsPerEm === 1000, 'unitsPerEm');
    assert(m.ascenderEm > 0.5 && m.ascenderEm < 1.5, 'ascender');
    assert(m.capHeightEm > 0.3 && m.capHeightEm < 1.0, 'capHeight');
    assert(frl.record.fingerprint.length === 14, 'טביעת אצבע משלימה');
  });
  it('רישום כפול — idempotent; alias כפול על גופן שונה — דחייה מפורשת', () => {
    registerRealFonts();
    const again = fontResolver.registerFont('Frank Ruhl Libre', bytesOf('Frank Ruhl Libre'));
    assert(again.ok && !again.isNew, 'idempotent');
    const conflict = fontResolver.registerFont('Frank Ruhl Libre', bytesOf('David Libre'));
    assert(!conflict.ok && conflict.code === 'alias-conflict', 'conflict');
  });
  it('fallback מפורש עם סיבה — לא שקט (§3.1-5)', () => {
    registerRealFonts();
    const direct = fontResolver.resolveFont('Frank Ruhl Libre');
    assert(direct.ok && direct.fallbackUsed === false, 'direct');
    const fb = fontResolver.resolveFont('NoSuchFamily', { fallbacks: ['Frank Ruhl Libre'] });
    assert(fb.ok && fb.fallbackUsed === true, 'fallback נבחר');
    assert(fb.diagnostics.some(d => d.code === 'font-not-registered' && d.alias === 'NoSuchFamily'), 'אבחון הדילוג');
    assert(fb.fallbackChain.some(h => !h.chosen), 'שרשרת מתועדת');
    const none = fontResolver.resolveFont('NoSuchFamily');
    assert(!none.ok && none.code === 'font-unavailable', 'בלי fallback — דחייה מפורשת');
  });
  it('זהות בין ריצות: אותם בתים — אותו fontId', () => {
    registerRealFonts();
    const a = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    fontResolver.clearFontResolver();
    fontResolver.registerFont('Frank Ruhl Libre', bytesOf('Frank Ruhl Libre'));
    assertEq(fontResolver.fontIdOfAlias('Frank Ruhl Libre'), a, 'זהות דטרמיניסטית');
  });
});

describe('שלב 3 — measureItem: MeasuredItem קנוני ובלתי-ניתן לשינוי', () => {
  it('טקסט בגופן אמת: advance/ascent/descent/baseline/height + הפרדת advance/ink', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const { frl } = { frl: { fontId: fontResolver.fontIdOfAlias('Frank Ruhl Libre') } };
    const item = { id: 'itm-t1', kind: 'text', payload: { runs: [{ text: 'שלום עליכם', fontFamily: 'Frank Ruhl Libre' }] } };
    const m = measureItem(item, { sizePt: 12, lineHeight: 1.34, fontIds: [frl.fontId] }, { direction: 'rtl', language: 'he' });
    assert(m.ok, m.code);
    assert(m.advance > 0 && m.width === m.advance, 'advance');
    assert(m.ascent > 0 && m.descent > 0 && m.baseline === m.ascent, 'baseline');
    assert(Math.abs(m.height - ptToPx(12) * 1.34) < 1e-9, 'height');
    assert(m.inkBounds.source === 'advance-approximation' && m.inkBounds.right === m.advance, 'ink מופרד מ-advance ומתועד');
    assert(Object.isFrozen(m) && Object.isFrozen(m.segments), 'immutable');
  });
  it('מילה מעורבת בכמה גופנים: כל מקטע במשפחתו, הסכום = ה-advance (§3.1-6)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f1 = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const f2 = fontResolver.fontIdOfAlias('David Libre');
    const item = { id: 'itm-t2', kind: 'text', payload: { runs: [
      { text: 'ש', fontFamily: 'Frank Ruhl Libre' },
      { text: 'לום', fontFamily: 'David Libre' }
    ] } };
    const m = measureItem(item, { sizePt: 12, fontIds: [f1, f2] }, { direction: 'rtl' });
    assert(m.ok && m.segments.length === 2, 'שני מקטעים');
    assertEq(m.segments[0].fontId, f1);
    assertEq(m.segments[1].fontId, f2);
    assert(Math.abs(m.segments.reduce((s, x) => s + x.advancePx, 0) - m.advance) < 1e-9, 'סכום מקטעים');
    // שני הגופנים באמת נותנים רוחב שונה לאותו טקסט — המקטעים לא זהים
    const api1 = MeasureAPI.forFontId(f1, { 'body-font-size-pt': 12 });
    const api2 = MeasureAPI.forFontId(f2, { 'body-font-size-pt': 12 });
    assert(Math.abs(api1.measureTextWidth('לום', 12, 0) - api2.measureTextWidth('לום', 12, 0)) > 0.001, 'משפחות שונות נמדדות שונה');
  });
  it('טווחי גופן מקוננים מהמקור — נשמרים כ-runs ונמדדים פר-מקטע (גבול מדידה יחיד — שלב 4 מקטע ב׳, הוראה §5)', () => {
    registerRealFonts();
    const inlineOptions = { fontMarkers: [
      { id: 'david', open: '<<', close: '>>', family: 'David Libre' }
    ] };
    const raw = 'כותרת 1 - חלק\nמילה מעורבת ש<<לום>>ם עוד טקסט כאן לבדיקה.\n';
    const model = buildDocumentModel(raw, { inlineOptions });
    const para = model.blocks.find(b => b.kind === 'paragraph');
    const runs = para.items[0].payload.runs;
    assert(runs.length === 3 && runs[1].fontFamily === 'David Libre', JSON.stringify(runs.map(r => r.fontFamily)));
    // **הגבול החדש:** measureDocumentModel מודד את פריטי השורה הקנוניים (מילים)
    // — את אותן יחידות שה-LineBreaker צורך — ולא את הפריט המקורי בנפרד. המילה
    // חוצת-הריצות ש<<לום>>ם = תיבה אחת עם 3 פרגמנטים (§4.1-3) — לעולם לא מחרוזת שטוחה.
    const res = measureDocumentModel(model, { settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' } });
    const seq = res.sequences.find(s => s.blockId === para.id);
    assert(seq, 'רצף הפסקה קיים');
    const mixedWord = seq.items.find(it => it.role === 'box' && it.kind === 'text' && (it.fragments || []).length === 3);
    assert(mixedWord, 'מילה חוצת-ריצות עם 3 פרגמנטים: ' + JSON.stringify(seq.items.filter(i => i.role === 'box').map(i => i.itemId)));
    assertEq(mixedWord.fragments[1].fontId, fontResolver.fontIdOfAlias('David Libre'), 'פרגמנט הגופן הפנימי');
    // המדידה של התיבה מקושרת במפה — אותו MeasuredItem קפוא, בדיוק פעם אחת
    const m = res.measured.get(mixedWord.itemId);
    assert(m === mixedWord.measured, 'קישור MeasuredItem מהמפה');
    assert(m.ok && Math.abs(m.advance - mixedWord.measuredAdvance) < 1e-12, 'advance תואם');
    // סכום הפרגמנטים = הרוחב הכולל של המילה (מדידה פר-מקטע נשמרה ברמת הפרגמנט)
    const sum = mixedWord.fragments.reduce((s, f) => s + f.advancePx, 0);
    assert(Math.abs(sum - mixedWord.measuredAdvance) < 1e-9, 'סכום פרגמנטים');
  });
  it('תמונה: מדידה מ-metadata אמיתי + fit/scale + יחס-גובה נשמר (§3.1-3/4)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/t.png', tinyPng(8, 12));
    const item = { id: 'itm-i1', kind: 'image', payload: { assetId: null, contentAssetId: ar.resolve('img/t.png').assetId, resourcePath: 'img/t.png', widthPct: 50 }, constraints: { participates: 'inline', wrap: 'none' } };
    const m = measureItem(item, { sizePt: 12 }, { assetResolver: ar, constraints: { availableWidthPx: 200 }, constraintsKey: 'w200' });
    assert(m.ok, m.code);
    assertEq(m.width, 100, 'widthPct מהרוחב הזמין');
    assert(Math.abs(m.height - 150) < 1e-9, 'גובה לפי יחס');
    assert(Math.abs(m.width / m.height - m.natural.aspectRatio) < 1e-12, 'יחס נשמר');
    assert(m.fit.policy === 'width-pct' && m.fit.scaled, 'fit מתועד');
    assertEq(m.breakOpportunities.length, 0, 'אטום');
    assert(m.placement.participates === 'inline' && m.placement.wrap === 'none', 'מדיניות הצבה מהאילוצים');
  });
  it('תמונה בלי resolver/בלי נכס: אבחון מפורש — הפריט אינו נעלם (§3.1-11)', () => {
    const item = { id: 'itm-i2', kind: 'image', payload: { assetId: 'ast-x', resourcePath: 'nope.png' } };
    const noResolver = measureItem(item, {}, {});
    assert(!noResolver.ok && noResolver.code === 'no-asset-resolver', noResolver.code);
    const ar = new AssetResolver();
    const missing = measureItem(item, {}, { assetResolver: ar });
    assert(!missing.ok && missing.code === 'not-found', missing.code);
  });
  it('סמן הערה: אטום, בגודל הרישום', () => {
    clearItemMeasureCache();
    const m = measureItem({ id: 'itm-n1', kind: 'noteMarker', payload: { markerText: 'א.', noteRef: 'note-1' } }, { sizePt: 8 }, { direction: 'rtl' });
    assert(m.ok && m.advance > 0 && m.breakOpportunities.length === 0, 'אטום');
    assert(m.height < ptToPx(12), 'בגודל רישום, לא גוף');
  });
  it('RTL/LTR בהקשר: אותה מדידה, מפתח מטמון נפרד (בידוד הקשר)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'itm-dir', kind: 'text', payload: { runs: [{ text: 'אותו טקסט', fontFamily: 'Frank Ruhl Libre' }] } };
    const rtl = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'rtl', language: 'he' });
    const ltr = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'ltr', language: 'en' });
    assert(rtl !== ltr, 'אובייקטים נפרדים (מפתחות שונים)');
    assertEq(rtl.advance, ltr.advance, 'המדידה עצמה זהה (כיוון לא משנה רוחב)');
    assertEq(rtl.direction, 'rtl'); assertEq(ltr.direction, 'ltr');
  });
  it('סוג פריט לא נתמך: דחייה מפורשת', () => {
    const bad = measureItem({ id: 'x', kind: 'mystery' }, {}, {});
    assert(!bad.ok && bad.code === 'unsupported-item-kind', bad.code);
  });
});

describe('שלב 3 — מטמון מדידה: מפתח מלא ובידוד (§3.1-10)', () => {
  it('אותו קלט ⇒ אותו אובייקט (hit); גודל שונה ⇒ רשומה נפרדת', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const item = { id: 'itm-c1', kind: 'text', payload: { runs: [{ text: 'טקסט למטמון', fontFamily: 'Frank Ruhl Libre' }] } };
    const a = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    const b = measureItem(item, { sizePt: 12, fontIds: [f] }, { direction: 'rtl' });
    assert(a === b, 'cache hit');
    const c = measureItem(item, { sizePt: 14, fontIds: [f] }, { direction: 'rtl' });
    assert(c !== a && c.advance > a.advance, 'גודל שונה — רשומה נפרדת ותוצאה שונה');
  });
  it('פריט שונה (תוכן שונה) — אין שיתוף שגוי', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const i1 = { id: 'itm-a', kind: 'text', payload: { runs: [{ text: 'אאא', fontFamily: 'Frank Ruhl Libre' }] } };
    const i2 = { id: 'itm-b', kind: 'text', payload: { runs: [{ text: 'בבב', fontFamily: 'Frank Ruhl Libre' }] } };
    const m1 = measureItem(i1, { sizePt: 12, fontIds: [f] }, {});
    const m2 = measureItem(i2, { sizePt: 12, fontIds: [f] }, {});
    assert(m1 !== m2 && m1.itemId !== m2.itemId, 'פריטים נפרדים');
  });
  it('חסימת זיכרון (שלב 4 מקטע ב׳, תיקון שורש): המטמון חסום-תקרה; ניפוי אינו משנה תוצאות', () => {
    // רקע: בלי חסימה, המטמון שומר לנצח MeasuredItem לכל פריט שנמדד אי-פעם
    // (ספר 3.4MB ≈ 682 אלף ערכים ≈ 766MB — נמדד; OOM בבדיקות הספרים הארוכים
    // ודליפה ב-Worker). המטמון הוא מֵימוּז של פונקציה דטרמיניסטית טהורה —
    // חסימתו אינה יכולה לשנות פלט, וזו ההוכחה שמונעת שינוי-שקט בעתיד.
    const { clearRegisteredFonts } = require('../../src/engine/typography/measure-api');
    clearRegisteredFonts(); // מימוש הטבלה — מהיר וללא גופנים רשומים
    clearItemMeasureCache();
    const stats0 = itemCacheStats();
    assert(Number.isFinite(stats0.capacity) && stats0.capacity > 0, 'תקרה נחשפת בסטטיסטיקה: ' + JSON.stringify(stats0));
    const first = { id: 'itm-bound-first', kind: 'text', payload: { runs: [{ text: 'מילה-ראשונה-לחסימה' }] } };
    const r1 = measureItem(first, { sizePt: 12 }, {});
    assert(r1.ok, 'מדידה ראשונה תקינה');
    // מילוי מעבר לתקרה (תקרה + אצוות ניפוי + שוליים) בפריטים ייחודיים —
    // כל פריט נמדד בפועל (אין עקיפת המנגנון)
    const fill = stats0.capacity + 9000;
    for (let i = 0; i < fill; i++) {
      measureItem({ id: `itm-bound-${i}`, kind: 'text', payload: { runs: [{ text: 'מ' + i }] } }, { sizePt: 12 }, {});
    }
    const stats1 = itemCacheStats();
    assert(stats1.entries <= stats1.capacity, `המטמון חסום: ${stats1.entries} ≤ ${stats1.capacity}`);
    // הפריט הראשון נופה (הוכנס לפני המילוי) — מדידה חוזרת מחזירה אובייקט
    // חדש, אך **תוצאה זהה עד רמת הערכים** (דטרמיניזם טהור: ניפוי אינו
    // משנה פלט) — עדות שהחסימה בטוחה לתוצאות
    const r2 = measureItem(first, { sizePt: 12 }, {});
    assert(r2.ok, 'מדידה חוזרת אחרי ניפוי תקינה');
    assert(r1 !== r2, 'אובייקט חדש (הרשומה נופתה ונמדדה מחדש)');
    assertEq(JSON.stringify(r1), JSON.stringify(r2), 'תוצאה זהה ביט-לביט אחרי ניפוי ומדידה מחדש');
    // פגיעה חוזרת (hit) — עדיין חסום
    const r3 = measureItem(first, { sizePt: 12 }, {});
    assert(r3 === r2, 'hit רגיל אחרי המדידה החוזרת');
    assert(itemCacheStats().entries <= itemCacheStats().capacity, 'חסום גם לאחר הפגיעות');
    clearItemMeasureCache();
    assertEq(itemCacheStats().entries, 0, 'ניקוי מלא עדיין עובד');
  });
  it('חית סביבה מגיבה לסט הגופנים הרשום (רישום חדש משנה חית)', () => {
    registerRealFonts();
    const fp1 = environmentFingerprint();
    fontResolver.registerFont('Hadassah Friedlaender', bytesOf('Hadassah Friedlaender'));
    const fp2 = environmentFingerprint();
    assert(fp1 !== fp2, 'רישום גופן חדש משנה את החית');
    assert(fp2.includes('Hadassah'), 'הגופן החדש מופיע בחית');
    // טיקון: מחירת הרישומים מחזירה את החית למצב הקודם
    const { clearRegisteredFonts } = require('../../src/engine/typography/measure-api');
    clearRegisteredFonts();
    const fp3 = environmentFingerprint();
    assert(fp3.endsWith('fonts=none'), 'אפס גופנים — חית נקיה');
  });
});

describe('שלב 3 — measureDocumentModel: כל הפריטים נמדדים לפני שבירת שורות (§3.3)', () => {
  it('מסמך עם כל סוגי הפריטים: 100% מדידה או אבחון', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/tiny.png', tinyPng(8, 12));
    const inlineOptions = { fontMarkers: [{ id: 'david', open: '<<', close: '>>', family: 'David Libre' }] };
    const raw = 'כותרת 1 - חלק\nפסקה עם תמונה #img/tiny.png# וטקסט [הערה בתוך הפסקה] ומקטע <<בגופן אחר>> באותה מילה, וסיום אמיתי.\n';
    const model = buildDocumentModel(raw, { assets: ar, inlineOptions });
    const res = measureDocumentModel(model, {
      settings: { 'body-font-size-pt': 12, 'body-line-height': 1.34, 'body-font': 'Frank Ruhl Libre', 'f-note-body-size-pt': 8 },
      assetResolver: ar
    });
    assertEq(res.stats.measured + res.stats.rejected, res.stats.items, 'כיסוי מלא');
    assertEq(res.stats.rejected, 0, 'אין דחיות: ' + JSON.stringify(res.rejected));
    let kinds = {};
    for (const m of res.measured.values()) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    assert(kinds.text >= 3 && kinds.image === 1 && kinds.noteMarker === 1, JSON.stringify(kinds));
  });
  it('דטרמיניזם: שתי הרצות — אותן מדידות (עצמים מהמטמון)', () => {
    registerRealFonts();
    const ar = new AssetResolver();
    ar.addBytes('img/tiny.png', tinyPng(8, 12));
    const raw = 'כותרת 1 - חלק\nפסקה לדטרמיניזם [עם הערה] וסיום.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const ctx = { settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' }, assetResolver: ar };
    const a = measureDocumentModel(model, ctx);
    const b = measureDocumentModel(model, ctx);
    assertEq(a.stats.measured, b.stats.measured);
    for (const [k, v] of a.measured) assert(b.measured.get(k) === v, `אותו אובייקט עבור ${k}`);
  });
  it('Worker parity: אותם בתים דרך transport — אותן מדידות בצד השני', () => {
    registerRealFonts();
    const ar = new AssetResolver();
    ar.addBytes('img/tiny.png', tinyPng(8, 12));
    const t = ar.serializeForTransport();
    const ar2 = AssetResolver.fromTransport(t);
    const raw = 'כותרת 1 - חלק\nפסקה עם תמונה #img/tiny.png# וסיום אמיתי.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const ctxA = { settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' }, assetResolver: ar };
    const ctxB = { settings: { 'body-font-size-pt': 12, 'body-font': 'Frank Ruhl Libre' }, assetResolver: ar2 };
    const a = measureDocumentModel(model, ctxA);
    const b = measureDocumentModel(model, ctxB);
    assertEq(a.stats.measured, b.stats.measured);
    for (const [k, v] of a.measured) {
      const w = b.measured.get(k);
      assert(w, 'קיים בצד השני: ' + k);
      assert(Math.abs(w.advance - v.advance) < 1e-9, `advance זהה עבור ${k}`);
    }
  });
});

describe('שלב 3 — parity בין מקורות מדידה (table ↔ font-metrics) + יחידות', () => {
  it('דוח parity מספרי: סטייה מתועדת; font-metrics = מקור הסמכות כשהגופן רשום', () => {
    registerRealFonts();
    const f = fontResolver.fontIdOfAlias('Frank Ruhl Libre');
    const apiT = new MeasureAPI({ 'body-font': 'Frank Ruhl Libre' }, 'table');
    const apiF = MeasureAPI.forFontId(f, { 'body-font-size-pt': 12 });
    const words = ['שלום', 'עליכם', 'תורה', 'אמת', 'משפט', 'הלכה', 'ספר', 'לימוד'];
    const rows = [];
    let sumAbs = 0;
    for (const w of words) {
      const t = apiT.measureTextWidth(w, 12, 0);
      const r = apiF.measureTextWidth(w, 12, 0);
      const dev = Math.abs(t - r);
      sumAbs += dev;
      rows.push({ word: w, tablePx: +t.toFixed(3), realPx: +r.toFixed(3), devPx: +dev.toFixed(3) });
    }
    const report = {
      authority: 'font-metrics (טבלאות אמת מהגופן הרשום) כשהגופן רשום; table = קירוב מכויל בלבד',
      engine: environmentFingerprint().slice(0, 60),
      words: rows,
      meanAbsDeviationPx: +(sumAbs / rows.length).toFixed(3)
    };
    const outDir = path.join(REPO, 'tests', 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 's3-measure-parity.json'), JSON.stringify(report, null, 2));
    assert(rows.length === words.length && report.meanAbsDeviationPx >= 0, 'דוח נוצר');
    // הסמכות: כשהגופן רשום, resolveMeasureImpl מעדיף font-metrics (EXT-13)
    assertEq(require('../../src/engine/typography/measure-api').resolveMeasureImpl({ 'body-font': 'Frank Ruhl Libre' }), 'font-metrics');
  });
  it('יחידות: pt→px אחיד (12pt = 16px), mm, מדיניות rounding יחידה', () => {
    assertEq(ptToPx(12), 16);
    assertEq(pxToPt(16), 12);
    assert(Math.abs(mmToPx(25.4) - 96) < 1e-9, 'mm');
    assertEq(roundPx(21.44, 'none'), 21.44);
    assertEq(roundPx(21.44, 'render'), 21);
    let threw = false;
    try { roundPx(1, 'bogus'); } catch (_) { threw = true; }
    assert(threw, 'מדיניות לא מוכרת נדחית');
  });
  it('בדיקת שלילה: אין מדידת DOM מחוץ למימוש המאושר (offsetHeight/scrollHeight/getClientRects)', () => {
    // סריקת מקור סטטית — אותו עיקרון כמו scan-control-triggers; החריג היחיד:
    // מימוש המדידה המאושר (measure-api) והערות תיעוד.
    const forbidden = ['offsetHeight', 'scrollHeight', 'getClientRects'];
    const allowed = ['measure-api.js', 'dom-renderer.js']; // dom-renderer = הקרנה, לא מדידה קנונית — נבדק ידנית שאינו מודד מחדש
    const srcDir = path.join(REPO, 'src', 'engine');
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        const rel = path.relative(path.join(REPO, 'src'), p).replace(/\\/g, '/');
        let body = fs.readFileSync(p, 'utf8');
        body = body.replace(/\/\*[\s\S]*?\*\//g, ''); // הערות בלוק — לא קוד
        const lines = body.split('\n');
        lines.forEach((ln, i) => {
          const noBlock = ln.replace(/\/\*[\s\S]*?\*\//g, ''); // בלוקים מלאים באותה שורה
          const code = noBlock.replace(/\/\/.*$/, '');
          for (const tok of forbidden) {
            if (code.includes(tok) && !allowed.some(a => rel.includes(a))) {
              hits.push(`${rel}:${i + 1}:${tok}`);
            }
          }
        });
      }
    };
    walk(srcDir);
    assertEq(hits.length, 0, 'שימושי DOM-מדידה אסורים: ' + hits.join('; '));
  });
});

report('s3-measure');
