// tests/e2e/s9b-notes-glue.test.js — שלב 9b פרוסה 9b.4: הדבקת הערות חוצות-שורות
// בפרסר הקנוני (D-91 — התנהגות המקור היא המפרס) + שימור מלא (round-trip
// תו-לתו) + זהות adapter + אין היעלמות שקטה (ממצאים מפורשים).
'use strict';

const path = require('path');
const fs = require('fs');
const { describe, it, assert, assertEq, report } = require('../harness');

const RB = path.join(__dirname, '..', '..');
const ROOT = path.join(RB, '..');

const { typeset } = require('../../src/engine/core/pipeline');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { registerFont } = require('../../src/engine/typography/measure-api');
const { lexDocument } = require('../../src/engine/parser/dfa-lexer');
const { tokenize, tokenizeDetailed, hasUnclosedNote } = require('../../src/engine/parser/block-tokenizer');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { modelToTokens } = require('../../src/engine/model/adapter');
const { reconstructSource } = require('../../src/engine/model/roundtrip');

function registerAllFonts() {
  const FONTS = [
    ['Guttman Rashi', 'Guttman-Rashi-Normal.ttf'], ['Frank Ruhl Libre', 'FrankRuhlLibre-VF.ttf'],
    ['Alpha', 'Alpha-Regular.ttf'], ['AlphaBlack', 'Alpha-Black.ttf'], ['AlphaLight', 'AlphaLight-Regular.ttf'],
    ['Lia Sgula', 'Sgula-Regular.ttf'], ['Livorna', 'Livorna-Regular.ttf'], ['FrankReal', 'FrankReal-Regular.ttf'],
    ['David Libre', 'DavidLibre-Regular.ttf'], ['Hadassah Friedlaender', 'Hadassah-Friedlaender.ttf']
  ];
  for (const [fam, file] of FONTS) {
    const fp = path.join(RB, 'ui/assets/imud/fonts', file);
    if (fs.existsSync(fp)) { const r = registerFont(fam, fs.readFileSync(fp)); if (!r.ok) throw new Error(`registerFont(${fam}): ${r.error}`); }
  }
}

/** השוואת זרמי טוקנים בלי הערות-זיהוי נגזרות של ה-adapter (blockId — תוספת טהורה מתועדת). */
function stripDerived(tokens) { return tokens.map(t => { const { blockId, ...rest } = t; void blockId; return rest; }); }
function tokensEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const DOC_2PART = [
  'שם הספר - ספר הבדיקה',
  '',
  'פסקה ראשונה לפני ההערה.',
  'ולפ"ז יש לבאר דקדוק מה שלא נכתב [ועיין בקצוה"ח ס\' רכז\' סק"א',
  'ואולי ובזה יש לשמוע מה שיועיל] וכאן ממשיך הגוף אחרי הסוגר.',
  'כותרת 2 - כותרית',
  'פסקה אחרי הכותרת.',
].join('\n');

const DOC_3PART_CRLF = 'מקור עם CRLF\r\n\r\nפסקה [הערה א\nממשיכה עוד שורה\nועוד אחת] וזנב.\r\nאחרונה.';

const DOC_UNCLOSED_EOF = 'שם הספר - ב\n\nפסקה [פתוחה בלי סוגר בכלל';

const DOC_BLANK_STOP = 'שם הספר - ב\n\nראשון [פתוח\n\nשני ממשיך]';

const DOC_PAIR_PLUS_OPEN = 'שם הספר - ב\n\nפסקה עם [סגור] ואז [פתוח';

const DOC_STRUCTURAL = 'שם הספר - ב\n\nפסקה [פתוח\nכותרת 3 - נבלעה\nוסוגר] הנה';

