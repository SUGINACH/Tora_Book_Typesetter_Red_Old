// tests/unit/s4-line-items.test.js — שלב 4: חוזה LineItem + שימור מקור (§4.1-1/3, §22)
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const fontResolver = require('../../src/engine/typography/font-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { buildLineSequences, LINE_ITEM_CONTRACT_VERSION } = require('../../src/engine/line/line-items');
const { layoutSequence, reconstructTextOfLines } = require('../../src/engine/line/line-model');
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

describe('שלב 4 — LineItem contract: כל שדות החוזה נשמרים לכל סוג פריט (§4.1-1)', () => {
  it('לכל תיבה: itemId, sourceRange, kind, fontId, measuredAdvance, inkBounds, breakOpportunities, constraints, diagnostics + קישור ל-MeasuredItem', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const ar = new AssetResolver();
    ar.addBytes('img/c.png', tinyPng(40, 24));
    const raw = 'כותרת 1 - חלק\nמילה רגילה ותמונה #img/c.png# והערה [הערה קצרה] בסוף.\n';
    const model = buildDocumentModel(raw, { assets: ar });
    const seqs = buildLineSequences(model, { settings: SETTINGS, assetResolver: ar });
    assert(seqs.ok, JSON.stringify(seqs.rejected));
    const boxes = [];
    for (const sq of seqs.sequences) for (const it of sq.items) if (it.role === 'box') boxes.push(it);
    assert(boxes.length >= 5, 'יש תיבות לבדוק');
    const kinds = new Set(boxes.map((b) => b.kind));
    assert(kinds.has('text') && kinds.has('image') && kinds.has('noteMarker'), JSON.stringify([...kinds]));
    for (const b of boxes) {
      assert(b.itemId && typeof b.itemId === 'string', 'itemId');
      assert(b.sourceRange && b.sourceRange.itemId != null, 'sourceRange');
      assert(b.kind, 'kind');
      assert(Number.isFinite(b.measuredAdvance) && b.measuredAdvance >= 0, 'measuredAdvance');
      assert(b.measured && b.measured.ok === true, 'קישור ל-MeasuredItem');
      assert(b.inkBounds, 'inkBounds');
      assert(Array.isArray(b.breakOpportunities), 'breakOpportunities');
      assert(Array.isArray(b.diagnostics), 'diagnostics');
      assert(b.contractVersion === LINE_ITEM_CONTRACT_VERSION, 'גרסת חוזה');
    }
    const img = boxes.find((b) => b.kind === 'image');
    assert(img.constraints && img.constraints.participates, 'אילוצי תמונה נשמרים');
    const mk = boxes.find((b) => b.kind === 'noteMarker');
    assert(mk.sourceAnchor && mk.sourceAnchor.startsWith('note-'), 'עוגן מקור לסמן: ' + mk.sourceAnchor);
  });
  it('מילה מרובת גופנים: fragments נשמרים — לעולם לא מחרוזת שטוחה (§4.1-3)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const inlineOptions = { fontMarkers: [{ id: 'david', open: '<<', close: '>>', family: 'David Libre' }] };
    const raw = 'כותרת 1 - חלק\nמילה מעורבת <<שלום>>ם בפנים ועוד מילה אחרונה.\n';
    const model = buildDocumentModel(raw, { inlineOptions });
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const multi = para.items.find((it) => it.role === 'box' && (it.fragments || []).length > 1);
    assert(multi, 'קיימת תיבה מרובת פרגמנטים');
    assertEq(multi.fragments.length, 2, 'שני פרגמנטים');
    assert(multi.fragments[0].text === 'שלום' && multi.fragments[1].text === 'ם', JSON.stringify(multi.fragments.map((f) => f.text)));
    assert(multi.fragments[0].fontId && multi.fragments[1].fontId, 'זהות גופן לכל פרגמנט');
    assert(multi.fragments[0].fontId !== multi.fragments[1].fontId, 'שתי משפחות שונות');
    assert(multi.fragments[0].runIndex !== multi.fragments[1].runIndex, 'מיפוי ריצה לכל פרגמנט');
    // סכום הפרגמנטים = ה-advance של התיבה (לא מדידה מחדש)
    const sum = multi.fragments.reduce((s, f) => s + f.advancePx, 0);
    assert(Math.abs(sum - multi.measuredAdvance) < 1e-9, `סכום פרגמנטים ${sum} = advance ${multi.measuredAdvance}`);
    // ה-LineModel משמר את הפרגמנטים גם בפלט
    const res = layoutSequence(para, { maxWidthPx: 300, lineHeightPx: 21.44 });
    const lmMulti = res.lines.flatMap((l) => l.fragments).find((f) => (f.fragments || []).length > 1);
    assert(lmMulti && lmMulti.fragments.length === 2, 'הפרגמנטים שרדו את השבירה');
  });
});

