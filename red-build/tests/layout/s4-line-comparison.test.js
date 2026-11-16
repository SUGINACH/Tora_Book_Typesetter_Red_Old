// tests/layout/s4-line-comparison.test.js — שלב 4 (§4.1-13 + §3.1 בהוראת התיקון):
// השוואת שורות מנוע השורות המאוחד מול הנתיב החי (words[]→breakLines) על הקורפוס
// הראשי. **ההשוואה היא על תוכן השורות בפועל** — מערך המילים המדויק בכל שורה,
// סדר המילים, זהות פריטי המקור וטווחי המקור, המפרידים המקוריים (כולל רווחים
// מיוחדים), היעדר כפילויות/השמטות/שינוי סדר, והתאמה מלאה של תוכן הפסקה לפני
// ואחרי השבירה — לא רק ספירת מילים ולא hash כולל.
//
// פסקאות עם הערות: כל הבדל מוסבר באמצעות תוכן ומיפוי מקור אמיתיים — מיקום
// הסמן (noteRef + sourceRange) ועוגנו, והוכחת בידוד: אותה פסקה בלי תיבות
// הסמן נשברת זהה לחלוטין לנתיב החי — כלומר מקור ההבדל היחיד הוא הסמנים.
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const fontResolver = require('../../src/engine/typography/font-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { buildLineSequences } = require('../../src/engine/line/line-items');
const { layoutSequence, reconstructTextOfLines } = require('../../src/engine/line/line-model');
const { clearItemMeasureCache, MeasureAPI } = require('../../src/engine/typography/measure-api');
const { protectWords } = require('../../src/engine/typography/protectors');
const { breakLines } = require('../../src/engine/typography/kp-linebreak');

const REPO = path.join(__dirname, '..', '..');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

/** רוחב טור פסקה — אותה נוסחה של הנתיב החי (pipeline.columnWidthFor לפסקה). */
function paragraphColumnWidth(settings) {
  const sizeW = 794; // A4 @96dpi
  const margin = settings['margin-side-px'] != null ? settings['margin-side-px'] : (settings['page-margin-side-mm'] || 20) * 96 / 25.4;
  const binding = settings['binding-side-px'] != null ? settings['binding-side-px'] : (settings['page-binding-mm'] || 6) * 96 / 25.4;
  const contentW = sizeW - 2 * margin - binding;
  const share = settings['column-body-share'] || 0.40;
  return contentW * share;
}

/** טקסט הפסקה מהמודל (הקנון): הרצות מאוחדות — בלי תרומת סמני ההערה. */
function runsTextOf(blk) {
  let out = '';
  for (const it of (blk.items || [])) {
    if (it.kind === 'text' && it.payload && Array.isArray(it.payload.runs)) {
      out += it.payload.runs.map((r) => r.text).join('');
    }
  }
  return out;
}

/** מילות המקור כפי שהן מונחות בזרימה: תרומת כל פריט טקסט + המפרידים שבין
 * הפריטים (סביב תיבת הסמן) — כך שספירת המילים תואמת את מה שהמנוע מניח. */
function srcWordsAsLaidOut(blk) {
  const parts = (blk.items || []).map((it) => (it.kind === 'text' && it.payload && Array.isArray(it.payload.runs)) ? it.payload.runs.map((r) => r.text).join('') : '');
  return parts.join(' ').split(/\s+/).filter(Boolean);
}

describe('שלב 4 — השוואת שורות מנוע מאוחד מול הנתיב החי על הקורפוס (§4.1-13, §3.1)', () => {
  it('השוואת תוכן מדויקת: מערכי מילים, סדר, מיפוי מקור, מפרידים, שחזור — פסקאות טהורות זהות; הבדלי סמנים מוסברים פר-פריט', () => {
    const settings = getDefaultSettings();
    const corpusPath = path.join(REPO, 'tests', 'fixtures', 'canonical_corpus.txt');
    const raw = fs.readFileSync(corpusPath, 'utf8');
    const rawDoc = raw.replace(/\r\n/g, '\n'); // המסמך הקנוני — טווחי המקור המוחלטים מצביעים אליו
    const colW = paragraphColumnWidth(settings);
    const lineH = settings['body-font-size-pt'] * (96 / 72) * settings['body-line-height'];
    const runts = settings['runt-min-width-pct'];

    // ── הנתיב החי (words[] → breakLines), בדיוק כמו pipeline לפסקה טהורה ──
    const api = new MeasureAPI(settings, 'table');
    const liveBreak = (text) => {
      const words = protectWords(String(text).split(/\s+/).filter(Boolean), (x) => api.measureTextWidth(x), colW);
      return breakLines(words, colW, (t) => api.measureTextWidth(t), lineH, { runts });
    };

    // ── המנוע המאוחד (מודל → מדידה → רצף → KP) ──
    fontResolver.clearFontResolver(); // כמו הנתיב החי בבדיקות — מימוש טבלה
    clearItemMeasureCache();
    const model = buildDocumentModel(raw, {});
    const seqs = buildLineSequences(model, { settings });

    const rows = [];
    const noteHunks = [];
    let pureTotal = 0, pureIdentical = 0, withNotes = 0, notesExplained = 0;
    let sourceMappingRanges = 0, sourceMappingOrdered = true, sepExactAll = true;
    const unexplained = [];

    for (const blk of model.blocks) {
      if (blk.kind !== 'paragraph') continue;
      const hasNote = (blk.items || []).some((i) => i.kind === 'noteMarker');
      const srcText = runsTextOf(blk);
      const srcWords = srcWordsAsLaidOut(blk);
      const liveLines = liveBreak(hasNote ? stripMarkerSpans(blk, rawDoc) : srcText);
      const liveWordsPerLine = liveLines.map((l) => l.words.slice());

      const seq = seqs.sequences.find((s) => s.blockId === blk.id);
      if (!seq) continue;
      const res = layoutSequence(seq, { maxWidthPx: colW, lineHeightPx: lineH, runts });

      // ── תוכן השורות בפועל (המנוע המאוחד): מילים של תיבות הטקסט, בסדר, כולל סמנים כטוקנים מתויגים ──
      const uniWordsPerLine = res.lines.map((ln) => ln.fragments
        .filter((f) => f.kind === 'text' || f.kind === 'noteMarker' || f.kind === 'atomicToken')
        .map((f) => ({
          text: (f.fragments || []).map((x) => x.text).join(''),
          itemId: f.itemId, kind: f.kind,
          sourceRange: f.sourceRange || null,
          noteRef: f.sourceAnchor || null
        })));

      // ── מיפוי מקור (§3.1): טווחים מסודרים, בתוך הבלוק, ללא חפיפה; מכסים את כל המילים ──
      const textRanges = [];
      for (const ln of res.lines) {
        for (const f of ln.fragments) {
          if (f.kind !== 'text') continue;
          const sr = f.sourceRange;
          assert(sr && Number.isFinite(sr.start) && Number.isFinite(sr.end), `${blk.id}: לכל תיבת טקסט sourceRange מוחלט`);
          assert(sr.blockId === blk.id, `${blk.id}: blockId ממולא (${sr.blockId})`);
          assert(sr.start >= blk.sourceRange.start - 1 && sr.end <= blk.sourceRange.end + 1, `${blk.id}: הטווח בתוך הבלוק`);
          textRanges.push(sr);
        }
      }
      sourceMappingRanges += textRanges.length;
      for (let i = 1; i < textRanges.length; i++) {
        if (textRanges[i].start < textRanges[i - 1].start) { sourceMappingOrdered = false; }
      }

      // ── אין כפילויות/השמטות/שינוי סדר בין שורות: רצף הזהויות ייחודי ומלא ──
      const allIds = res.lines.flatMap((l) => l.itemIds);
      assertEq(new Set(allIds).size, allIds.length, `${blk.id}: אין כפילות פריטים בין שורות`);
      const uniTextWords = uniWordsPerLine.flat().filter((w) => w.kind === 'text').map((w) => w.text);
      assertEq(uniTextWords.length, srcWords.length, `${blk.id}: מספר המילים נשמר בדיוק (אין אובדן/כפילות)`);
      for (let i = 0; i < srcWords.length; i++) {
        assertEq(uniTextWords[i], srcWords[i], `${blk.id}: מילה ${i} בסדר המקור (${srcWords[i]} ⇄ ${uniTextWords[i]})`);
      }

      // ── מפרידים מקוריים + שחזור מלא (פסקאות טהורות: השוואת מחרוזת מדויקת) ──
      const recon = reconstructTextOfLines(res.lines);
      if (!hasNote) {
        if (recon !== srcText) sepExactAll = false;
        assertEq(recon, srcText, `${blk.id}: שחזור מדויק ביט-לביט (מפרידים מקוריים נשמרו)`);
      }

      // ── השוואת חלוקת שורות: מערכי המילים בפועל, לא ספירות ──
      const liveStr = liveWordsPerLine.map((w) => w.join(' ')).join(' ⏎ ');
      const uniPure = uniWordsPerLine.map((l) => l.filter((w) => w.kind === 'text').map((w) => w.text).join(' ')).join(' ⏎ ');
      const sameDivision = liveStr === uniPure && liveWordsPerLine.length === uniWordsPerLine.length;

      if (!hasNote) {
        pureTotal++;
        if (sameDivision) pureIdentical++;
        else unexplained.push({ blockId: blk.id, hasNote: false, live: liveWordsPerLine, unified: uniWordsPerLine.map((l) => l.map((w) => w.text)) });
      } else {
        withNotes++;
        // ── הוכחת בידוד (§3.1): אותה פסקה בלי תיבות סמן — חלוקה זהה לנתיב החי ──
        const strippedText = stripMarkerSpans(blk, rawDoc);
        const strippedModel = buildDocumentModel('כותרת 1 - חלק\n' + strippedText + '\n', {});
        const strippedSeqs = buildLineSequences(strippedModel, { settings });
        const strippedSeq = strippedSeqs.sequences.find((s) => s.blockKind === 'paragraph');
        const strippedRes = layoutSequence(strippedSeq, { maxWidthPx: colW, lineHeightPx: lineH, runts });
        const strippedWords = strippedRes.lines.map((ln) => ln.fragments.filter((f) => f.kind === 'text').map((f) => (f.fragments || []).map((x) => x.text).join('')));
        const strippedLive = liveBreak(strippedText).map((l) => l.words.slice());
        const isolated = JSON.stringify(strippedWords) === JSON.stringify(strippedLive);

        // ── הסבר פר-פריט: מיקום כל סמן, עוגנו וטווחי המקור האמיתיים ──
        const markers = [];
        res.lines.forEach((ln, li) => {
          ln.fragments.forEach((f, fi) => {
            if (f.kind !== 'noteMarker') return;
            const anchor = fi > 0 ? ln.fragments[fi - 1] : null;
            markers.push({
              lineIndex: li,
              noteRef: f.sourceAnchor,
              markerText: (f.fragments || []).map((x) => x.text).join(''),
              markerSourceRange: f.sourceRange,
              anchorItemId: anchor ? anchor.itemId : null,
              anchorText: anchor ? (anchor.fragments || []).map((x) => x.text).join('') : null,
              anchorSourceRange: anchor ? anchor.sourceRange : null,
              joinedToAnchor: !!(anchor && anchor.kind === 'text')
            });
          });
        });
        const allJoined = markers.every((m) => m.joinedToAnchor);
        if (isolated && allJoined && markers.length) {
          notesExplained++;
          noteHunks.push({
            blockId: blk.id,
            isolationProof: 'הפסקה ללא תיבות סמן — חלוקה זהה לנתיב החי (מקור ההבדל: הסמנים בלבד)',
            cause: [
              'צמידה מבנית BRZ-11 במנוע המאוחד: הסמן נצמד לעוגן שלפניו (internal glue + forbidden penalty) — בנתיב החי הסמן מילה חופשית (P-1: protectWords מפרק הצמדות)',
              'מדידת סמן בגודל רישון לפי חוזה שלב 3 (fnSize) — בנתיב החי הסמן נמדד בגודל הגוף',
              'תיבת הסמן מוסיפה רוחב לשורת העוגן — מספר השורות עשוי לגדול'
            ].join(' · '),
            markers,
            liveLineCount: liveWordsPerLine.length,
            unifiedLineCount: uniWordsPerLine.length,
            liveWords: liveWordsPerLine,
            unifiedWords: uniWordsPerLine.map((l) => l.map((w) => w.text))
          });
        } else {
          unexplained.push({ blockId: blk.id, hasNote: true, isolated, allJoined, markers, live: liveWordsPerLine, unified: uniWordsPerLine.map((l) => l.map((w) => w.text)) });
        }
      }
      rows.push({
        blockId: blk.id, hasNote,
        linesLive: liveWordsPerLine.length, linesUnified: uniWordsPerLine.length,
        sameDivision, words: srcWords.length
      });
    }

    // ── דוח פריט ומקור (לא רק hash) ──
    const out = {
      schema: 's4-line-comparison-v2',
      corpus: 'canonical_corpus.txt',
      columnWidthPx: +colW.toFixed(2),
      measureImpl: 'table (כמו הנתיב החי ללא גופנים רשומים)',
      comparisonBasis: 'מערכי מילים מדויקים בכל שורה + סדר + מיפוי מקור + מפרידים + שחזור ביט-לביט',
      paragraphs: rows.length,
      pure: { total: pureTotal, identicalLineDivision: pureIdentical, wordArraysExact: pureIdentical === pureTotal },
      withNotes: { total: withNotes, explained: notesExplained, unexplained: unexplained.length },
      sourceMapping: { textRanges: sourceMappingRanges, ordered: sourceMappingOrdered, withinBlock: true },
      separators: { exactReconstructionPure: sepExactAll },
      perParagraph: rows,
      noteHunks
    };
    const outDir = path.join(REPO, 'tests', 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 's4-line-comparison.json'), JSON.stringify(out, null, 2));

    // ── תנאי קבלה ──
    assert(rows.length >= 5, 'קורפוס מכיל פסקאות: ' + rows.length);
    assertEq(unexplained.length, 0, 'פערים בלתי-מוסברים: ' + JSON.stringify(unexplained, null, 2));
    assertEq(pureIdentical, pureTotal, `פסקאות טהורות — חלוקת שורות ומערכי מילים זהים לחלוטין (${pureIdentical}/${pureTotal})`);
    assert(sourceMappingOrdered, 'טווחי המקור מסודרים בכל הפסקאות');
    assert(sepExactAll, 'שחזור ביט-לביט (מפרידים מקוריים) בכל הפסקאות הטהורות');
    assertEq(notesExplained, withNotes, `כל פסקאות ההערות מוסברות (${notesExplained}/${withNotes})`);
    assert(noteHunks.every((h) => h.markers.every((m) => m.joinedToAnchor && m.noteRef && m.markerSourceRange && m.anchorSourceRange)), 'לכל סמן: noteRef, טווח מקור ועוגן אמיתיים');
  });
  it('שקילות מדידה: מילה מודדת אותו רוחב בשני המסלולים (טבלה, ללא גופנים רשומים)', () => {
    fontResolver.clearFontResolver();
    clearItemMeasureCache();
    const settings = getDefaultSettings();
    const api = new MeasureAPI(settings, 'table');
    const model = buildDocumentModel('כותרת 1 - חלק\nבדיקת שקילות מדידה בין שני המסלולים על מילים עבריות רגילות.\n', {});
    const seqs = buildLineSequences(model, { settings });
    const para = seqs.sequences.find((s) => s.blockKind === 'paragraph');
    let checked = 0, maxDev = 0;
    for (const it of para.items) {
      if (it.role !== 'box' || it.kind !== 'text') continue;
      const text = (it.fragments || []).map((f) => f.text).join('');
      const live = api.measureTextWidth(text, settings['body-font-size-pt'], 0);
      maxDev = Math.max(maxDev, Math.abs(live - it.measuredAdvance));
      checked++;
    }
    assert(checked >= 4, 'נבדקו מילים: ' + checked);
    assert(maxDev < 1e-9, `סטיית מדידה מקסימלית ${maxDev}`);
  });
});

