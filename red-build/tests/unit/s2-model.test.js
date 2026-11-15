// tests/unit/s2-model.test.js — שלב 2: מודל התוכן הקנוני — round-trip, זהות, אימות, שקילות adapter.
// **תוכנית קנונית §2.3 (שער קבלה):** כל סוגי התוכן מיוצגים; זהות ומקור נשמרים;
// round-trip אינו מאבד תווים/סדר/עוגנים/גופנים/asset identity; מבנה לא תקין
// נדחה או מדווח במפורש; אין פרסר/AST מקביל במסלול הריצה החדש.
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { modelToTokens, tokensEqual } = require('../../src/engine/model/adapter');
const { reconstructSource, rebuildCanonicalLine } = require('../../src/engine/model/roundtrip');
const { validateDocumentModel } = require('../../src/engine/model/validate');
const { BLOCK_KINDS, ITEM_KINDS } = require('../../src/engine/model/kinds');
const { tokenize } = require('../../src/engine/parser/block-tokenizer');
const { lexDocument } = require('../../src/engine/parser/dfa-lexer');
const { parseInlineRuns, inlineRunsSourceText } = require('../../src/engine/parser/inline-content');

// ── קלטי בדיקה: מבנה תקין מבחינת המשתמש (כותרות עם טקסט ביניהן, כותרת סופית
// עם תוכן אמיתי, שום כותרת של הערה בלבד) — אין קלטים פגומים כראיה. ──
const SAMPLES = {
  headings: 'כותרת 1 - חלק ראשון\nטקסט גוף ראשון.\nכותרת 2 - פרק\nעוד טקסט גוף.\nכותרת 3 - משנה\nטקסט.\nכותרת 7 - הערת צד\nטקסט אחרון.\n',
  hebrewEdge: 'כותרת 1 - חלק\nפסקה עם סוגריים (בתוך הטקסט) ו״גרשיים״ ו‘מרכאות’ לועזיות.\nהערה [עם  רווח  כפול] בפנים.\nטקסט סופי אמיתי.\n',
  metadata: 'שם הספר - ספר הבדיקות\nנושא - נושא\nפרטי מהדורא - מהדורה ראשונה\n\nכותרת 1 - פתיחה\nטקסט גוף אחרי מטא-דאטה.\n',
  endnotes: 'כותרת 1 - חלק\nהערת סיום - הערה רגילה\nטקסט גוף.\nהערת סיום-12 - הערה ממוספרת\nעוד טקסט.\nהערות סיום - כותרת הערות\nטקסט מסיים.\n',
  editorial: 'כותרת 1 - חלק\n##הערת עורך## טקסט עם אדיטוריאל בתוך השורה\n##כולו אדיטוריאל##\nטקסט אחרי שורת אדיטוריאל.\n',
  spacing: 'כותרת 1 - חלק\n   שורה עם הזחה בפתיחה   \n\n\nטקסט אחרי שורות ריקות   \n',
  rtlLtr: 'כותרת  2 - מרווח כפול בכותרת\nטקסט RTL עם English mixed וגם 123 numbers בתוכו.\ntrailing whitespace line  \nטקסט אחרון.\n',
  consecutive: 'כותרת 1 - חלק\nטקסט.\n[a][b] שתי הערות רצופות\nעוד משפט.\n'
};