describe('s9b-notes-glue — הדבקת הערות חוצות-שורות (D-91) + שימור מלא', () => {
  registerAllFonts();

  it('hasUnclosedNote: סמנטיקת המקור — פותח בלי סוגר אחריו בלבד', () => {
    assert(hasUnclosedNote('טקסט [פתוח', '[', ']') === true, 'פתוח פשוט');
    assert(hasUnclosedNote('טקסט [סגור] המשך', '[', ']') === false, 'סגור');
    assert(hasUnclosedNote('יש [זוג] ואז [פתוח', '[', ']') === false, 'זוג סגור + פתוח בסוף — אין הדבקה (הסוגר של הזוג נמצא אחרי הפותח הראשון)');
    assert(hasUnclosedNote('אין סוגריים בכלל', '[', ']') === false, 'בלי סוגריים');
    assert(hasUnclosedNote('x', '', '') === false, 'תוחמים ריקים — זיהוי מבוטל');
  });

  it('טוקניזציה: הערה חוצת-שורות נחלצת כהערה אחת שלמה', () => {
    const lex = lexDocument(DOC_2PART, {});
    const det = tokenizeDetailed(lex.bodyLines, {});
    const para = det.tokens.find(t => t.type === 'paragraph' && (t.notes || []).length === 1);
    assert(para != null, 'לא נמצאה פסקה עם הערה');
    assertEq(para.notes[0].replace(/\uE000/g, ' '), 'ועיין בקצוה"ח ס\' רכז\' סק"א ואולי ובזה יש לשמוע מה שיועיל', 'טקסט ההערה — חיבור רווח בודד של השורות המקוצצות');
    const glued = det.lines.filter(l => l.kind === 'glued');
    assertEq(glued.length, 1, 'רשומת שלד אחת לשורה שנבלעה');
    assertEq(glued[0].primaryBodyLineIndex, 1, 'השורה הראשית היא שורת הפתיחה של ההערה (bodyLineIndex 1 — אחרי הפתיח)');
  });

  it('round-trip: שחזור תו-לתו של כל המסמכים הסינתטיים (2 חלקים, 3 חלקים+CRLF, פתוחה, עצירת-רווח, זוג+פתוח)', () => {
    for (const [name, doc] of [['2-part', DOC_2PART], ['3-part CRLF', DOC_3PART_CRLF], ['unclosed EOF', DOC_UNCLOSED_EOF], ['blank stop', DOC_BLANK_STOP], ['pair+open', DOC_PAIR_PLUS_OPEN], ['structural', DOC_STRUCTURAL]]) {
      const model = buildDocumentModel(doc, {});
      assertEq(reconstructSource(model), doc, `round-trip [${name}]`);
    }
  });

  it('adapter: modelToTokens ≡ tokenize על כל המסמכים הסינתטיים', () => {
    for (const [name, doc] of [['2-part', DOC_2PART], ['3-part CRLF', DOC_3PART_CRLF], ['unclosed EOF', DOC_UNCLOSED_EOF], ['blank stop', DOC_BLANK_STOP], ['pair+open', DOC_PAIR_PLUS_OPEN], ['structural', DOC_STRUCTURAL]]) {
      const lex = lexDocument(doc, {});
      const model = buildDocumentModel(doc, {});
      assert(tokensEqual(tokenize(lex.bodyLines, {}), stripDerived(modelToTokens(model))), `adapter ≡ [${name}]`);
    }
  });

  it('מודל: הערה אחת עם sourceText מלא וסמן יחיד', () => {
    const model = buildDocumentModel(DOC_2PART, {});
    assertEq((model.notes || []).length, 1, 'הערה אחת במודל');
    const note = model.notes[0];
    assert(note.sourceText.includes('ועיין בקצוה"ח') && note.sourceText.includes('מה שיועיל'), 'גוף ההערה שלם (שתי השורות)');
    const markers = model.blocks.flatMap(b => b.items.filter(it => it.kind === 'noteMarker'));
    assertEq(markers.length, 1, 'סמן אחד בגוף (D-30 — הסמן בעוגן)');
  });

  it('פתוחה בסוף מסמך: התוכן נשמר בגוף + ממצא מפורש unmatched-note-opener', () => {
    const lex = lexDocument(DOC_UNCLOSED_EOF, {});
    const det = tokenizeDetailed(lex.bodyLines, {});
    const p = det.tokens.find(t => t.type === 'paragraph' && /פתוחה/.test(t.raw));
    assert(p != null && p.notes.length === 0, 'אין הערה — אבל הטקסט נשאר בגוף');
    assert(/פתוחה בלי סוגר בכלל/.test(p.raw), 'הטקסט הפתוח נראה בגוף תו-לתו');
    const model = buildDocumentModel(DOC_UNCLOSED_EOF, {});
    const diags = model.blocks.flatMap(b => (b.diagnostics || []).filter(d => d.code === 'unmatched-note-opener'));
    assert(diags.length >= 1, 'ממצא מפורש: פותח בלי סוגר מדווח — לא היעלמות שקטה');
  });

  it('שורה ריקה עוצרת הדבקה — שתי פסקאות נפרדות, אין שלד הדבקה', () => {
    const lex = lexDocument(DOC_BLANK_STOP, {});
    const det = tokenizeDetailed(lex.bodyLines, {});
    assert(det.lines.every(l => l.kind !== 'glued'), 'אף שורה לא נבלעה');
    const paras = det.tokens.filter(t => t.type === 'paragraph');
    assertEq(paras.length, 2, 'שתי פסקאות נפרדות');
  });

  it('שורה מבנית שנבלעת — ממצא מפורש glue-consumed-structural-line', () => {
    const model = buildDocumentModel(DOC_STRUCTURAL, {});
    const diags = model.blocks.flatMap(b => (b.diagnostics || []).filter(d => d.code === 'glue-consumed-structural-line'));
    assert(diags.length === 1, 'כותרת שנבלעה מדווחת מפורשות');
    // התוכן לא אבד — הוא בתוך השורה המאוחדת
    const glued = model.blocks.find(b => b.source.glue);
    assert(glued != null, 'קיים בלוק עם קבוצת הדבקה');
    assertEq(glued.source.glue.parts.length, 3, 'שלוש שורות בקבוצה');
  });

  it('very_long (מסמך האמת): 132 הערות-גוף כמו המורשת, round-trip מלא, אין ממצאים פתוחים', () => {
    const vl = fs.readFileSync(path.join(ROOT, 'audits', 'very_long_test_text.txt'), 'utf8');
    const lex = lexDocument(vl, {});
    const det = tokenizeDetailed(lex.bodyLines, {});
    let noteCount = 0;
    for (const t of det.tokens) if (t.type === 'paragraph') noteCount += (t.notes || []).length;
    assertEq(noteCount, 132, 'מספר ההערות אחרי הדבקה = 132 (המורשת משחזרת 132 מסמנים)');
    assertEq(det.lines.filter(l => l.kind === 'glued').length, 5, 'חמש שורות נבלעות בשלוש קבוצות הדבקה');
    const model = buildDocumentModel(vl, {});
    assertEq(reconstructSource(model), vl, 'round-trip תו-לתו של מסמך האמת המלא');
    assert(tokensEqual(tokenize(lex.bodyLines, {}), stripDerived(modelToTokens(model))), 'adapter ≡ tokenize על very_long');
    assertEq((model.notes || []).length, 132, '132 גופי הערות במודל');
    const struct = model.blocks.flatMap(b => (b.diagnostics || []).filter(d => d.code === 'glue-consumed-structural-line'));
    assertEq(struct.length, 0, 'אף שורה מבנית לא נבלעה בפועל');
    const openers = model.blocks.flatMap(b => (b.diagnostics || []).filter(d => d.code === 'unmatched-note-opener'));
    assertEq(openers.length, 0, 'אין פותחים תלויים בפועל');
  });

  it('very_long: דטרמיניזם — parse.contentHash זהה בין שתי בניות', () => {
    const vl = fs.readFileSync(path.join(ROOT, 'audits', 'very_long_test_text.txt'), 'utf8');
    const a = buildDocumentModel(vl, {});
    const b = buildDocumentModel(vl, {});
    assertEq(a.parse.contentHash, b.parse.contentHash, 'contentHash דטרמיניסטי');
    assertEq(a.docId, b.docId, 'docId דטרמיניסטי');
  });

  it('very_long: סדר מרזב ההערות בכל עמוד עוקב אחר סדר הסמנים בגוף (תיקון שורש 9b.4 — אינברסיית עמ\' 834)', () => {
    const MARK_TAG = '\uE102';
    const vl = fs.readFileSync(path.join(ROOT, 'audits', 'very_long_test_text.txt'), 'utf8');
    const r = typeset(vl, getDefaultSettings(), {});
    assert(!r.legacyProfile, 'המנוע המאוחד');
    // מיפוי סמן → מיקום קריאה גלובלי (עמוד, עמודה, שורה) — כמו reconcileNotesAfterPlacement.
    // הערה שסמנה בעמוד מאוחר (פשרת קיבולת מתועדת fn-anchor-compromise) חוקית —
    // הסדר במרזב נמדד בסדר קריאה גלובלי של הסמנים.
    const markerPos = new Map(); // key: tokenId|marker → {page, col, li}
    for (const pg of r.pages) {
      pg.columns.forEach((col, ci) => {
        col.forEach((ln, li) => {
          const tok = ln.tokenId != null ? String(ln.tokenId) : (ln.meta && ln.meta.tokenId != null ? String(ln.meta.tokenId) : null);
          if (!tok) return;
          for (const w of (ln.words || [])) {
            const s = String(w);
            const at = s.indexOf(MARK_TAG);
            if (at < 0) continue;
            const key = `${tok}|${s.slice(at + MARK_TAG.length)}`;
            if (!markerPos.has(key)) markerPos.set(key, { page: pg.index, col: ci, li });
          }
        });
      });
    }
    let inversions = 0, pagesWithNotes = 0, checked = 0;
    const details = [];
    for (const pg of r.pages) {
      const fns = (pg.footnotes || []).filter(n => n.isContinuation !== true && n.mode !== 'split-rest' && n.continuationOf == null);
      if (!fns.length) continue;
      pagesWithNotes++;
      const pos = fns.map(n => {
        const tok = n.tokenId != null ? String(n.tokenId) : (n.anchorId != null ? String(n.anchorId) : null);
        return tok ? markerPos.get(`${tok}|${n.marker}`) || null : null;
      });
      for (let i = 0; i < pos.length; i++) {
        if (!pos[i]) continue;
        for (let j = i + 1; j < pos.length; j++) {
          if (!pos[j]) continue;
          checked++;
          const a = pos[i], b = pos[j];
          const after = a.page > b.page || (a.page === b.page && (a.col > b.col || (a.col === b.col && a.li > b.li)));
          if (after) {
            inversions++;
            if (details.length < 3) details.push({ page: pg.index, a: fns[i].noteId, b: fns[j].noteId, ma: a, mb: b });
          }
        }
      }
    }
    assert(inversions === 0, `אינברסיות סדר סמן↔מרזב: ${inversions} (עמודים עם הערות: ${pagesWithNotes}, זוגות שנבדקו: ${checked}) ${JSON.stringify(details)}`);
    // פשרות קיבולת מתועדות — הערה לפני העוגן חייבת ממצא מפורש (§8 — אין היעלמות שקטה)
    let beforeAnchorNotes = 0, compromises = 0;
    const ledgerIssues = r.ledger && r.ledger.issues ? [...r.ledger.issues.values()] : [];
    for (const pg2 of r.pages) {
      for (const n of (pg2.footnotes || [])) {
        const tok = n.tokenId != null ? String(n.tokenId) : (n.anchorId != null ? String(n.anchorId) : null);
        const mp = tok ? markerPos.get(`${tok}|${n.marker}`) : null;
        if (mp && mp.page > pg2.index) beforeAnchorNotes++;
      }
    }
    compromises = ledgerIssues.filter(x => x.kind === 'fn-anchor-compromise' && x.status === 'persists').length;
    assert(beforeAnchorNotes === compromises, `הערות לפני העוגן (${beforeAnchorNotes}) חייבות פשרת קיבולת מתועדת (${compromises})`);
  });

  it('canonical_corpus: רגרסיה — round-trip ו-adapter ללא שינוי התנהגות (0 קבוצות הדבקה)', () => {
    const cc = fs.readFileSync(path.join(RB, 'tests/fixtures/canonical_corpus.txt'), 'utf8');
    const lex = lexDocument(cc, {});
    const det = tokenizeDetailed(lex.bodyLines, {});
    assertEq(det.lines.filter(l => l.kind === 'glued').length, 0, 'הקנוני אינו מכיל הערות חוצות-שורות');
    const model = buildDocumentModel(cc, {});
    assertEq(reconstructSource(model), cc, 'round-trip תו-לתו');
    assert(tokensEqual(tokenize(lex.bodyLines, {}), stripDerived(modelToTokens(model))), 'adapter ≡ tokenize');
  });

  it('פייפליין מלא: ההערה המודבקת מגיעה לאזורי ההערות פעם אחת; הגוף נושא סמן בלבד (D-30)', () => {
    const r = typeset(DOC_2PART, getDefaultSettings(), {});
    assert(!r.legacyProfile, 'המנוע המאוחד');
    // המאוחד: pg.footnotes = רשומות הערה עם טקסט מלא וזהות (text/noteWords/noteId)
    const fns = r.pages.flatMap(pg => (pg.footnotes || []));
    assertEq(fns.length, 1, 'הערה אחת באזורי ההערות');
    const fn = fns[0];
    assertEq(fn.text, 'ועיין בקצוה"ח ס\' רכז\' סק"א ואולי ובזה יש לשמוע מה שיועיל', 'טקסט ההערה השלם (שתי השורות) במקום הצגתו בפועל — פעם אחת');
    assert(fn.noteId && fn.sourceId, 'זהות: noteId + sourceId');
    // הגוף: פנים ההערה אינו מופיע כטקסט גוף — רק הסמן
    const bodyWords = [];
    for (const pg of r.pages) {
      for (const col of (pg.columns || [])) for (const ln of col) {
        const mk = new Set(ln.markerIdx || []);
        (ln.words || []).forEach((w, i) => { if (!mk.has(i)) bodyWords.push(typeof w === 'object' ? (w.word != null ? w.word : w.t) : w); });
      }
    }
    const bodyText = bodyWords.join(' ');
    assert(!bodyText.includes('ועיין בקצוה"ח'), 'פנים ההערה לא נטפל לגוף');
    assert(bodyText.includes('וכאן ממשיך הגוף'), 'הטקסט שאחרי הסוגר נשאר בגוף');
    // הכותרת שאחרי קבוצת ההדבקה קיימת בפלט (H2 חי בפס חוצה-טורים; מילים כמחרוזות)
    const spanText = r.pages.flatMap(pg => (pg.spanning && pg.spanning.lines) || [])
      .flatMap(ln => (ln.words || []).map(w => (typeof w === 'object' ? (w.word != null ? w.word : w.t) : w))).join(' ');
    const tocText = r.pages.filter(pg => pg.type === 'toc-general' || pg.type === 'toc-detail')
      .flatMap(pg => ((pg.toc && pg.toc.rows) || [])).map(row => row.text || '').join(' ');
    assert(spanText.includes('כותרית') || tocText.includes('כותרית'), 'הכותרת שאחרי קבוצת ההדבקה קיימת בפלט');
  });
});

report();
