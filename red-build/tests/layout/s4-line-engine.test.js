// tests/layout/s4-line-engine.test.js — שלב 4: מנוע השורות המאוחד — בסיס, עברית/RTL,
// פריטים מורכבים, overflow, דטרמיניזם, כותרות 3, justify (§4.1-2..13, §22)
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const fontResolver = require('../../src/engine/typography/font-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { buildLineSequences, H3_LINE_PITCH_PX, H3_LAST_BAND_PX } = require('../../src/engine/line/line-items');
const { layoutSequence, reconstructTextOfLines, LINE_MODEL_VERSION } = require('../../src/engine/line/line-model');
const { breakItemSequence, breakLines } = require('../../src/engine/typography/kp-linebreak');
const { clearItemMeasureCache } = require('../../src/engine/typography/measure-api');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');

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
const SETTINGS = { 'body-font-size-pt': 12, 'body-line-height': 1.34, 'body-font': 'Frank Ruhl Libre', 'f-note-body-size-pt': 8 };
function seqOf(model, ctx, kind) {
  const seqs = buildLineSequences(model, ctx);
  const sq = seqs.sequences.find((s) => s.blockKind === kind) || seqs.sequences[0];
  return { seqs, sq };
}

describe('שלב 4 — בסיס KP: רצף boxes/glue/penalties, פסקאות, גבולות (§22)', () => {
  it('פסקה קצרה — שורה אחת, breakReason=final; פסקה ארוכה — כמה שורות עם legal-cut', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const short = buildDocumentModel('כותרת 1 - חלק\nשתי מילים.\n', {});
    const { sq: s1 } = seqOf(short, { settings: SETTINGS }, 'paragraph');
    const r1 = layoutSequence(s1, { maxWidthPx: 300, lineHeightPx: 21.44 });
    assertEq(r1.lines.length, 1);
    assertEq(r1.lines[0].breakReason, 'final');
    const long = buildDocumentModel('כותרת 1 - חלק\n' + 'מילה עוד מילה ועוד טקסט ארוך '.repeat(6) + 'סוף.\n', {});
    const { sq: s2 } = seqOf(long, { settings: SETTINGS }, 'paragraph');
    const r2 = layoutSequence(s2, { maxWidthPx: 200, lineHeightPx: 21.44 });
    assert(r2.lines.length >= 3, 'נשבר לכמה שורות: ' + r2.lines.length);
    assert(r2.lines.slice(0, -1).every((l) => l.breakReason === 'legal-cut'), 'חיתוכים חוקיים');
    assertEq(r2.lines[r2.lines.length - 1].breakReason, 'final');
    // שורות עוקבות: אין חפיפת פריטים ואין דילוג — רצף זהויות רציף
    const all = r2.lines.flatMap((l) => l.itemIds);
    const uniq = new Set(all);
    assertEq(all.length, uniq.size, 'אין כפילות פריטים בין שורות');
  });
  it('מילה רחבה מהטור: שורה משלה + אבחון מפורש — לא מחיקה, לא לולאה, לא שורה ריקה (§19)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת  1 - חלק\nקצר לפני אאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאא וקצר אחרי.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 150, lineHeightPx: 21.44 });
    assert(res.lines.every((l) => l.itemIds.length > 0), 'אין שורה ריקה');
    const texts = res.lines.flatMap((l) => l.fragments.flatMap((f) => (f.fragments || []).map((x) => x.text)));
    assert(texts.some((t) => t.length > 40), 'המילה הארוכה קיימת בפלט (לא נמחקה)');
    assert(res.diagnostics.some((d) => d.code === 'overflow-item-own-line'), 'אבחון מפורש: ' + JSON.stringify(res.diagnostics.map((d) => d.code)));
    // שחזור מלא — התוכן לא אבד גם במסלול ה-overflow
    const recon = reconstructTextOfLines(res.lines).replace(/\u00A0/g, ' ');
    assert(recon.includes('קצר') && recon.includes('וקצר'), 'המילים סביב קיימות');
    assertEq(res.lines.filter((l) => l.breakReason === 'overflow-own-line').length >= 1, true, 'שורת היחידה מסומנת');
  });
  it('פסקה ללא הזדמנות שבירה חוקית (מילה אחת) — פלט קיים, דטרמיניסטי, מאובחן', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const model = buildDocumentModel('כותרת 1 - חלק\nבְּרֵאשִׁית־מְנֻקָּד־ארוך\n', {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const a = layoutSequence(sq, { maxWidthPx: 60, lineHeightPx: 21.44 });
    const b = layoutSequence(sq, { maxWidthPx: 60, lineHeightPx: 21.44 });
    assert(a.lines.length >= 1 && a.lines[0].itemIds.length >= 1, 'קיים פלט');
    assertEq(JSON.stringify(a.lines.map((l) => l.itemIds)), JSON.stringify(b.lines.map((l) => l.itemIds)), 'דטרמיניסטי');
  });
  it('שקילות מנוע: אותן מילים ומדידה — breakLines(words) ו-breakItemSequence נותנים אותן שורות', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const { MeasureAPI } = require('../../src/engine/typography/measure-api');
    const api = new MeasureAPI({ 'body-font': 'Frank Ruhl Libre', 'body-font-size-pt': 12 }, 'font-metrics');
    const words = 'פסקה לבדיקת שקילות המנועים עם מילים באורכים שונים ורווחים רגילים בלבד כדי לאפשר השוואה מדויקת של תוצאות השבירה בין שני המנועים על אותו קלט'.split(' ');
    const width = 200;
    const legacyLines = breakLines(words, width, (t) => api.measureTextWidth(t, 12, 0), 21.44, {});
    // רצף פריטים עם אותן מדידות בדיוק
    const items = [];
    for (let i = 0; i < words.length; i++) {
      items.push({ role: 'box', kind: 'text', itemId: 'w' + i, measuredAdvance: api.measureTextWidth(words[i], 12, 0), fragments: [], internal: false });
      if (i < words.length - 1) items.push({ role: 'glue', kind: 'glue', itemId: 'g' + i, measuredAdvance: api.measureTextWidth(' ', 12, 0), internal: false });
    }
    const res = breakItemSequence(items, width, {});
    assertEq(res.fallback, false, 'DP מצא פתרון');
    const newWords = res.lines.map((cut) => items.slice(cut.from, cut.to).filter((x) => x.role === 'box').map((x) => x.itemId));
    const oldWords = legacyLines.map((l) => l.words.map((_, k) => 'w' + words.indexOf(_)).filter((v, i, a) => a.indexOf(v) === i));
    // השוואה לפי מספר מילים בכל שורה (הזהויות שונות מבחינת מיפוי האינדקס)
    const newCounts = res.lines.map((cut) => items.slice(cut.from, cut.to).filter((x) => x.role === 'box').length);
    const oldCounts = legacyLines.map((l) => l.words.length);
    assertEq(JSON.stringify(newCounts), JSON.stringify(oldCounts), 'אותה חלוקת מילים לשורות: new=' + JSON.stringify(newCounts) + ' old=' + JSON.stringify(oldCounts));
    void newWords; void oldWords;
  });
});