describe('שלב 2 — מודל קנוני: round-trip ושימור מקור', () => {

  for (const [name, raw] of Object.entries(SAMPLES)) {
    it(`round-trip תו-מול-תו [${name}]`, () => {
      const model = buildDocumentModel(raw, {});
      const back = reconstructSource(model);
      assertEq(back, raw, `round-trip שינה את המקור [${name}]`);
    });
  }

  it('round-trip מלא על הקורפוס הראשי (very_long)', () => {
    const corpusPath = path.join(__dirname, '..', '..', '..', 'audits', 'very_long_test_text.txt');
    if (!fs.existsSync(corpusPath)) return; // סביבה בלי הקורפוס — בדיקת הקורפוס ב-CI
    const raw = fs.readFileSync(corpusPath, 'utf8');
    const model = buildDocumentModel(raw, {});
    assertEq(reconstructSource(model), raw, 'round-trip הקורפוס הראשי איבד תווים');
  });

  it('round-trip עם CRLF (מיפוי סופי-שורה נשמר)', () => {
    const raw = 'כותרת 1 - חלק\r\nטקסט גוף.\r\nעוד שורה\r\n';
    const model = buildDocumentModel(raw, {});
    assertEq(reconstructSource(model), raw, 'CRLF לא שוחזר');
  });

  it('נרמול התווים הפיך — גרשיים ומרכאות נשמרים במקור', () => {
    const raw = 'כותרת 1 - חלק\n״ציטוט״ ו‘עוד’ ציטוט.\n';
    const model = buildDocumentModel(raw, {});
    const para = model.blocks.find(b => b.kind === 'paragraph');
    assert(para.source.normalizations.length >= 3, 'רשומות נרמול חסרות');
    // הפריט נושא את הצורה הקנונית; ההיפוך מוכח ב-round-trip המלא.
    assert(para.items[0].payload.text.includes('\u05F3'), 'הצורה הקנונית (גרש) חסרה');
  });
});

describe('שלב 2 — זהות דטרמיניסטית וקישורים מבניים', () => {

  it('מזהים יציבים בין ריצות (אין מוני ריצה בזהות)', () => {
    const raw = SAMPLES.hebrewEdge;
    const m1 = buildDocumentModel(raw, {});
    const m2 = buildDocumentModel(raw, {});
    assertEq(m1.docId, m2.docId, 'docId אינו יציב');
    assertEq(m1.blocks.map(b => b.id), m2.blocks.map(b => b.id), 'מזהי בלוקים אינם יציבים');
    assertEq(m1.notes.map(n => n.id), m2.notes.map(n => n.id), 'מזהי הערות אינם יציבים');
    assertEq(m1.blocks.flatMap(b => b.items.map(i => i.id)), m2.blocks.flatMap(b => b.items.map(i => i.id)), 'מזהי פריטים אינם יציבים');
  });

  it('קישור סמן↔גוף הערה מבני ודו-כיווני', () => {
    const model = buildDocumentModel(SAMPLES.hebrewEdge, {});
    assert(model.notes.length >= 1, 'הערה חסרה');
    for (const note of model.notes) {
      const marker = model.blocks.flatMap(b => b.items).find(i => i.id === note.payload.markerRef);
      assert(marker, `סמן חסר להערה ${note.id}`);
      assertEq(marker.payload.noteRef, note.id, 'noteRef אינו דו-כיווני');
      assertEq(marker.parentId, note.parentId, 'סמן וגוף בבלוקים שונים');
    }
    for (const marker of model.blocks.flatMap(b => b.items).filter(i => i.kind === 'noteMarker')) {
      assert(model.notes.some(n => n.id === marker.payload.noteRef), `גוף חסר לסמן ${marker.id}`);
    }
  });

  it('זהות המשך (continuation) קיימת לכל גוף הערה', () => {
    const model = buildDocumentModel(SAMPLES.hebrewEdge, {});
    for (const note of model.notes) {
      assert(note.continuation && note.continuation.sharedId === note.id, 'זהות המשך חסרה');
    }
  });

  it('עוגן לכל כותרת ולכל סמן הערה', () => {
    const model = buildDocumentModel(SAMPLES.headings + SAMPLES.consecutive, {});
    const headingBlocks = model.blocks.filter(b => b.kind === 'heading').length;
    const headingAnchors = model.anchors.filter(a => a.targetBlockId && model.blocks.some(b => b.id === a.targetBlockId && b.kind === 'heading')).length;
    assertEq(headingAnchors, headingBlocks, 'עוגן חסר לכותרת');
    const noteMarkers = model.blocks.flatMap(b => b.items).filter(i => i.kind === 'noteMarker').length;
    const noteAnchors = model.anchors.filter(a => a.targetNoteId).length;
    assertEq(noteAnchors, noteMarkers, 'עוגן חסר לסמן הערה');
  });

  it('סדר הפריטים רציף לכל בלוק וסדר הבלוקים שמור', () => {
    const model = buildDocumentModel(SAMPLES.headings, {});
    model.blocks.forEach((b, i) => assertEq(b.order, i, 'סדר בלוקים שבור'));
    for (const b of model.blocks) {
      b.items.forEach((it, i) => assertEq(it.order, i, `סדר פריטים שבור בבלוק ${b.id}`));
    }
  });

  it('מודל על מסמך עם כותרות 0–7: parentId משקף את החלק', () => {
    const model = buildDocumentModel(SAMPLES.headings, {});
    const h1 = model.blocks.find(b => b.kind === 'heading' && b.level === 1);
    assert(h1, 'כותרת 1 חסרה');
    const after = model.blocks.filter(b => b.order > h1.order);
    for (const b of after) assertEq(b.parentId, h1.id, 'parentId אינו החלק המכיל');
  });
});

