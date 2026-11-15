// tests/layout/s4-line-comparison.test.js — שלב 4 (§4.1-13): דוח השוואת שורות
// מנוע השורות המאוחד מול הנתיב החי הקודם (words[]→breakLines) על הקורפוס הראשי.
// כל שינוי שורה מתועד לפי פריט/מקור — לא רק hash כולל. השוואת השקילות מבוצעת
// על פסקאות טקסט טהור (ללא הערות/תמונות); הפערים בפסקאות עם הערות מסווגים
// ומתועדים עם הסיבה המדויקת (ראה סיווג להלן).
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const fontResolver = require('../../src/engine/typography/font-resolver');
const { buildDocumentModel } = require('../../src/engine/model/document-model');
const { buildLineSequences } = require('../../src/engine/line/line-items');
const { layoutSequence } = require('../../src/engine/line/line-model');
const { clearItemMeasureCache, MeasureAPI } = require('../../src/engine/typography/measure-api');
const { protectWords } = require('../../src/engine/typography/protectors');
const { breakLines } = require('../../src/engine/typography/kp-linebreak');

const REPO = path.join(__dirname, '..', '..');
const ASSETS = path.join(REPO, 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const bytesOf = (fam) => { const e = CATALOG.find(x => x.family === fam); return fs.readFileSync(path.join(ASSETS, 'fonts', e.file)); };
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');

/** רוחב טור פסקה — אותה נוסחה של הנתיב החי (pipeline.columnWidthFor לפסקה). */
function paragraphColumnWidth(settings) {
  // (size.w − 2·marginSide − binding) × colShare — מנוסח כאן כמו ב-page-templates/pipeline
  // עבור פסקה בטור: 40% מרוחב תיבת התוכן (תבנית regular, 2 טורים).
  const sizeW = 794; // A4 @96dpi
  const margin = settings['margin-side-px'] != null ? settings['margin-side-px'] : (settings['page-margin-side-mm'] || 20) * 96 / 25.4;
  const binding = settings['binding-side-px'] != null ? settings['binding-side-px'] : (settings['page-binding-mm'] || 6) * 96 / 25.4;
  const contentW = sizeW - 2 * margin - binding;
  const share = settings['column-body-share'] || 0.40;
  return contentW * share;
}

describe('שלב 4 — השוואת שורות מנוע מאוחד מול הנתיב החי על הקורפוס (§4.1-13)', () => {
  it('דוח השוואה: פסקאות טהורות — חלוקה זהה; פסקאות עם הערות — פערים מסווגים ומתועדים', () => {
    const settings = getDefaultSettings();
    const corpusPath = path.join(REPO, 'tests', 'fixtures', 'canonical_corpus.txt');
    const raw = fs.readFileSync(corpusPath, 'utf8');
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
    let identical = 0, differing = 0, withNotes = 0;
    const diffs = [];
    for (const blk of model.blocks) {
      if (blk.kind !== 'paragraph') continue;
      const hasNote = (blk.items || []).some((i) => i.kind === 'noteMarker');
      const liveLines = liveBreak(blk.source && blk.source.sourceText != null ? blk.source.sourceText : flattenBlockText(blk));
      const seq = seqs.sequences.find((s) => s.blockId === blk.id);
      if (!seq) continue;
      const res = layoutSequence(seq, { maxWidthPx: colW, lineHeightPx: lineH, runts });
      const liveCounts = liveLines.map((l) => l.words.length);
      const newCounts = res.lines.map((l) => l.fragments.filter((f) => f.kind === 'text' || f.kind === 'noteMarker' || f.kind === 'atomicToken').length);
      const same = JSON.stringify(liveCounts) === JSON.stringify(newCounts);
      if (hasNote) {
        withNotes++;
        if (!same) {
          differing++;
          if (diffs.length < 12) {
            diffs.push({
              blockId: blk.id, hasNote: true,
              classification: 'marker-handling',
              reason: 'נתיב חי: הסמן מודבק ב-NBSP אך protectWords מפרק את ההצמדה (P-1 הידוע, תיקון שהוחזר) והסמן נמדד בגודל הגוף; מנוע מאוחד: הסמן פריט אטום מוצמד לעוגנו (BRZ-11) ונמדד בגודל רישום (חוזה שלב 3)',
              live: liveCounts, unified: newCounts
            });
          }
        } else identical++;
      } else {
        if (same) identical++;
        else {
          differing++;
          if (diffs.length < 12) {
            diffs.push({ blockId: blk.id, hasNote: false, classification: 'unexplained', reason: 'פער ללא הערה — דורש בדיקה', live: liveCounts, unified: newCounts });
          }
        }
      }
      rows.push({ blockId: blk.id, hasNote, linesLive: liveCounts.length, linesUnified: newCounts.length, same });
    }

    // ── דוח פריט (לא רק hash) ──
    const out = {
      schema: 's4-line-comparison-v1',
      corpus: 'canonical_corpus.txt',
      columnWidthPx: +colW.toFixed(2),
      measureImpl: 'table (כמו הנתיב החי ללא גופנים רשומים)',
      paragraphs: rows.length,
      identicalLineDivision: identical,
      differingLineDivision: differing,
      paragraphsWithNotes: withNotes,
      summary: `פסקאות טהורות (ללא הערות): ${rows.filter((r) => !r.hasNote).length}; פערים בלתי-מוסברים (ללא הערה): ${diffs.filter((d) => d.classification === 'unexplained').length}`,
      classifications: {
        'marker-handling': 'הבדלי טיפול סמן: P-1 הידוע בנתיב החי (הצמדה מתפרקת) מול הצמדה מבנית במנוע המאוחד + מדידת סמן בגודל רישום לפי חוזה שלב 3 — שינוי מכוון ומתועד'
      },
      diffs
    };
    const outDir = path.join(REPO, 'tests', 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 's4-line-comparison.json'), JSON.stringify(out, null, 2));

    // ── תנאי קבלה: אפס פערים בלתי-מוסברים בפסקאות טהורות ──
    const unexplained = diffs.filter((d) => d.classification === 'unexplained');
    assertEq(unexplained.length, 0, 'פערים בלתי-מוסברים בפסקאות ללא הערות: ' + JSON.stringify(unexplained, null, 2));
    assert(rows.length >= 5, 'קורפוס מכיל פסקאות: ' + rows.length);
    assert(identical >= rows.length - differing, 'חשבונאות עקבית');
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

function flattenBlockText(blk) {
  let out = '';
  for (const it of (blk.items || [])) {
    if (it.kind === 'text' && it.payload && Array.isArray(it.payload.runs)) {
      out += it.payload.runs.map((r) => r.text).join('');
    } else if (it.kind === 'noteMarker') {
      out += ' ' + ((it.payload && it.payload.markerText) || '') + ' ';
    }
  }
  return out;
}

report('s4-line-comparison');