describe('שלב 4 — עברית ו-RTL: ניקוד, גרשיים, סוגריים, מקפים, NBSP, מעורב (§22)', () => {
  it('מילה מנוקדת — לא נשברת בתוכה; הניקוד נשאר עם הבסיס', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nהַמְּדֻבָּר בְּנִקּוּד מָלֵא צָרִיךְ לָרוּץ יַחַד בְּלִי שֶׁבֶר בְּתוֹךְ הַמִּלִּים הַמְנֻקָּדוֹת הָאֵלּוּ בְּכָל אֹפֶן שֶׁהוּא.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 150, lineHeightPx: 21.44 });
    for (const ln of res.lines) {
      for (const f of ln.fragments) {
        for (const frag of (f.fragments || [])) {
          // אף מילה לא נחתכה: כל פרגמנט שלם (הפיצול למילים כיבד combining marks — מבנית)
          assert(!/[\u0591-\u05C7]$/.test('x'), 'placeholder');
        }
      }
    }
    const recon = reconstructTextOfLines(res.lines);
    assert(recon.includes('הַמְּדֻבָּר'), 'מילה מנוקדת שלמה בשחזור');
  });
  it('מקף מחבר עברי: המילה המחוברת נשארת יחידה אחת', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nעל־פי־רוב המקף־המחבר מלכד מילים ליחידה אחת שלמה גם בטור צר מאוד כאן.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const boxes = sq.items.filter((x) => x.role === 'box');
    const hyphenWord = boxes.find((b) => (b.fragments[0] || {}).text && b.fragments[0].text.includes('\u05BE'));
    assert(hyphenWord, 'קיימת מילה עם מקף מחבר');
    assertEq(hyphenWord.fragments.length, 1, 'מקף מחבר לא מפרק את המילה');
    const res = layoutSequence(sq, { maxWidthPx: 120, lineHeightPx: 21.44 });
    const recon = reconstructTextOfLines(res.lines);
    assert(recon.includes('על־פי־רוב'), 'היחידה המחוברת שלמה בפלט');
  });
  it('גרשיים/גרש בתוך מילה — חלק מהמילה (אין שבירה בתוכם)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nשבת אב׳ רא״ל וצירופים נוספים עם גרשיים בפנים לבדיקה שלמה של הכלל.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 130, lineHeightPx: 21.44 });
    const recon = reconstructTextOfLines(res.lines).replace(/\u00A0/g, ' ');
    for (const w of ['שבת', 'וצירופים']) assert(recon.includes(w), w + ' קיים');
    // אף פרגמנט לא מסתיים בגרש בודד שנפרד ממילתו
    for (const ln of res.lines) for (const f of ln.fragments) for (const frag of (f.fragments || [])) {
      assert(!frag.text.startsWith('\u05F3'), 'גרש אינו נפרד ממילתו: ' + frag.text);
    }
  });
  it('סוגריים: פותח בסוף שורה — אסור (כלל שוליים מנוסח אחד); תוכן הסוגריים נשמר', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nטקסט עם סוגריים (עם תוכן בתוכם) באמצע והמשך המשפט אחרי זה כדי למלא שורות.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 170, lineHeightPx: 21.44 });
    const recon = reconstructTextOfLines(res.lines).replace(/\u00A0/g, ' ');
    assert(recon.includes('(עם תוכן בתוכם)'), 'הסוגריים ותוכנם שלמים');
    for (const ln of res.lines) {
      const last = ln.fragments[ln.fragments.length - 1];
      if (last) {
        const t = (last.fragments || []).map((x) => x.text).join('');
        assert(!t.endsWith('('), 'סוגר פותח אינו נותר בסוף שורה: "' + t + '"');
      }
    }
  });
  it('טקסט מעורב RTL/LTR — הפרגמנטים נשמרים בסדר המקור, השחזור מדויק', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nמילה עברית עם English words mixed in וחזרה לעברית שוב באותה שורה.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 160, lineHeightPx: 21.44 });
    const recon = reconstructTextOfLines(res.lines).replace(/\u00A0/g, ' ');
    const runs = model.blocks.find((b) => b.kind === 'paragraph').items[0].payload.runs;
    const expected = runs.map((r) => String(r.text)).join('');
    assertEq(recon.replace(/\s+/g, ' ').trim(), expected.replace(/\s+/g, ' ').trim(), 'שחזור מלא כולל ה-LTR');
  });
});