describe('שלב 2 — Inline Item Model: טווחי גופן, תמונות, פריטים אטומיים', () => {

  const FONT_OPTS = { inlineOptions: { knownFamilies: ['Frank Ruhl Libre', 'David Libre'] } };

  it('טווח גופן = מקטע עם family identity ומיקום מקור מדויק', () => {
    const raw = 'כותרת 1 - חלק\nמילה רגילה <Frank Ruhl Libre>מילה בגופן</> ומילה אחרונה.\n';
    const model = buildDocumentModel(raw, FONT_OPTS);
    const para = model.blocks.find(b => b.kind === 'paragraph');
    const runs = para.items[0].payload.runs;
    assert(runs.length === 3, `ציפה 3 מקטעים, קיבל ${runs.length}`);
    assertEq(runs[1].fontFamily, 'Frank Ruhl Libre', 'family identity אבד');
    assert(runs[1].sourceStart < runs[1].sourceEnd, 'טווח מקור של מקטע שגוי');
    // מילה אחת עם שני גופנים — לא מיזוג למחרוזת שטוחה:
    const raw2 = 'כותרת 1 - חלק\nמי<Frank Ruhl Libre>לה</> מעורבת\n';
    const m2 = buildDocumentModel(raw2, FONT_OPTS);
    const runs2 = m2.blocks.find(b => b.kind === 'paragraph').items[0].payload.runs;
    assert(runs2.some(r => r.fontFamily === 'Frank Ruhl Libre'), 'מקטע הגופן בתוך המילה אבד');
  });

  it('תמונה היא פריט אמיתי בזרם עם assetId ומקור', () => {
    const raw = 'כותרת 1 - חלק\nטקסט לפני #images/pic.jpg.c60# וטקסט אחרי.\n';
    const model = buildDocumentModel(raw, {});
    const para = model.blocks.find(b => b.kind === 'paragraph');
    const img = para.items.find(i => i.kind === 'image');
    assert(img, 'פריט תמונה חסר בזרם');
    assertEq(img.payload.resourcePath, 'images/pic.jpg', 'נתיב הנכס שגוי');
    assertEq(img.payload.widthPct, 60, 'אחוז הרוחב אבד');
    assert(img.payload.assetId && img.payload.assetId.startsWith('ast-'), 'assetId חסר');
    assertEq(img.sourceText, '#images/pic.jpg.c60#', 'טקסט המקור של התמונה אבד');
    assert(img.constraints.atomic === true, 'תמונה אינה אטומית');
    // round-trip שומר את התחביר כולו:
    assertEq(reconstructSource(model), raw, 'round-trip עם תמונה נכשל');
  });

  it('סמן הערה אטומי עם תוחמים מדויקים', () => {
    const model = buildDocumentModel(SAMPLES.consecutive, {});
    const markers = model.blocks.flatMap(b => b.items).filter(i => i.kind === 'noteMarker');
    assertEq(markers.length, 2, 'שני סמנים צפויים');
    for (const m of markers) {
      assert(m.constraints.atomic, 'סמן אינו אטומי');
      assertEq(m.payload.delimiters.open, '[', 'תוחם פתיחה שגוי');
      assertEq(m.payload.delimiters.close, ']', 'תוחם סגירה שגוי');
    }
  });

  it('תוחמים מותאמים (( )) נשמרים במדויק', () => {
    const raw = 'כותרת 1 - חלק\nטקסט (הערה בסוגריים) המשך.\n';
    const model = buildDocumentModel(raw, { parseOpts: { fnOpen: '(', fnClose: ')' } });
    const marker = model.blocks.flatMap(b => b.items).find(i => i.kind === 'noteMarker');
    assert(marker, 'סמן חסר עם תוחמים מותאמים');
    assertEq(marker.payload.delimiters.open, '(', 'תוחם פתיחה מותאם אבד');
    assertEq(reconstructSource(model), raw, 'round-trip עם תוחמים מותאמים נכשל');
  });

  it('פרסר ה-inline: שחזור מקור מהריצות (lossless projection)', () => {
    const src = 'א ב<Frank Ruhl Libre>ג ד</> ה #i/p.png# ו';
    const parsed = parseInlineRuns(src, { knownFamilies: ['Frank Ruhl Libre'] });
    const pieces = [];
    let cursor = 0;
    const spans = [...parsed.markerSpans].sort((a, b) => a.start - b.start);
    let si = 0;
    for (const run of parsed.runs) {
      while (si < spans.length && spans[si].start <= run.sourceStart) {
        pieces.push(spans[si].text);
        cursor = spans[si].end;
        si++;
      }
      if (run.sourceStart > cursor) pieces.push(src.slice(cursor, run.sourceStart));
      pieces.push(run.kind === 'text' ? run.text : (run.sourceText || ''));
      cursor = Math.max(cursor, run.sourceEnd);
    }
    while (si < spans.length) { pieces.push(spans[si].text); cursor = spans[si].end; si++; }
    assertEq(pieces.join(''), src, 'השחזור מהריצות אינו מדויק');
  });
});

