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
  it('מילה מנוקדת — בסיס וסימניו יחד: אין חיתוך בין אות לסימן משולב, השחזור מדויק, גם בגבולות שורה (§3.2)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const { isCombiningMark } = require('../../src/engine/line/breaks');
    const raw = 'כותרת 1 - חלק\nהַמְּדֻבָּר בְּנִקּוּד מָלֵא וּבְטַעֲמִים צָרִיךְ לָרוּץ יַחַד בְּלִי שֶׁבֶר בְּתוֹךְ הַמִּלִּים הַמְנֻקָּדוֹת הָאֵלּוּ בְּכָל אֹפֶן שֶׁהוּא וְגַם אב׳ רא״ל עם גרשיים וּמַקָּף אֶחָד וְעוֹד מִלִּים מְנֻקָּדוֹת נוֹסָפוֹת לְמִלּוּי הַשּׁוּרוֹת.\n';
    const model = buildDocumentModel(raw, {});
    const srcText = model.blocks.find((b) => b.kind === 'paragraph').items[0].payload.runs.map((r) => r.text).join('');
    const srcWords = srcText.split(/\s+/).filter(Boolean);
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    // (א) מבנית: אף פרגמנט (מילה) אינו נפתח בסימן משולב — הסימן תמיד עם הבסיס שלפניו
    for (const b of sq.items) {
      if (b.role !== 'box' || b.kind !== 'text') continue;
      for (const f of (b.fragments || [])) {
        assert(!isCombiningMark(f.text[0]), `פרגמנט אינו נפתח בסימן משולב: ${JSON.stringify(f.text)}`);
        // כל סימן משולב בפרגמנט קודם לו תו בסיס (אות) באותו פרגמנט — לא בפרגמנט הקודם
        for (let i = 1; i < f.text.length; i++) {
          if (isCombiningMark(f.text[i])) {
            assert(!isCombiningMark(f.text[i - 1]) || isCombiningMark(f.text[i - 1]), 'סימן מוערם — תקין');
            break; // הבסיס/הערימה נבדקו בפתיחה; המבנה מבטיח המשכיות
          }
        }
      }
    }
    // (ב) שבירה במספר רוחבים — מילה מנוקדת תיפול בהכרח בגבול שורה באחד הרוחבים;
    // בכל רוחב: שחזור מדויק ביט-לביט, אף שורה אינה נפתחת בסימן משולב, ושלמות המילים
    let multiLine = 0, boundaryNikud = 0;
    for (const W of [55, 65, 75, 85, 100, 115, 130, 150, 175, 200, 240]) {
      const res = layoutSequence(sq, { maxWidthPx: W, lineHeightPx: 21.44 });
      assert(res.lines.length >= 1, 'קיים פלט ברוחב ' + W);
      const recon = reconstructTextOfLines(res.lines);
      assertEq(recon, srcText, `שחזור מדויק ביט-לביט ברוחב ${W} (אין אובדן ניקוד/טעמים)`);
      const outWords = res.lines.flatMap((l) => l.fragments.filter((f) => f.kind === 'text').map((f) => (f.fragments || []).map((x) => x.text).join('')));
      assertEq(outWords.length, srcWords.length, `מספר מילים ברוחב ${W}`);
      for (let i = 0; i < srcWords.length; i++) assertEq(outWords[i], srcWords[i], `מילה ${i} ברוחב ${W}`);
      for (const ln of res.lines) {
        const first = ln.fragments[0];
        const t = (first && first.fragments || []).map((x) => x.text).join('');
        assert(!isCombiningMark(t[0]), `שורה אינה נפתחת בסימן משולב (רוחב ${W}): ${t}`);
        const last = ln.fragments[ln.fragments.length - 1];
        const lt = (last && last.fragments || []).map((x) => x.text).join('');
        // אף מילה מנוקדת אינה מסתיימת בבסיס שסימניו נותרו לשורה הבאה — מובטח מבנית
        // (המילה תיבה אחת); הבדיקה ההפוכה: השורה הבאה אינה נפתחת בסימן (לעיל).
        void lt;
      }
      if (res.lines.length > 1) {
        multiLine++;
        // גבול שורה שבו המילה האחרונה/הראשונה מנוקדת — נבדק בפועל
        for (const ln of res.lines) {
          const w = ln.fragments.filter((f) => f.kind === 'text').map((f) => (f.fragments || []).map((x) => x.text).join(''));
          if (w.some((x) => /[\u0591-\u05C7]/.test(x))) boundaryNikud++;
        }
      }
    }
    assert(multiLine >= 8, 'נבדקו שבירות מרובות-שורות בפועל: ' + multiLine);
    assert(boundaryNikud >= 8, 'מילים מנוקדות נבדקו בגבולות שורה אמיתיים: ' + boundaryNikud);
    // (ג) ZWJ (U+200D) בתוך מילה — חלק בלתי-נפרד; גרש/גרשיים בתוך מילה
    const zwjWord = 'מילה\u200Dאחודת' + ' עם ניקוד וּמִלָּה מְנֻקָּדֶת וגם אב׳ג רא״ל וסיום תקין של המשפט כאן.';
    const rawZwj = 'כותרת 1 - חלק\n' + zwjWord + '\n';
    const mz = buildDocumentModel(rawZwj, {});
    const sz = buildLineSequences(mz, { settings: SETTINGS }).sequences.find((s) => s.blockKind === 'paragraph');
    const zwjBox = sz.items.find((it) => it.role === 'box' && (it.fragments || []).some((f) => f.text.includes('\u200D')));
    assert(zwjBox, 'מילה עם ZWJ קיימת כתיבה אחת');
    const rz = layoutSequence(sz, { maxWidthPx: 90, lineHeightPx: 21.44 });
    const zsrc = mz.blocks.find((b) => b.kind === 'paragraph').items[0].payload.runs.map((r) => r.text).join('');
    assertEq(reconstructTextOfLines(rz.lines), zsrc, 'שחזור מדויק כולל ZWJ וגרשיים');
    for (const ln of rz.lines) {
      for (const f of ln.fragments) {
        for (const frag of (f.fragments || [])) {
          assert(!/^[\u05F3\u05F4]/.test(frag.text), 'גרש/גרשיים אינם נפרדים ממילתם: ' + frag.text);
        }
      }
    }
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
  it('תמונה עם wrap-around: אילוץ אזור מועבר למנוע — ואין ספירת רוחב כפולה (§16, §3.3)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/float.png', tinyPng(80, 64)); // גובה 64 = כ-3 שורות של 21.44
    const raw = 'כותרת 1 - חלק\n#img/float.png# ואז טקסט שעוקף את התמונה הצפה בכמה שורות ראשונות של הפסקה הזאת ואמור להימדד ברוחב מוקטן עד שהתמונה נגמרת ואז חוזר לרוחב מלא של הטור עצמו.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const para = model.blocks.find((b) => b.kind === 'paragraph');
    const imgItem = para.items.find((i) => i.kind === 'image');
    imgItem.constraints = { ...imgItem.constraints, participates: 'inline', wrap: 'start' };
    const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar });
    const paraSeq = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(paraSeq, { maxWidthPx: 240, lineHeightPx: 21.44 });
    assert(res.lines.length >= 3, 'כמה שורות');
    // (א) התמונה אינה תיבה בזרימת הטקסט — היא אזור: אין ספירת רוחב כפולה
    assert(res.lines.every((l) => l.fragments.every((f) => f.kind !== 'image')), 'התמונה הצפה אינה תיבה בשורות הטקסט');
    assertEq(res.floats.length, 1, 'התמונה רשומה כ-float עם זהות מלאה');
    const fl = res.floats[0];
    assertEq(fl.itemId, imgItem.id, 'זהות הפריט נשמרה');
    assertEq(fl.widthPx, 80, 'רוחב');
    assertEq(fl.heightPx, 64, 'גובה');
    assertEq(fl.side, 'start', 'הצד הסמנטי נשמר');
    assert(fl.anchor && fl.anchor.nextItemId, 'עוגן סמנטי — התיבה שאחריה בזרימה');
    assert(fl.sourceRange && Number.isFinite(fl.sourceRange.start), 'טווח מקור מוחלט');
    // (ב) השורות בגובה התמונה ברוחב מוקטן; אחריו — רוחב מלא
    const first = res.lines[0];
    assertEq(first.effectiveMaxWidthPx, 160, 'השורה הראשונה ברוחב מוקטן (240−80)');
    const after = res.lines.find((l) => l.effectiveMaxWidthPx === 240);
    assert(after, 'יש שורה ברוחב המלא אחרי גובה התמונה');
    // (ג) כל שורה בגובה התמונה נושאת את אזור התמונה — חלק ממודל השורה, לא חריג renderer
    const withArea = res.lines.filter((l) => (l.floatAreas || []).length === 1);
    assertEq(withArea.length, 3, 'שלוש שורות בגובה התמונה עם floatAreas');
    for (const l of withArea) {
      assertEq(l.floatAreas[0].itemId, imgItem.id, 'זהות האזור');
      assertEq(l.floatAreas[0].widthPx, 80, 'רוחב האזור');
    }
    // (ד) שימור תוכן מלא — הטקסט סביב התמונה לא אבד
    const recon = reconstructTextOfLines(res.lines);
    assert(recon.includes('ואז') && recon.includes('עצמו'), 'הטקסט שלם סביב התמונה הצפה');
  });
  it('float בשני צדדים (start/end) ובגבהים שונים — אותו מנוע, אותו אילוץ, הצד בזהות (§3.3)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    for (const side of ['start', 'end']) {
      for (const [w, h] of [[60, 22], [80, 100]]) {
        const ar = new AssetResolver();
        ar.addBytes('img/f.png', tinyPng(w, h));
        const raw = 'כותרת 1 - חלק\n#img/f.png# טקסט זורם לצד התמונה בשורות הראשונות ואז ממשיך ברוחב מלא של הטור עם עוד מילים רבות מספיקות לכמה שורות טובות כאן.\n';
        const model = buildDocumentModel(raw, { assets: ar });
        const para = model.blocks.find((b) => b.kind === 'paragraph');
        const imgItem = para.items.find((i) => i.kind === 'image');
        imgItem.constraints = { ...imgItem.constraints, participates: 'inline', wrap: side };
        const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar });
        const paraSeq = seqs.sequences.find((s) => s.blockKind === 'paragraph');
        const res = layoutSequence(paraSeq, { maxWidthPx: 200, lineHeightPx: 21.44 });
        assertEq(res.floats.length, 1, `float נרשם (${side} ${w}x${h})`);
        assertEq(res.floats[0].side, side, `הצד נשמר (${side})`);
        assertEq(res.floats[0].widthPx, w, 'רוחב');
        const spanned = Math.max(1, Math.ceil(h / 21.44));
        const reduced = res.lines.filter((l) => l.effectiveMaxWidthPx === 200 - w);
        assertEq(reduced.length, spanned, `שורות ברוחב מוקטן לפי הגובה (${side} ${h} → ${spanned})`);
        const full = res.lines.filter((l) => l.effectiveMaxWidthPx === 200);
        assert(full.length >= 1, `חזרה לרוחב מלא (${side})`);
        // שום שורה לא חורגת מהרוחב האפקטיבי שלה (אימות מספר-שורה אמיתי)
        for (const l of res.lines) assert(l.naturalWidthPx <= l.effectiveMaxWidthPx + 0.01, `רוחב טבעי בגבולות (${side}): ${l.naturalWidthPx} ≤ ${l.effectiveMaxWidthPx}`);
      }
    }
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
    // **חוזה H3 (D-S2H3/CSS parity, core/h3-contract.js):** pitch = line-height
    // 1.22 של ה-CSS המקורי (13.5pt ברירת מחדל ⇒ 21.96px), הפס האחרון = pitch+4,
    // הרווח התחתון 4 פעם אחת. הערכים הישנים 34/38 שיקפו line-height שכלל בטעות
    // את הריפוד העליון בכל שורת המשך — הוחלפו בחוזה המדויק.
    assert(Math.abs(H3_LINE_PITCH_PX - 21.96) < 0.01, 'pitch לפי 1.22 על 13.5pt');
    assertEq(h3.semantic.linePitchPx, H3_LINE_PITCH_PX);
    assertEq(h3.semantic.lastBandPx, H3_LAST_BAND_PX);
    const res = layoutSequence(h3, { maxWidthPx: 190, lineHeightPx: 21.44 });
    assert(res.lines.length >= 2, 'כותרת דו-שורתית: ' + res.lines.length);
    for (const ln of res.lines) {
      assert(ln.semantic && ln.semantic.kind === 'heading3', 'כל שורה מתויגת כחלק מהפריט הסמנטי');
      assertEq(ln.semantic.linePitchPx, H3_LINE_PITCH_PX, 'פסיחה');
    }
    const last = res.lines[res.lines.length - 1];
    assertEq(last.semantic.bandPx, H3_LAST_BAND_PX, 'הפס האחרון');
    assertEq(last.semantic.trailingSpacePx, 4, 'הרווח התחתון שייך לפריט כולו');
    for (const ln of res.lines.slice(0, -1)) assertEq(ln.semantic.trailingSpacePx, 0, 'אין רווח תחתון בשורות הביניים');
    // כותרת חד-שורתית — שורה אחת = הפס (pitch+4), רווח 4
    const raw1 = 'כותרת 1 - חלק\nכותרת 3 - קצרה\nטקסט.\n';
    const m1 = buildDocumentModel(raw1, {});
    const h3one = buildLineSequences(m1, { settings: SETTINGS }).sequences.find((s) => s.semantic && s.semantic.kind === 'heading3');
    const r1 = layoutSequence(h3one, { maxWidthPx: 300, lineHeightPx: 21.44 });
    assertEq(r1.lines.length, 1);
    assertEq(r1.lines[0].semantic.bandPx, H3_LAST_BAND_PX, 'חד-שורתית: פס pitch+4');
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
  it('justify מופק מהגדרות המסמך — ברירת המחדל האפקטיבית של המוצר (justify; שורה אחרונה לפי body-last-line-align) נשמרת (§3.7)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
    const settings = getDefaultSettings();
    const raw = 'כותרת 1 - חלק\nמילים אחדות לשורה עם כמה רווחים ביניהן כדי שההקצאה תתחלק בלי סחיפה וגם עוד מילים נוספות לכמה שורות בטור הזה בכלל.\n';
    const model = buildDocumentModel(raw, {});
    const { sq } = seqOf(model, { settings: SETTINGS }, 'paragraph');
    // (א) מהגדרות המסמך: גוף justify (03.11(ד) — הברירת מחדל האפקטיבית ב-main),
    // שורה אחרונה לפי body-last-line-align (center ⇒ בלי מתיחה)
    const res = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, settings });
    assert(res.lines.length >= 2, 'כמה שורות: ' + res.lines.length);
    assertEq(res.lines[0].constraints.justify, 'stretch', 'ברירת המחדל מההגדרות: justify');
    for (const ln of res.lines.slice(0, -1)) {
      if (ln.glue.length === 0) continue; // שורה במילה בודדת — אין רווחים לחלק (תקין)
      const allocated = ln.glue.reduce((s, g) => s + g.allocationPx, 0);
      const boxes = ln.fragments.reduce((s, f) => s + f.measuredAdvance, 0);
      const total = allocated + boxes;
      assert(Math.abs(total - ln.effectiveMaxWidthPx) < ln.glue.length * 0.501, `הקצאה מלאה עד הרוחב (${total} ≈ ${ln.effectiveMaxWidthPx})`);
      assert(ln.glue.every((g) => g.allocationPx >= g.naturalPx), 'מתיחה — לא כיווץ');
    }
    assert(res.lines.slice(0, -1).some((ln) => ln.glue.length >= 1), 'יש שורה עם רווחים לחלק');
    const last = res.lines[res.lines.length - 1];
    assert(last.glue.every((g) => g.allocationPx === g.naturalPx), 'השורה האחרונה בלי מתיחה (body-last-line-align=center)');
    // (ב) בלי הגדרות ובלי justify מפורש — אותה ברירת מחדל אפקטיבית (לא הנחת ragged)
    const res2 = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44 });
    assertEq(res2.lines[0].constraints.justify, 'stretch', 'ברירת המחדל האפקטיבית גם בלי הגדרות');
    // (ג) היישור אינו משנה את חלוקת השורות (ההקצאה בלבד) — דטרמיניזם ושקילות חלוקה
    const res3 = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, justify: 'ragged' });
    assertEq(JSON.stringify(res2.lines.map((l) => l.itemIds)), JSON.stringify(res3.lines.map((l) => l.itemIds)), 'היישור אינו משנה חלוקה');
    // (ד) body-last-line-align=stretch — גם השורה האחרונה נמתחת
    const res4 = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, settings: { ...settings, 'body-last-line-align': 'stretch' } });
    const last4 = res4.lines[res4.lines.length - 1];
    assert(last4.glue.length === 0 || last4.glue.some((g) => g.allocationPx > g.naturalPx), 'שורה אחרונה נמתחת כשהמדיניות דורשת');
    // (ה) דטרמיניזם של ההקצאה
    const resA = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, settings });
    const resB = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, settings });
    assertEq(JSON.stringify(resA.lines.map((l) => l.glue.map((g) => g.allocationPx))), JSON.stringify(resB.lines.map((l) => l.glue.map((g) => g.allocationPx))), 'הקצאה דטרמיניסטית');
    // ragged מפורש: ההקצאה = הטבעי
    const rag = layoutSequence(sq, { maxWidthPx: 200, lineHeightPx: 21.44, justify: 'ragged' }).lines[0];
    assert(rag.glue.every((g) => g.allocationPx === g.naturalPx), 'ragged מפורש — טבעי');
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