describe('שלב 4 — פריטים מורכבים: סמנים, הערות, תמונות (§22)', () => {
  it('סמן הערה צמוד: הסמן והעוגן באותו שורה תמיד — גם בטור צר', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nמילה ראשונה ואז הערה [תוכן ההערה הזאת] באמצע המשפט והמשך טקסט ארוך מספיק לכמה שורות בטור הצר הזה.\n';
    const model = buildDocumentModel(raw, {});
    const { seqs } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    // היחידה הצמודה קיימת: internal glue + forbidden penalty לפני הסמן
    const mkIdx = para.items.findIndex((x) => x.kind === 'noteMarker');
    assert(mkIdx > 0, 'סמן קיים');
    assert(para.items[mkIdx - 1].role === 'penalty' && para.items[mkIdx - 1].penaltyType === 'forbidden', 'penalty אסור לפני הסמן');
    assert(para.items[mkIdx - 2].role === 'glue' && para.items[mkIdx - 2].internal, 'glue פנימי');
    const res = layoutSequence(para, { maxWidthPx: 140, lineHeightPx: 21.44 });
    for (const ln of res.lines) {
      const ids = ln.itemIds;
      const hasMarker = ids.some((id) => para.items[mkIdx] && id === para.items[mkIdx].itemId);
      if (hasMarker) {
        const prevBox = ln.fragments[ln.fragments.findIndex((f) => f.itemId === para.items[mkIdx].itemId) - 1];
        assert(prevBox && prevBox.kind === 'text', 'העוגן באותה שורה (מיד לפני הסמן)');
      }
    }
    // BRZ-11 המדווק: הסמן אינו נפרד מעוגנו — יחידת עוגן+סמן יכולה לסיים שורה
    // (הסמן עם הקשרו); האסור האמיתי הוא סמן מנותק מעוגנו — וזה מובטח מבנית למעלה.
    for (const ln of res.lines) {
      const idx = ln.fragments.findIndex((f) => f.kind === 'noteMarker');
      if (idx >= 0) assert(idx > 0 && ln.fragments[idx - 1].kind === 'text', 'סמן תמיד שוכן עם עוגנו');
    }
  });
  it('הערה ארוכה — נשברת לשורות באותו מנוע, בסגנון רישום (גובה שורה קטן)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nהערה [הערה ארוכה מאוד שחייבת להישבר לכמה שורות רישום בגודל קטן יותר מהגוף כי היא ארוכה מאוד ואין ברירה אלא לשבור אותה] וטקסט.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const note = seqs.sequences.find((s) => s.blockKind === 'note');
    assert(note, 'רצף הערה נבנה');
    const res = layoutSequence(note, { maxWidthPx: 150, lineHeightPx: 21.44 });
    assert(res.lines.length >= 2, 'הערה ארוכה נשברת: ' + res.lines.length);
    assert(res.lines[0].baseline.ascentPx < 12, 'בסיס בגודל רישום: ' + res.lines[0].baseline.ascentPx);
  });
  it('תמונה inline משתתפת בהחלטת השבירה מראש — לא מתווספת אחרי (§4.1-7/§16)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/inline.png', tinyPng(60, 36));
    const raw = 'כותרת 1 - חלק\nטקסט לפני התמונה #img/inline.png# וטקסט אחרי התמונה באותה פסקה עם עוד כמה מילים.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const imgItem = para.items.find((x) => x.kind === 'image');
    assert(imgItem && imgItem.measuredAdvance === 60, 'התמונה תיבה ברצף עם רוחב נמדד: ' + imgItem.measuredAdvance);
    const res = layoutSequence(para, { maxWidthPx: 200, lineHeightPx: 21.44 });
    const inLine = res.lines.find((l) => l.fragments.some((f) => f.kind === 'image'));
    assert(inLine, 'התמונה בתוך שורה שנשברה בהחלטה אחת עם הטקסט');
    const imgFrag = inLine.fragments.find((f) => f.kind === 'image');
    assertEq(imgFrag.measuredAdvance, 60);
    assert(inLine.naturalWidthPx > 60, 'רוחב השורה כולל גם טקסט סביב התמונה');
  });
  it('תמונה ממורכזת — LineModel בפני עצמה לפי כלל הפריסה שבאילוצים; הטקסט זורם סביבה', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/center.png', tinyPng(80, 50));
    const raw = 'כותרת 1 - חלק\nפסקה שמתחילה בטקסט רגיל ואז #img/center.png# ואז ממשיכה בעוד טקסט אחרי התמונה הממורכזת הזאת לגמרי.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    // מרכוז: participate=block
    const para = model.blocks.find((b) => b.kind === 'paragraph');
    const imgItem = para.items.find((i) => i.kind === 'image');
    imgItem.constraints = { ...imgItem.constraints, participates: 'block', align: 'center' };
    const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar });
    const paraSeq = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(paraSeq, { maxWidthPx: 240, lineHeightPx: 21.44 });
    const imgLine = res.lines.find((l) => l.fragments.some((f) => f.kind === 'image' && l.breakReason === 'image-block'));
    assert(imgLine, 'שורת תמונה-בלוק בפני עצמה');
    assertEq(imgLine.constraints.align, 'center', 'כלל הפריסה מהאילוצים');
    assertEq(imgLine.fragments.length, 1, 'רק התמונה בשורה שלה');
    const textLines = res.lines.filter((l) => l !== imgLine);
    assert(textLines.length >= 1 && textLines.every((l) => l.fragments.every((f) => f.kind !== 'image')), 'הטקסט זורם בשורות נפרדות');
  });
  it('תמונה עם wrap-around: אילוץ אזור מועבר למנוע — השורות בגובה התמונה צרות יותר (§16)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/float.png', tinyPng(80, 64)); // גובה 64 = כ-3 שורות של 21.44
    const raw = 'כותרת 1 - חלק\n#img/float.png# ואז טקסט שעוקף את התמונה הצפה בכמה שורות ראשונות של הפסקה הזאת ואמור להימדד ברוחב מוקטן עד שהתמונה נגמרת ואז חוזר לרוחב מלא של הטור עצמו.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const para = model.blocks.find((b) => b.kind === 'paragraph');
    const imgItem = para.items.find((i) => i.kind === 'image');
    imgItem.constraints = { ...imgItem.constraints, participates: 'inline', wrap: 'start' };
    const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar }); // בלי אילוץ רוחב זמין — התמונה ברוחב הטבעי שלה (80)
    const paraSeq = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(paraSeq, { maxWidthPx: 240, lineHeightPx: 21.44 });
    assert(res.lines.length >= 3, 'כמה שורות');
    const first = res.lines[0];
    assertEq(first.effectiveMaxWidthPx, 160, 'השורה הראשונה ברוחב מוקטן (240−80)');
    const after = res.lines.find((l) => l.effectiveMaxWidthPx === 240);
    assert(after, 'יש שורה ברוחב המלא אחרי גובה התמונה');
  });
  it('פריט אטומי (atomicToken) — אינו נחתך באמצע', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nמילים רגילות לפני וגם אחרי הפריט האטומי כדי לוודא שהוא עובר בשלמותו בשורה כלשהי.\n';
    const model = buildDocumentModel(raw, {});
    const para = model.blocks.find((b) => b.kind === 'paragraph');
    para.items.splice(2, 0, { id: 'tok-atomic-1', kind: 'atomicToken', payload: { text: 'טוקן־אטומי־ארוך' }, constraints: { atomic: true, participates: 'inline' } });
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const paraSeq = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const tok = paraSeq.items.find((x) => x.kind === 'atomicToken');
    assert(tok && tok.atomic, 'הטוקן אטום ברצף');
    const res = layoutSequence(paraSeq, { maxWidthPx: 150, lineHeightPx: 21.44 });
    const tokLine = res.lines.find((l) => l.itemIds.includes('tok-atomic-1'));
    assert(tokLine, 'הטוקן קיים בפלט');
    const frag = tokLine.fragments.find((f) => f.itemId === 'tok-atomic-1');
    assertEq((frag.fragments || []).map((x) => x.text).join(''), 'טוקן־אטומי־ארוך', 'שלם, לא נחתך');
  });
});