describe('שלב 2 — אימות סכמה קשיח (אין השמטה שקטה)', () => {

  it('מסמך תקין: אפס שגיאות', () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      const v = validateDocumentModel(buildDocumentModel(raw, {}));
      assert(v.ok, `[${name}] שגיאות אימות לא צפויות: ${JSON.stringify(v.errors)}`);
    }
  });

  it('שתי כותרות רצופות מאותה רמה בלי טקסט — מדווח במפורש', () => {
    const raw = 'כותרת 1 - חלק\nטקסט.\nכותרת 3 - ראשונה\nכותרת 3 - שנייה\nטקסט אחרי.\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(!v.ok, 'מבנה לא תקין לא נתפס');
    assert(v.errors.some(e => e.code === 'consecutive-headings-no-text'), 'קוד הממצא המצופה חסר');
  });

  it('כותרת ללא טקסט ממשי — מדווח במפורש (בדיקת הולידטור על מודל שנשבר)', () => {
    // הטוקניזר לעולם אינו מייצר כותרת ריקה מקלט (בלי טקסט אחרי המקף — פסקה);
    // הולידטור חייב לתפוס מודל שבו זה כן קרה (מקור חיצוני/עריכה ידנית).
    const raw = 'כותרת 1 - חלק\nכותרת 4 - תוכן\nטקסט גוף.\n';
    const broken = buildDocumentModel(raw, {});
    const h = broken.blocks.find(b => b.kind === 'heading' && b.level === 4);
    h.items = [];
    const v = validateDocumentModel(broken);
    assert(v.errors.some(e => e.code === 'heading-without-text'), 'כותרת ריקה לא נתפסה');
  });

  it('פריט יתום / מזהה כפול / סוג לא מוכר — נדחים', () => {
    const model = buildDocumentModel(SAMPLES.hebrewEdge, {});
    // הפרה יזומה: ניתוק הסמן מגוף ההערה
    const broken = JSON.parse(JSON.stringify(model));
    const marker = broken.blocks.flatMap(b => b.items || []).find(i => i.kind === 'noteMarker');
    marker.payload.noteRef = 'note-nonexistent';
    let v = validateDocumentModel(broken);
    assert(v.errors.some(e => e.code === 'note-marker-orphan'), 'סמן יתום לא נתפס');
    // סוג לא מוכר
    const broken2 = JSON.parse(JSON.stringify(model));
    broken2.blocks[0].items.push({ id: 'x', kind: 'mystery-kind', parentId: broken2.blocks[0].id, order: 99, sourceRange: { start: 0, end: 1 }, sourceText: '?' });
    v = validateDocumentModel(broken2);
    assert(v.errors.some(e => e.code === 'item-kind-unknown'), 'סוג לא מוכר לא נתפס');
    // מזהה כפול
    const broken3 = JSON.parse(JSON.stringify(model));
    broken3.blocks.push(JSON.parse(JSON.stringify(broken3.blocks[0])));
    v = validateDocumentModel(broken3);
    assert(v.errors.some(e => e.code === 'block-id-duplicate'), 'מזהה כפול לא נתפס');
  });

  it('תמונות ללא מידות — אזהרה מתועדת (שלב 3 ימלא), לא שקט', () => {
    const raw = 'כותרת 1 - חלק\nטקסט #i/p.png# עוד.\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assertEq(v.ok, true, 'תמונה תקינה אינה שגיאה');
    assert(v.warnings.some(w => w.code === 'image-dimensions-pending'), 'אזהרת מידות חסרה');
  });

  it('registry: סוג מותאם נרשם עם חוזה מלא; kind מובנה אינו ניתן להחלפה', () => {
    const { registerItemType } = require('../../src/engine/model/registry');
    let threw = null;
    try { registerItemType('text', { schema: {}, validate: () => true, projectionContract: {} }); } catch (e) { threw = e; }
    assert(threw, 'סוג מובנה הוחלף בניגוד לחוזה');
    const unregister = registerItemType('custom:test-item', {
      schema: { payload: 'object' },
      validate: (item) => !!item.payload && !!item.payload.text,
      projectionContract: { dom: 'span.test-item', pdf: 'text-op' }
    });
    assert(require('../../src/engine/model/registry').registeredKinds().includes('custom:test-item'), 'הרישום לא התקבל');
    unregister();
  });
});