describe('שלב 4 — שימור מקור: אין אובדן, כפילות או שינוי סדר (§22)', () => {
  it('שחזור מדויק: מקור הפסקה = שחזור מכל השורות (מילה-במילה, בסדר)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nפסקה ראשונה ארוכה למדי עם הרבה מילים עבריות כדי שהשורות יישברו כמה פעמים בטור צר, ועוד משפט שני עם ניקוד מְנֻקָּד וגרשיים אב״ג וסוגריים (כאן) ומקף-מחבר, וסיום.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(para, { maxWidthPx: 200, lineHeightPx: 21.44 });
    assert(res.lines.length >= 2, 'הפסקה נשברה לכמה שורות');
    const recon = reconstructTextOfLines(res.lines);
    // ההשוואה מול הקנון של המודל (runs) — עגלת ה-round-trip של שלב 2 מעדיפה את הקינון (גרשיים→גרש היא נורמליזציה מתועדת של המודל)
    const runs = model.blocks.find((b) => b.kind === 'paragraph').items[0].payload.runs;
    const srcWords = runs.map((r) => String(r.text)).join('').split(/\s+/).filter(Boolean);
    const reconWords = recon.replace(/\u00A0/g, ' ').split(/\s+/).filter(Boolean);
    assertEq(reconWords.length, srcWords.length, 'מספר מילים זהה (אין אובדן/כפילות)');
    for (let i = 0; i < srcWords.length; i++) assertEq(reconWords[i], srcWords[i], `מילה ${i}`);
  });
  it('source ranges רציפים ונכונים: ההיסטים מצביעים לתוך הריצה המקורית', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const raw = 'כותרת 1 - חלק\nאבגד הוז חטיכ למנסע פצקרשת.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const boxes = para.items.filter((x) => x.role === 'box' && x.kind === 'text');
    const src = model.blocks.find((b) => b.kind === 'paragraph');
    const runs = src.items[0].payload.runs;
    const runText = String(runs[0].text);
    let prevEnd = null;
    for (const b of boxes) {
      const f = b.fragments[0];
      assertEq(runText.slice(f.start, f.end), f.text, 'הטווח מצביע לטקסט הנכון במקור');
      if (prevEnd != null) assert(f.start >= prevEnd, 'טווחים מסודרים');
      prevEnd = f.end;
    }
    // הטווחים מכסים את כל המילים (עם רווחים ביניהם)
    const covered = boxes.map((b) => b.fragments[0]).every((f) => f.text.length > 0);
    assert(covered, 'אין תיבה ריקה');
  });
  it('פרגמנטים שומרים font identity דרך השבירה — גם אחרי חיתוך בין מילים', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const inlineOptions = { fontMarkers: [{ id: 'david', open: '<<', close: '>>', family: 'David Libre' }] };
    const raw = 'כותרת 1 - חלק\nמילים רגילות כמה שורות טקסט ארוך מספיק בשביל שבירה אמיתית של הטור הצר הזה ואז <<גופן אחר>> בסוף הפסקה הזאת במיוחד.\n';
    const model = buildDocumentModel(raw, { inlineOptions });
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const res = layoutSequence(para, { maxWidthPx: 180, lineHeightPx: 21.44 });
    const allFrags = res.lines.flatMap((l) => l.fragments).flatMap((f) => f.fragments || []);
    const david = allFrags.filter((f) => f.fontId === fontResolver.fontIdOfAlias('David Libre'));
    assert(david.length >= 2, 'פרגמנטים של גופן אחר נשמרו: ' + david.length);
    for (const f of allFrags) {
      if (f.text) assert(f.fontId != null || f.fontFamily != null, 'לכל פרגמנט יש זהות גופן או משפחה מקורית');
    }
  });
});