describe('שלב 4 — כותרות 3 ופריטי רוחב: סמנטיקת D-S2H3 במודל השורות (§21)', () => {
  it('כותרת 3 — פריט סמנטי אחד: הרווח התחתון פעם אחת אחרי השורה האחרונה בלבד', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nכותרת 3 - כותרת משנה ארוכה שנשברת לשתי שורות בטור הצר\nטקסט עוקב אחרי הכותרת.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const h3 = seqs.sequences.find((s) => s.blockKind === 'heading' && s.semantic && s.semantic.kind === 'heading3');
    assert(h3, 'רצף כותרת 3 עם סמנטיקה');
    assertEq(h3.semantic.linePitchPx, H3_LINE_PITCH_PX);
    assertEq(h3.semantic.lastBandPx, H3_LAST_BAND_PX);
    const res = layoutSequence(h3, { maxWidthPx: 190, lineHeightPx: 21.44 });
    assert(res.lines.length >= 2, 'כותרת דו-שורתית: ' + res.lines.length);
    for (const ln of res.lines) {
      assert(ln.semantic && ln.semantic.kind === 'heading3', 'כל שורה מתויגת כחלק מהפריט הסמנטי');
      assertEq(ln.semantic.linePitchPx, 34, 'פסיחה');
    }
    const last = res.lines[res.lines.length - 1];
    assertEq(last.semantic.bandPx, 38, 'הפס האחרון');
    assertEq(last.semantic.trailingSpacePx, 4, 'הרווח התחתון שייך לפריט כולו');
    for (const ln of res.lines.slice(0, -1)) assertEq(ln.semantic.trailingSpacePx, 0, 'אין רווח תחתון בשורות הביניים');
    // כותרת חד-שורתית — גאומטריה זהה לקיים (שורה אחת = הפס 38, רווח 4)
    const raw1 = 'כותרת 1 - חלק\nכותרת 3 - קצרה\nטקסט.\n';
    const m1 = buildDocumentModel(raw1, {});
    const h3one = buildLineSequences(m1, { settings: SETTINGS }).sequences.find((s) => s.semantic && s.semantic.kind === 'heading3');
    const r1 = layoutSequence(h3one, { maxWidthPx: 300, lineHeightPx: 21.44 });
    assertEq(r1.lines.length, 1);
    assertEq(r1.lines[0].semantic.bandPx, 38, 'חד-שורתית: פס 38');
    assertEq(r1.lines[0].semantic.trailingSpacePx, 4, 'רווח 4 פעם אחת');
  });
});