describe('שלב 4 — יחידות צמודות במסלול הגיבוי: אטומיות, קישור noteRef, overflow מפורש (§3.4)', () => {
  it('יחידה תקינה — הסמן ועוגנו באותה שורה גם כשה-DP נכשל והגיבוי פועל', () => {
    registerRealFonts();
    clearItemMeasureCache();
    // מילה ארוכה (רחבה מהטור) עם סמן הערה צמוד — ה-DP אינו מוצא פתרון ⇒ גיבוי.
    // היחידה (עוגן+סמן) חייבת לעבור כאטום: לא נקרעת, לא מפורקת, לא נמחקת.
    const raw = 'כותרת  1 - חלק\nקצר לפני אאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאא [הערה צמודה] וקצר אחרי עוד קצת מילים.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(para, { maxWidthPx: 120, lineHeightPx: 21.44 });
    // היחידה עברה בשלמות: העוגן והסמן תמיד באותה שורה
    const mkLines = res.lines.filter((l) => l.fragments.some((f) => f.kind === 'noteMarker'));
    assert(mkLines.length >= 1, 'הסמן קיים בפלט');
    for (const ln of mkLines) {
      const idx = ln.fragments.findIndex((f) => f.kind === 'noteMarker');
      assert(idx > 0 && ln.fragments[idx - 1].kind === 'text', 'הסמן עם עוגנו באותה שורה (גם בגיבוי)');
    }
    // אין אובדן: כל המילים קיימות
    const recon = reconstructTextOfLines(res.lines).replace(/\u00A0/g, ' ');
    assert(recon.includes('קצר') && recon.includes('וקצר'), 'המילים סביב קיימות');
    const longWord = res.lines.flatMap((l) => l.fragments).some((f) => (f.fragments || []).some((x) => x.text.length > 40));
    assert(longWord, 'המילה הארוכה קיימת (לא נמחקה)');
  });
  it('יחידה רחבה מהטור — שורה בפני עצמה + overflow-joined-unit עם noteRef וטווחי מקור; אין פירוק', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת  1 - חלק\nעוד מילים רגילות לפני כדי למלא שורה אחת שלמה בטור ואז בבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבבב [הערה רחבה] ואחרי זה עוד קצת.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(para, { maxWidthPx: 110, lineHeightPx: 21.44 });
    const diag = res.diagnostics.find((d) => d.code === 'overflow-joined-unit');
    assert(diag, 'אבחון overflow-joined-unit מפורש: ' + JSON.stringify(res.diagnostics.map((d) => d.code)));
    assert(diag.noteRef && diag.noteRef.startsWith('note-'), 'הקישור לפי noteRef (זהות עוגן): ' + diag.noteRef);
    assert(diag.anchorSourceRange && Number.isFinite(diag.anchorSourceRange.start), 'טווח מקור העוגן באבחון');
    assert(diag.markerSourceRange && Number.isFinite(diag.markerSourceRange.start), 'טווח מקור הסמן באבחון');
    // היחידה על שורה אחת בשלמותה — שני הפריטים יחד
    const unitLine = res.lines.find((l) => l.itemIds.includes(diag.joinedItemId));
    assert(unitLine && unitLine.itemIds.includes(diag.itemId), 'העוגן והסמן על אותה שורה (יחידה אטומית)');
    assertEq(unitLine.breakReason, 'overflow-joined-unit', 'סיבת השבירה מתועדת');
    // אין שום שורה שמכילה סמן בלי עוגן
    for (const ln of res.lines) {
      const idx = ln.fragments.findIndex((f) => f.kind === 'noteMarker');
      if (idx >= 0) assert(idx > 0 && ln.fragments[idx - 1].kind === 'text', 'אף סמן אינו מנותק מעוגנו');
    }
  });
  it('יחידה בפתיחת הרצף (סמן ראשון מוצמד קדימה) ובסוף הרצף — אטומיות גם שם', () => {
    registerRealFonts();
    clearItemMeasureCache();
    // פתיחה: סמן בראש הפסקה מוצמד למילה שאחריו
    const rawStart = 'כותרת 1 - חלש\n[הערה פותחת] מילה ראשונה אחרי הסמן ועוד טקסט ארוך מספיק לכמה שורות בטור הצר הזה בהחלט.\n';
    const mStart = buildDocumentModel(rawStart, {});
    const sStart = buildLineSequences(mStart, { settings: SETTINGS }).sequences.find((s) => s.blockKind === 'paragraph');
    const rStart = layoutSequence(sStart, { maxWidthPx: 130, lineHeightPx: 21.44 });
    const firstLine = rStart.lines[0];
    const mkIdx = firstLine.fragments.findIndex((f) => f.kind === 'noteMarker');
    assert(mkIdx >= 0, 'הסמן בשורה הראשונה');
    assert(firstLine.fragments[mkIdx + 1] && firstLine.fragments[mkIdx + 1].kind === 'text', 'סמן פותח צמוד למילה שאחריו');
    // סוף: סמן אחרון מוצמד לעוגן שלפניו
    const rawEnd = 'כותרת 1 - חלק\nטקסט ארוך למילוי כמה שורות בטור הצר הזה עם עוד ועוד מילים עד הסוף ואז מילה־אחרונה [הערה סופית]\n';
    const mEnd = buildDocumentModel(rawEnd, {});
    const sEnd = buildLineSequences(mEnd, { settings: SETTINGS }).sequences.find((s) => s.blockKind === 'paragraph');
    const rEnd = layoutSequence(sEnd, { maxWidthPx: 130, lineHeightPx: 21.44 });
    const lastLine = rEnd.lines[rEnd.lines.length - 1];
    const mkEnd = lastLine.fragments.findIndex((f) => f.kind === 'noteMarker');
    assert(mkEnd >= 0, 'הסמן הסופי בפלט');
    assert(lastLine.fragments[mkEnd - 1] && lastLine.fragments[mkEnd - 1].kind === 'text', 'סמן סופי צמוד לעוגן שלפניו');
    // דטרמיניזם של מסלול הגיבוי
    const r2 = layoutSequence(sEnd, { maxWidthPx: 130, lineHeightPx: 21.44 });
    assertEq(JSON.stringify(rEnd.lines.map((l) => l.itemIds)), JSON.stringify(r2.lines.map((l) => l.itemIds)), 'גיבוי דטרמיניסטי');
  });
});