describe('שלב 4 — זהות נגזרת-מקור ומיפוי מוחלט (§3.5 בהוראת התיקון)', () => {
  it('מזהי מילים/glue נגזרים מהמקור — יציבים בין בניות, ללא מונה רץ; שינוי תוכן אינו יוצר התנגשות', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const inlineOptions = { fontMarkers: [{ id: 'david', open: '<<', close: '>>', family: 'David Libre' }] };
    const raw = 'כותרת 1 - חלק\nמילים רגילות ואז <<גופן אחר>> וחזרה לגוף עם עוד מילים בסוף הפסקה הזאת.\n';
    const a = buildLineSequences(buildDocumentModel(raw, { inlineOptions }), { settings: SETTINGS });
    const b = buildLineSequences(buildDocumentModel(raw, { inlineOptions }), { settings: SETTINGS });
    const sa = a.sequences.find((s) => s.blockKind === 'paragraph');
    const sb = b.sequences.find((s) => s.blockKind === 'paragraph');
    assertEq(JSON.stringify(sa.items.map((i) => i.itemId)), JSON.stringify(sb.items.map((i) => i.itemId)), 'זהויות זהות בין שתי בניות של אותו מסמך');
    // הזהויות נגזרות מטווחי המקור — לא ממונה: אותה מילה באותו מקור ⇒ אותו מזהה גם בין מסמכים שונים לפניה
    const raw2 = 'כותרת 2 - אחר\nפתיחה שונה לגמרי כאן.\nמילים רגילות ואז <<גופן אחר>> וחזרה לגוף עם עוד מילים בסוף הפסקה הזאת.\n';
    const c = buildLineSequences(buildDocumentModel(raw2, { inlineOptions }), { settings: SETTINGS });
    const target = sa.items.find((i) => i.role === 'box' && (i.fragments || []).some((f) => f.text === 'מילים'));
    const targetC = c.sequences.filter((s) => s.blockKind === 'paragraph').map((s) => s.items.find((i) => i.role === 'box' && (i.fragments || []).some((f) => f.text === 'מילים'))).filter(Boolean);
    assert(targetC.length >= 1, 'המילה קיימת גם במסמך השני');
    // מזהים שונים בין המסמכים (טווח מקור שונה) — אך זהים בין בניות של אותו מסמך
    assert(targetC.every((t) => t.itemId !== target.itemId), 'טווח מקור שונה ⇒ מזהה שונה');
    // שינוי תוכן באותו מיקום — אין התנגשות מזהים בין מילים שונות של אותו פריט
    const ids = sa.items.filter((i) => i.role === 'box' && i.kind === 'text').map((i) => i.itemId);
    assertEq(new Set(ids).size, ids.length, 'מזהי מילים ייחודיים ברצף');
    // מזהי glue נגזרים מגבולות המקור של המפריד
    const glues = sa.items.filter((i) => i.role === 'glue' && !i.internal);
    for (const g of glues) {
      assert(/#g@\d+-\d+$/.test(g.itemId), 'מזהה glue נגזר מטווח מוחלט: ' + g.itemId);
      assert(g.sourceRange && Number.isFinite(g.sourceRange.start) && Number.isFinite(g.sourceRange.end), 'טווח מקור מוחלט ל-glue');
      assert(g.sourceRange.blockId, 'blockId ממולא ל-glue');
    }
    const gids = glues.map((g) => g.itemId);
    assertEq(new Set(gids).size, gids.length, 'מזהי glue ייחודיים');
  });
  it('מילה חוצת-ריצות: גבול ריצה בתוך מילה — fragments נפרדים; גבול ריצה ברווח — המילים נפרדות והרווח נשמר (תיקון שורש §3.5)', () => {
    registerRealFonts();
    clearItemMeasureCache();
    const inlineOptions = { fontMarkers: [{ id: 'david', open: '<<', close: '>>', family: 'David Libre' }] };
    // (א) גבול בתוך מילה: "שלום" בגוף + "ם" בגופן אחר = מילה אחת, שני פרגמנטים
    const rawMid = 'כותרת 1 - חלק\nמילה מעורבת <<שלום>>ם בפנים ועוד מילה אחרונה.\n';
    const mMid = buildDocumentModel(rawMid, { inlineOptions });
    const sMid = buildLineSequences(mMid, { settings: SETTINGS }).sequences.find((s) => s.blockKind === 'paragraph');
    const multi = sMid.items.find((it) => it.role === 'box' && (it.fragments || []).length > 1);
    assert(multi, 'מילה מרובת-פרגמנטים קיימת');
    assertEq(multi.fragments.length, 2, 'שני פרגמנטים');
    assert(multi.fragments[0].runIndex !== multi.fragments[1].runIndex, 'מיפוי ריצה לכל פרגמנט');
    // כל פרגמנט שומר את טווח המקור שלו בנפרד (מוחלט)
    for (const f of multi.fragments) {
      assert(Number.isFinite(f.docStart) && Number.isFinite(f.docEnd), 'טווח מוחלט פר-פרגמנט');
      assert(f.docEnd > f.docStart, 'טווח תקין');
    }
    assert(multi.fragments[1].docStart >= multi.fragments[0].docEnd, 'טווחי הפרגמנטים רצופים');
    // (ב) גבול ריצה ברווח: "ואז " בגוף + " בסוף" אחרי גופן — המילים נפרדות, הרווח לא אובד
    const rawGap = 'כותרת 1 - חלק\nמילים רגילות בתחילת הפסקה ואז <<גופן אחר>> בסוף הפסקה הזאת במיוחד.\n';
    const mGap = buildDocumentModel(rawGap, { inlineOptions });
    const sGap = buildLineSequences(mGap, { settings: SETTINGS }).sequences.find((s) => s.blockKind === 'paragraph');
    const boxes = sGap.items.filter((x) => x.role === 'box' && x.kind === 'text');
    const texts = boxes.map((b) => b.fragments.map((f) => f.text).join(''));
    assert(texts.includes('אחר') && texts.includes('בסוף'), 'שתי המילים סביב גבול הריצה קיימות כתיבות נפרדות');
    assert(!texts.some((t) => t.includes('אחרבסוף')), 'המילים לא התמזגו דרך הרווח (הבאג שתוקן)');
    const res = layoutSequence(sGap, { maxWidthPx: 500, lineHeightPx: 21.44 });
    const src = mGap.blocks.find((b) => b.kind === 'paragraph').items[0].payload.runs.map((r) => r.text).join('');
    assertEq(reconstructTextOfLines(res.lines), src, 'שחזור מדויק — הרווח בין הריצות נשמר');
  });
  it('מפרידים מרובים, ניקוד, הערות ומזהי פריטים חוזרים — דיוק והיעדר התנגשויות', () => {
    registerRealFonts();
    clearItemMeasureCache();
    // רווח כפול במקור — נשמר כמפריד מדויק (מחרוזת בת 2 תווים) ולא מתמזג
    const raw = 'כותרת 1 - חלק\nמילה  רווח־כפול וגם הַמְּדֻבָּר מְנֻקָּד והערה [תוכן קצר] באמצע וסיום.\n';
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings: SETTINGS });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    const dbl = para.items.find((g) => g.role === 'glue' && !g.internal && (g.gapChars || g.sep) === '  ');
    assert(dbl, 'רווח כפול נשמר כמפריד מדויק (שני תווים)');
    // ניקוד: המילה המנוקדת תיבה אחת שלמה
    const nikud = para.items.find((b) => b.role === 'box' && (b.fragments || []).some((f) => /[\u0591-\u05C7]/.test(f.text)));
    assert(nikud && (nikud.fragments || []).length === 1, 'מילה מנוקדת — תיבה אחת');
    // הערה: סמן עם noteRef + יחידה צמודה
    const mk = para.items.find((x) => x.kind === 'noteMarker');
    assert(mk && mk.noteRef && mk.noteRef.startsWith('note-'), 'זהות עוגן על תיבת הסמן');
    // מזהי פריטים חוזרים (מודל חריג — אותו id לשני פריטים): המילים עדיין ייחודיות (טווח שונה)
    const hacked = buildDocumentModel('כותרת 1 - חלק\nאחת שתיים שלוש.\n', {});
    const blk = hacked.blocks.find((b) => b.kind === 'paragraph');
    const idA = blk.items[0].id;
    blk.items.push({ ...blk.items[0], id: idA, payload: { runs: [{ text: 'ארבע חמש שש.', fontFamily: null, sourceStart: 0, sourceEnd: 11 }] }, sourceRange: { start: 1000, end: 1011 } });
    const seqs2 = buildLineSequences(hacked, { settings: SETTINGS });
    const para2 = seqs2.sequences.find((s) => s.blockKind === 'paragraph');
    const wordIds = para2.items.filter((i) => i.role === 'box' && i.kind === 'text').map((i) => i.itemId);
    assertEq(new Set(wordIds).size, wordIds.length, 'גם עם מזהה פריט כפול — מזהי המילים ייחודיים (נגזרים מהטווח)');
    // blockId אינו null כשהוא ידוע — בכל תיבה ובכל glue
    for (const it of para2.items) {
      if (it.role === 'penalty') continue;
      assert(it.sourceRange && it.sourceRange.blockId === para2.blockId, 'blockId ממולא: ' + it.itemId);
      assert(Number.isFinite(it.sourceRange.start) && Number.isFinite(it.sourceRange.end), 'טווח מוחלט: ' + it.itemId);
    }
  });
});

report('s4-line-items');