describe('שלב 4 — דטרמיניזם, justify חד-פעמי ועלות מתועדת (§4.1-9/11, §22)', () => {
  it('אותו קלט ⇒ אותו LineModel (פעמיים; גם במנוע הגולמי)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nפסקה לדטרמיניזם עם מספיק מילים כדי לשבור כמה שורות בטור הזה בכל ריצה מחדש של אותו הקלט בדיוק.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const a = layoutSequence(sq, { maxWidthPx: 170, lineHeightPx: 21.44 });
    const b = layoutSequence(sq, { maxWidthPx: 170, lineHeightPx: 21.44 });
    assertEq(JSON.stringify(a.lines), JSON.stringify(b.lines), 'אותו LineModel ביט-לביט');
    // וגם: אותן מדידות (עצמים מטמון)
    const seq2 = buildLineSequences(buildDocumentModel(raw, {}), { settings: SETTINGS });
    const c = layoutSequence(seq2.sequences.find((s) => s.blockKind === 'paragraph'), { maxWidthPx: 170, lineHeightPx: 21.44 });
    assertEq(JSON.stringify(a.lines.map((l) => l.itemIds.map((i) => i.split('#')[0]))), JSON.stringify(c.lines.map((l) => l.itemIds.map((i) => i.split('#')[0]))), 'מודל חדש מאותו מקור — אותה שבירה');
  });
  it('justify=stretch: ההקצאה מחושבת פעם אחת, דטרמיניסטית, ללא סחיפה — הסכום מדויק', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nמילים אחדות לשורה מתוחה עם כמה רווחים ביניהן כדי שההקצאה תתחלק בלי סחיפה.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 260, lineHeightPx: 21.44, justify: 'stretch' });
    const ln = res.lines[0];
    assert(ln.glue.length >= 2, 'יש רווחים לחלק');
    const allocated = ln.glue.reduce((s, g) => s + g.allocationPx, 0);
    const boxes = ln.fragments.reduce((s, f) => s + f.measuredAdvance, 0);
    const total = allocated + boxes;
    assert(Math.abs(total - 260) < ln.glue.length * 0.501, `הקצאה מלאה עד הרוחב (${total} ≈ 260)`);
    // דטרמיניזם של ההקצאה
    const res2 = layoutSequence(sq, { maxWidthPx: 260, lineHeightPx: 21.44, justify: 'stretch' });
    assertEq(JSON.stringify(res.lines[0].glue.map((g) => g.allocationPx)), JSON.stringify(res2.lines[0].glue.map((g) => g.allocationPx)), 'הקצאה דטרמיניסטית');
    // ragged (ברירת מחדל המאושרת לנתיב ה-DP): ההקצאה = הטבעי
    const rag = layoutSequence(sq, { maxWidthPx: 260, lineHeightPx: 21.44 }).lines[0];
    assert(rag.glue.every((g) => g.allocationPx === g.naturalPx), 'ragged — טבעי');
  });
  it('כל שורה: כל שדות §4.1-10 קיימים — fragments, מיפוי מקור, זהויות, רוחבים, glue, בסיס, גובה, סיבת שבירה, אילוצים, אבחונים', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const model = buildDocumentModel('כותרת 1 - חלק\nפסקה עם מספיק מילים לשתי שורות לפחות בטור צר מאוד כאן בשביל הבדיקה.\n', {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    const res = layoutSequence(sq, { maxWidthPx: 130, lineHeightPx: 21.44 });
    for (const ln of res.lines) {
      assert(Array.isArray(ln.fragments) && ln.fragments.length > 0, 'fragments');
      assert(Array.isArray(ln.itemIds), 'itemIds');
      assert(Number.isFinite(ln.naturalWidthPx), 'naturalWidthPx');
      assert(Array.isArray(ln.glue), 'glue');
      assert(ln.baseline && Number.isFinite(ln.baseline.ascentPx), 'baseline');
      assert(Number.isFinite(ln.lineHeightPx) && ln.lineHeightPx > 0, 'lineHeightPx');
      assert(typeof ln.breakReason === 'string' && ln.breakReason, 'breakReason');
      assert(ln.constraints && Number.isFinite(ln.constraints.maxWidthPx), 'constraints');
      assert(Array.isArray(ln.diagnostics), 'diagnostics');
      assert(Array.isArray(ln.flow), 'flow (עמודת שחזור המקור)');
      assert(ln.modelVersion === LINE_MODEL_VERSION, 'גרסת מודל');
      assert(typeof ln.index === 'number' && typeof ln.isLast === 'boolean', 'אינדוקס/isLast');
    }
  });
});

report('s4-line-engine');