describe('שלב 2 — adapter היציאה: שקילות מלאה לטוקניזר (אין איבוד בין נתיבי פרסור)', () => {

  for (const [name, raw] of Object.entries(SAMPLES)) {
    it(`modelToTokens ≡ tokenize [${name}]`, () => {
      const { bodyLines } = lexDocument(raw, {});
      const orig = tokenize(bodyLines, {});
      const derived = modelToTokens(buildDocumentModel(raw, {}));
      assert(tokensEqual(orig, derived), `זרם הטוקנים הנגזר שונה [${name}]`);
    });
  }

  it('modelToTokens ≡ tokenize על הקורפוס הראשי', () => {
    const corpusPath = path.join(__dirname, '..', '..', '..', 'audits', 'very_long_test_text.txt');
    if (!fs.existsSync(corpusPath)) return;
    const raw = fs.readFileSync(corpusPath, 'utf8');
    const { bodyLines } = lexDocument(raw, {});
    const orig = tokenize(bodyLines, {});
    const derived = modelToTokens(buildDocumentModel(raw, {}));
    assertEq(orig.length, derived.length, 'מספר טוקנים שונה');
    assert(tokensEqual(orig, derived), 'זרם הטוקנים של הקורפוס הראשי שונה');
  });

  it('contentHash זהה דרך המודל', () => {
    const { contentHash } = require('../../src/engine/parser/block-tokenizer');
    const raw = SAMPLES.hebrewEdge + SAMPLES.endnotes;
    const { bodyLines } = lexDocument(raw, {});
    const origHash = contentHash(tokenize(bodyLines, {}));
    const model = buildDocumentModel(raw, {});
    assertEq(model.parse.contentHash, origHash, 'contentHash דרך המודל שונה');
  });

  it('rebuildCanonicalLine — כל שורה קנונית מכוסה מלא (אין חרירים)', () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      const model = buildDocumentModel(raw, {});
      for (const b of model.blocks) {
        if (b.kind === 'editorial') continue;
        const line = rebuildCanonicalLine(b, model); // throw אם כיסוי חסר/כפול
        assert(typeof line === 'string' && line.length >= 0, 'בנייה נכשלה');
      }
    }
  });
});