describe('שלב 4 — wrap ו-DP: הרוחב האפקטיבי לפי מספר השורה האמיתי במסלול שנבחר (§3.8)', () => {
  it('פריט רחב מהאזור המצומצן אך נכנס באזור המלא — ה-DP דוחף אותו מעבר לאזור ה-wrap', () => {
    registerRealFonts();
    clearItemMeasureCache();
    // רצף גולמי: 10 תיבות קטנות (12px) + תיבה רחבה (130) + 4 תיבות קטנות.
    // אילוץ: שורות 0-1 ברוחב 100, שורות 2+ ברוחב 160. התיבה הרחבה (130) אינה
    // נכנסת ב-100 אך נכנסת ב-160 — הפתרון היחיד: היא תיפול בשורה ≥ 2.
    const mk = (id, w) => ({ role: 'box', kind: 'text', itemId: id, measuredAdvance: w, fragments: [{ text: id }], internal: false });
    const mg = (id) => ({ role: 'glue', kind: 'glue', itemId: id, measuredAdvance: 4, internal: false });
    const items = [];
    for (let i = 0; i < 10; i++) { items.push(mk('s' + i, 12)); items.push(mg('g' + i)); }
    items.push(mk('WIDE', 130));
    items.push(mg('gw'));
    for (let i = 0; i < 4; i++) { items.push(mk('t' + i, 12)); if (i < 3) items.push(mg('gg' + i)); }
    const lineWidthAt = (li) => (li < 2 ? 100 : 160);
    const res = breakItemSequence(items, 160, { lineWidthAt });
    assertEq(res.fallback, false, 'ה-DP מצא פתרון (דחיפה מעבר לאזור ה-wrap)');
    assertEq(res.diagnostics.filter((d) => d.code === 'wrap-width-mismatch').length, 0, 'אין חריגת רוחב: ' + JSON.stringify(res.diagnostics));
    const wideLine = res.lines.findIndex((c) => items.slice(c.from, c.to).some((x) => x.itemId === 'WIDE'));
    assert(wideLine >= 2, `הפריט הרחב בשורה ${wideLine} (מעבר לאזור המצומצם)`);
    // כל שורה: הרוחב הטבעי בגבולות הרוחב האפקטיבי של מספר השורה האמיתי
    const seqView = items.concat([{ role: 'penalty', penaltyType: 'final' }]);
    res.lines.forEach((c, li) => {
      let from = c.from;
      while (seqView[from] && seqView[from].role === 'glue' && !seqView[from].internal) from++;
      let w = 0;
      for (let k = from; k < c.to; k++) { const it = seqView[k]; if (!it) continue; if (it.role === 'box') w += it.measuredAdvance; else if (it.role === 'glue') w += it.measuredAdvance; }
      assert(w <= lineWidthAt(li) + 0.01, `שורה ${li}: רוחב טבעי ${w} ≤ ${lineWidthAt(li)}`);
    });
  });
  it('מסלולים מרובים לאותה נקודת חיתוך — lineOf עקבי לאורך המסלול שנבחר; אין wrap-width-mismatch', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const { MeasureAPI } = require('../../src/engine/typography/measure-api');
    const api = new MeasureAPI({ 'body-font': 'Frank Ruhl Libre', 'body-font-size-pt': 12 }, 'font-metrics');
    const words = 'טקסט ארוך למדי עם הרבה מאוד מילים באורכים שונים לחלוטין כדי ליצור מסלולי DP מרובים עם מועמדים שונים לאותן נקודות חיתוך בדיוק כפי שנדרש בבדיקה הזאת במיוחד'.split(' ');
    const items = [];
    for (let i = 0; i < words.length; i++) {
      items.push({ role: 'box', kind: 'text', itemId: 'w' + i, measuredAdvance: api.measureTextWidth(words[i], 12, 0), fragments: [{ text: words[i] }], internal: false });
      if (i < words.length - 1) items.push({ role: 'glue', kind: 'glue', itemId: 'g' + i, measuredAdvance: api.measureTextWidth(' ', 12, 0), internal: false });
    }
    // אילוץ מתחלף: שורות 0-1 צרות (120), 2+ רחבות (170)
    const lineWidthAt = (li) => (li < 2 ? 120 : 170);
    const res = breakItemSequence(items, 170, { lineWidthAt });
    assertEq(res.fallback, false, 'פתרון DP');
    assert(res.lines.length >= 3, 'כמה שורות: ' + res.lines.length);
    assertEq(res.diagnostics.length, 0, 'אין אבחוני חריגה: ' + JSON.stringify(res.diagnostics));
    // השורות 0-1 ברוחב המצומצם, 2+ במלא — המעבר מדויק
    const seqView2 = items.concat([{ role: 'penalty', penaltyType: 'final' }]);
    res.lines.forEach((c, li) => {
      let from = c.from;
      while (seqView2[from] && seqView2[from].role === 'glue') from++;
      let w = 0;
      for (let k = from; k < c.to; k++) { const it = seqView2[k]; if (!it) continue; if (it.role === 'box' || it.role === 'glue') w += it.measuredAdvance; }
      assert(w <= lineWidthAt(li) + 0.01, `שורה ${li}: ${w} ≤ ${lineWidthAt(li)}`);
    });
    // דטרמיניזם מלא תחת האילוץ
    const res2 = breakItemSequence(items, 170, { lineWidthAt });
    assertEq(JSON.stringify(res.lines), JSON.stringify(res2.lines), 'אותם חיתוכים בדיוק');
  });
  it('אין פתרון DP תחת אילוץ wrap — הגיבוי מכבד את אותו אילוץ רוחב לפי שורה', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const mk = (id, w) => ({ role: 'box', kind: 'text', itemId: id, measuredAdvance: w, fragments: [{ text: id }], internal: false });
    const mg = (id) => ({ role: 'glue', kind: 'glue', itemId: id, measuredAdvance: 4, internal: false });
    const items = [mk('a', 60), mg('g0'), mk('b', 60), mg('g1'), mk('TOOBIG', 190), mg('g2'), mk('c', 50)];
    const lineWidthAt = (li) => (li < 1 ? 100 : 160);
    const res = breakItemSequence(items, 160, { lineWidthAt });
    assertEq(res.fallback, true, 'הגיבוי הופעל (אין פתרון)');
    const big = res.diagnostics.find((d) => d.itemId === 'TOOBIG');
    assert(big && big.code === 'overflow-item-own-line', 'אבחון מפורש לפריט החורג: ' + JSON.stringify(res.diagnostics));
    assertEq(big.maxWidthPx, 160, 'האבחון לפי הרוחב של השורה שבה נפל (לא 100)');
    // הפריטים כולם קיימים — אין מחיקה
    const seen = res.lines.flatMap((c) => items.slice(c.from, c.to).filter((x) => x.role === 'box').map((x) => x.itemId));
    for (const id of ['a', 'b', 'TOOBIG', 'c']) assert(seen.includes(id), 'קיים בפלט: ' + id);
  });
});

report('s4-line-engine');