/** הסרת תיבות הסמנים מהפסקה — להוכחת הבידוד (אותן מילים, בלי תיבות סמן).
 * השורה הגולמית נלקחת מהמסמך הקנוני לפי הטווח המוחלט של הבלוק; תווית הסמן
 * [ ... ] (בטווח של פריט הסמן) מוסרת ומשאירה רווח יחיד — כמו שהנתיב החי רואה. */
function stripMarkerSpans(blk, rawDoc) {
  const spans = (blk.items || []).filter((i) => i.kind === 'noteMarker').map((i) => i.sourceRange).sort((a, b) => a.start - b.start);
  const lineText = rawDoc.slice(blk.sourceRange.start, blk.sourceRange.end);
  if (!spans.length) return lineText;
  const base = blk.sourceRange.start;
  let out = '', cursor = 0;
  for (const sp of spans) {
    const s = Math.max(0, sp.start - base), e = Math.max(0, sp.end - base);
    out += lineText.slice(cursor, s);
    cursor = Math.min(lineText.length, e);
    // רווח משני צדי הסמן — נשמר אחד בלבד (כמו בנתיב החי שמפרק על רווחים)
    if (out.length && !out.endsWith(' ')) out += ' ';
  }
  out += lineText.slice(cursor);
  return out.replace(/\s+/g, ' ').trim();
}

report('s4-line-comparison');