describe('שלב 2 — חוזה הרחבה (registry) ותנאי הסרת adapter', () => {
  it('ל-adapter יש תנאי הסרה מתועד (חוזה §4)', () => {
    const { ADAPTER_REMOVAL_CONDITION } = require('../../src/engine/model/adapter');
    assert(ADAPTER_REMOVAL_CONDITION && ADAPTER_REMOVAL_CONDITION.includes('שלבים 3'), 'תנאי הסרה חסר');
  });

  it('kinds: מילון יחיד — אין שמות מקבילים לאותו מושג', () => {
    assertEq(BLOCK_KINDS.PARAGRAPH, 'paragraph');
    assertEq(ITEM_KINDS.NOTE_MARKER, 'noteMarker');
    const allKinds = [...Object.values(ITEM_KINDS)];
    assertEq(new Set(allKinds).size, allKinds.length, 'כפילות שמות במילון הפריטים');
  });
});

describe('שלב 2 — טוהר הנתיב היציאה (D-S2P1): אין מצב גלובאלי ואין שינוי קלט', () => {

  // טוהר 1: modelToTokens אינו משנה את המודל המקורי — השוואת deep snapshot לפנות ואחרי.
  // מכסה גם את reconstructSource (הפונקציה השנייה שהזריקה פעם blk._notes).
  for (const [name, raw] of Object.entries(SAMPLES)) {
    it(`modelToTokens אינו משנה את המודל [מדגם: ${name}]`, () => {
      const model = buildDocumentModel(raw, {});
      const snapshot = JSON.stringify(model);
      modelToTokens(model);
      assertEq(JSON.stringify(model), snapshot, `המודל השתנה בעקבות ה-adapter [${name}]`);
      reconstructSource(model);
      assertEq(JSON.stringify(model), snapshot, `המודל השתנה בעקבות reconstructSource [${name}]`);
      // המודל נקי משדות זמניים שהוזרקו בעבר
      assert(!snapshot.includes('_notes'), `נמצא שדה זמני _notes במודל [${name}]`);
    });
  }

  // טוהר 2: שתי קריות חוזרות מחזירות פלט זהה (אין מצב שדולף בין קריאות).
  it('שתי קריות חוזרות מחזירות זרם זהה בדיוק', () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      const model = buildDocumentModel(raw, {});
      const first = JSON.stringify(modelToTokens(model));
      const second = JSON.stringify(modelToTokens(model));
      assertEq(second, first, `פלט שני שונה מפלט ראשון [${name}]`);
    }
  });

  // טוהר 3: קריות משולבבות על שני מסמכים שונים אינן משפיעות זו על זו.
  // הפרופיל: A→B→A→B — הפלט של כל מסמך יציב לאורך כל הרצפים, והמונה אינו דולף בין מסמכים.
  it('קריות משולבבות על שני מסמכים נפרדות זו מזו', () => {
    const rawA = SAMPLES.endnotes;
    const rawB = SAMPLES.editorial;
    const modelA = buildDocumentModel(rawA, {});
    const modelB = buildDocumentModel(rawB, {});
    const a1 = JSON.stringify(modelToTokens(modelA));
    const b1 = JSON.stringify(modelToTokens(modelB));
    const a2 = JSON.stringify(modelToTokens(modelA));
    const b2 = JSON.stringify(modelToTokens(modelB));
    assertEq(a2, a1, 'מסמך A הושפע ממסמך B');
    assertEq(b2, b1, 'מסמך B הושפע ממסמך A');
    // זהות טוקנים מתחילות מ-t1 בכל קריאה — אין דליפת מעצם מודול רצוף.
    const bTokens = JSON.parse(b1);
    assert(bTokens.length > 0 && bTokens[0].id === 't1', 'המונה הגלובאלי דלף לקריאה השנייה');
  });

  // טוהר 4: מזהי הטוקנים זהות לטוקניזר הישיר — רצף t1…tN מתוך המודל ולא מתוך מצב משותף.
  it('מזהי הטוקנים זהות לטוקניזר הישיר (t1…tN)', () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      const { bodyLines } = lexDocument(raw, {});
      const orig = tokenize(bodyLines, {});
      const derived = modelToTokens(buildDocumentModel(raw, {}));
      assertEq(derived.length, orig.length, `מספר טוקנים שונה [${name}]`);
      for (let k = 0; k < orig.length; k++) {
        assertEq(derived[k].id, orig[k].id, `מזהה טוקן ${k} שונה [${name}]`);
        assertEq(derived[k].id, `t${k + 1}`, `הרצף שבור [${name}] במקום ${k}`);
      }
    }
  });

  // טוהר 5: המודל נשאר תקין אחרי adapter + round-trip + validation.
  it('המודל תקין אחרי adapter, round-trip וולידציה', () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      const model = buildDocumentModel(raw, {});
      const derived = modelToTokens(model);
      assert(derived.length > 0, `פלט ריק [מדגם: ${name}]`);
      assertEq(reconstructSource(model), raw, `round-trip נשבר אחרי ה-adapter [${name}]`);
      const v = validateDocumentModel(model);
      assert(v.ok, `ולידציה נכשלה אחרי ה-adapter [${name}]: ${JSON.stringify(v.errors)}`);
      // ולידציה על מודל מודור — פונקציה טהורה מקבלת קלט לא פגוע.
      const fresh = buildDocumentModel(raw, {});
      assert(validateDocumentModel(fresh).ok, `מודל טרי נפגע [מדגם: ${name}]`);
      assertEq(JSON.stringify(fresh), JSON.stringify(model), `מודל טרי שונה ממודל שעבר דרך ה-adapter [${name}]`);
    }
  });
  // ביקורת שלב 2 (§3): הכרעה סמנטית מפורשת — "טקסט בין כותרות" = תוכן גוף אמיתי.
  // גוף הערת-סיום, שורת editorial והוריית עמודי-הערות אינם תוכן כזה — הם שקופים לכלל.
  it('הערת-סיום בלבד בין שתי כותרות מאותו רמה — מדווח במפורש', () => {
    const raw = 'כותרת 3 - ראשונה\nהערת סיום - תוכן הערה בלבד\nכותרת 3 - שנייה\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(!v.ok, 'הפרה סמנטית לא נתפסה');
    assert(v.errors.some(e => e.code === 'consecutive-headings-no-text'), 'קוד שגיאה שגוי');
    assert(v.errors.some(e => e.message.includes('endnote')), 'ההודיעות לא מציין את המפריד הטכני');
  });

  it('שורת editorial בלבד בין שתי כותרות מאותו רמה — מדווח (האדיטוריאל מוסר מהפלט)', () => {
    const raw = 'כותרת 4 - ראשונה\n##הערת עורך שלמה##\nכותרת 4 - שנייה\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(!v.ok && v.errors.some(e => e.code === 'consecutive-headings-no-text'), 'לא נתפס');
  });

  it('הוריית עמודי-הערות בלבד בין שתי כותרות מאותו רמה — מדווח', () => {
    const raw = 'כותרת 2 - ראשונה\nהערות סיום - כותרת\nכותרת 2 - שנייה\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(!v.ok && v.errors.some(e => e.code === 'consecutive-headings-no-text'), 'לא נתפס');
  });

  it('הערת-סיום + פסקה אמיתית בין הכותרות — תקין (הפסקה היא תוכן אמיתי)', () => {
    const raw = 'כותרת 3 - ראשונה\nהערת סיום - תוכן הערה\nטקסט גוף אמיתי ביניהן.\nכותרת 3 - שנייה\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(v.ok, 'מסמך תקין נדחה: ' + JSON.stringify(v.errors));
  });

  it('רמות שונות דרך הערת-סיום — תקיד (הכלל חל רק על אותה רמה)', () => {
    const raw = 'כותרת 3 - ראשונה\nהערת סיום - תוכן הערה\nכותרת 4 - שונה רמה\n';
    const v = validateDocumentModel(buildDocumentModel(raw, {}));
    assert(v.ok, 'נדחה שלא לצורך: ' + JSON.stringify(v.errors));
  });
});

report('s2-model');


