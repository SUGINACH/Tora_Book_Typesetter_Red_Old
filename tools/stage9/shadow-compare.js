#!/usr/bin/env node
// tools/stage9/shadow-compare.js — השוואת צללים legacy ↔ מאוחד (שלב 9b, גרסה 5)
//
// גרסה 5 (9b.1) — תיקון הפגמים המתודולוגיים שנמצאו בגרסה 4 (הוראת 9b §2):
//   §2.1 מלאי הערות מהמבנים הסמנטיים בלבד — לא ספירת אזורים (legacy), לא
//        מזהי יחידים (unified) ולא סוגריים גולמיים (מקור). שלושת המלאיים
//        נבנים בנפרד ומושווים בזהויות מלאות.
//   §2.2 השוואת טקסט דו-כיוונית נפרדת + זיהוי החלפות טקסט/עוגן/סמן/סדר.
//   §2.3 איסוף מלא של כל משטחי התוכן בשני המנועים — כולל spanning.lines (פס
//        חוצה-טורים — כאן נמצאות כותרות H3–H6), gateLines, bands, שערים,
//        TOC כללי ומפורט, הערות-צד, הערות-גוף והמשכיהן, עמודי endnotes —
//        וכן בדיקת r.pageModel (המודל הקנוני שלב 8) מול r.pages.
//   §2.4 מלאי המקור נבנה מהדקדוק הקנוני (dfa-lexer + block-tokenizer) עם מזהי
//        טוקן יציבים; בנפרד נמדד פער הדקדוק מול דקדוק הייחוס (המורשת) —
//        שער G9 ידוע.
//   §2.5 TOC כללי ומפורט נמדדים בנפרד מול D-107 (כללי 1–6, מפורט 2–6, H7 מוסתר).
//   §2.6 כל ירידה/עודף מסווג לפי מקור מוגדר; רשימות היתר נגזרות מהדקדוק
//        ומהמבנים הסמנטיים — לא כללי רוחב.
//   §2.7 רשימת שערים אחת (GATES) — המספרים בדוח Markdown וב-JSON נגזרים
//        מאותו אובייקט תוצאות. אין מספרים כתובים ידנית.
//
// שימוש: node tools/stage9/shadow-compare.js [קובץ] [--json out.json] [--md out.md] [--dp-defaults]
//   ברירת מחדל: red-build/tests/fixtures/canonical_corpus.txt
//   מסמך ראשי:  audits/very_long_test_text.txt
'use strict';

const fs = require('fs');
const path = require('path');

process.env.RED_ENABLE_STRETCH_RECLAIM = process.env.RED_ENABLE_STRETCH_RECLAIM || '1';
process.env.RED_RECLAIM_COMPRESS_MAX = process.env.RED_RECLAIM_COMPRESS_MAX || '20';

const ROOT = path.resolve(__dirname, '..', '..');
const RB = path.join(ROOT, 'red-build');

const core = require('./compare-core');
const { normWords, normText, multiset, mDiff, sumDrops, fmtDrops, gateSummary } = core;

const { lexDocument } = require(path.join(RB, 'src/engine/parser/dfa-lexer'));
const { tokenizeDetailed } = require(path.join(RB, 'src/engine/parser/block-tokenizer'));
const { importImudSettings } = require(path.join(RB, 'src/engine/core/legacy-settings-map'));
const { getSettingDefs, getDefaultSettings } = require(path.join(RB, 'src/engine/core/settings-registry'));
const { registerFont } = require(path.join(RB, 'src/engine/typography/measure-api'));
const { typeset } = require(path.join(RB, 'src/engine/core/pipeline'));
const { buildShaarBlocks } = require(path.join(RB, 'src/engine/output/shaar-content'));

// ---------- §2.7: רשימת השערים — מקור יחיד לספירה ולדוח ----------
const GATES = [
  { id: 'G1-legacy-covers-source', group: 'כיסוי', desc: 'כל מילות התוכן של המקור (פרסור קנוני) מרונדרות במורשת; ירידות מסווגות בלבד' },
  { id: 'G2-unified-covers-source', group: 'כיסוי', desc: 'כל מילות התוכן של המקור מרונדרות במאוחד; ירידות מסווגות בלבד' },
  { id: 'G3-no-phantom-legacy', group: 'רפאים', desc: 'עודפי המורשת על המקור מוסברים (סמנים/ריהוט/כפילות TOC מתועדות)' },
  { id: 'G3-no-phantom-unified', group: 'רפאים', desc: 'עודפי המאוחד על המקור מוסברים' },
  { id: 'G4-note-bodies', group: 'הערות-גוף', desc: 'גוף הערות (טקסט מלא אחרי שחזור) זהה בין המנועים — שני הכיוונים בנפרד' },
  { id: 'G5-note-identity-unified', group: 'הערות-גוף', desc: 'זהות: כל הערת מקור ← רשומה אחת במאוחד (noteId/sourceId); בלי חסרים/כפילויות/חסרי-מקור' },
  { id: 'G5-note-identity-legacy', group: 'הערות-גוף', desc: 'זהות: כל הערת מקור ← הערה אחת במורשת (שחזור מסמנים); בלי חסרים/כפילויות' },
  { id: 'G6-toc-general-unified', group: 'TOC', desc: 'D-107: TOC כללי במאוחד = רמות 1–6 מהמקור, ללא H7, בלי כפילויות/השמטות' },
  { id: 'G6-toc-detail-unified', group: 'TOC', desc: 'D-107: TOC מפורט במאוחד = רמות 2–6, בלי H1 ובלי H7' },
  { id: 'G7-side-identity-unified', group: 'ביאורי-צד', desc: 'זהות H7: כל טוקן H7 ← פריט אחד; ownToken≠anchorToken; טקסט שלם; אין הצבה לפני עוגן' },
  { id: 'G7-side-parity', group: 'ביאורי-צד', desc: 'מלאי ביאורי-הצד (מילים ומספרים) שווה בין המנועים — שני הכיוונים' },
  { id: 'G8-pagemodel-parity', group: 'מודל', desc: 'r.pageModel (הקנוני של שלב 8) מייצג את אותו תוכן כמו r.pages במאוחד' },
  { id: 'G9-heading-grammar-parity', group: 'דקדוק', desc: 'טוקני הכותרות של הפרסור הקנוני = סיווג הכותרות של דקדוק הייחוס (המורשת)' },
];
const GATE_BY_ID = new Map(GATES.map(g => [g.id, g]));

// ---------- הגדרות וגופנים ----------
function registerAllFonts() {
  const FONTS = [
    ['Guttman Rashi', 'Guttman-Rashi-Normal.ttf'], ['Frank Ruhl Libre', 'FrankRuhlLibre-VF.ttf'],
    ['Alpha', 'Alpha-Regular.ttf'], ['AlphaBlack', 'Alpha-Black.ttf'], ['AlphaLight', 'Alpha-Light.ttf'],
    ['Lia Sgula', 'Sgula-Regular.ttf'], ['Livorna', 'Livorna-Regular.ttf'], ['FrankReal', 'FrankReal-Regular.ttf'],
    ['David Libre', 'DavidLibre-Regular.ttf'], ['Hadassah Friedlaender', 'Hadassah-Friedlaender.ttf']
  ];
  for (const [fam, file] of FONTS) {
    const fp = path.join(RB, 'ui/assets/imud/fonts', file);
    if (fs.existsSync(fp)) { const r = registerFont(fam, fs.readFileSync(fp)); if (!r.ok) console.error(`registerFont(${fam}): ${r.error}`); }
  }
}
function rawImudDefaults() {
  return JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
}
function legacySettings() {
  const legacy = rawImudDefaults();
  const families = new Set();
  for (const cat of ['imud-fonts.json', 'fonts-extended.json']) {
    const p = path.join(RB, 'ui/assets/imud', cat);
    if (fs.existsSync(p)) for (const f of JSON.parse(fs.readFileSync(p, 'utf8'))) families.add(f.family);
  }
  const imp = importImudSettings(legacy, new Set(getSettingDefs().map(r => r.id)), { availableFonts: families });
  return { ...getDefaultSettings(), ...imp.settings, 'body-font': 'Guttman Rashi', 'measure-impl': 'font-metrics' };
}

// ---------- §2.4: מלאי המקור — מהדקדוק הקנוני, עם מזהים יציבים ----------
function sourceInventory(text) {
  const raw = rawImudDefaults();
  const fnOpen = String(raw['fn-delim-open'] || '[');
  const fnClose = String(raw['fn-delim-close'] || ']');
  const endnotePrefix = String(raw['en-line-prefix'] != null ? raw['en-line-prefix'] : 'הערת סיום -');

  // **9b.4 — תקציב הממרה הטיפוגרפית של המורשת (stripEditorialNotes):** המורשת
  // מסירה editorials, מצמצמת ריצות רווחים ומצמידה סימני פיסוק למילה הקודמת
  // (`\s+([,.:;!?]) → $1`) על הטקסט כולו לפני הפרוק לשורות. המאוחד מציג את
  // המקור כפי שהוא. התקציב = הפרש הצורות בין הטקסט הגולמי לטקסט הממורר
  // (בדיוק הממרה של המקור, פרובננס: legacy-imud-flow.stripEditorialNotes):
  // צורות מחוברות = עודפי מורשת; צורות המקור = ירידות מורשת. כל צורה נגזרת
  // מהמקור עצמו — מילת תוכן שתיעלם באמת תישאר unexplained (בדיקת שלילה).
  const joinTransform = (s) => String(s)
    .replace(/##[\s\S]*?##/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.:;!?])/g, '$1');
  const wordsRaw = normWords(text);
  const wordsJoined = normWords(joinTransform(text));
  const joinExcess = mDiff(multiset(wordsRaw), multiset(wordsJoined)); // צורות מחוברות — עודפי מורשת
  const joinDrops = mDiff(multiset(wordsJoined), multiset(wordsRaw));  // צורות מקור — ירידות מורשת
  const mapOfDrops = (drops) => drops.reduce((m, x) => { m.set(x.w, (m.get(x.w) || 0) + x.miss); return m; }, new Map());

  // **9b.4 — תקציב הנרמול החד-כיווני (Z.ai fix, block-tokenizer.normalizeStage):**
  // הפרסור הקנוני ממיר ״→׳ ו-''→" (כלל one-way מתועד); המורשת מרנדרת את
  // הצורה הגולמית. לכל מילת מקור שמכילה תו כזה: הצורה המנורמלת = ירידת
  // מורשת; הצורה הגולמית = עודף מורשת. נגזר מהמקור מילה-מילה.
  const quoteNormDrops = new Map(), quoteNormExcess = new Map();
  for (const w of wordsRaw) {
    const norm = w.replace(/\u05F4/g, '\u05F3').replace(/[\u2018\u2019]/g, '"');
    if (norm !== w) {
      quoteNormDrops.set(norm, (quoteNormDrops.get(norm) || 0) + 1);
      quoteNormExcess.set(w, (quoteNormExcess.get(w) || 0) + 1);
    }
  }

  const lexed = lexDocument(text, { endnotePrefix });
  const det = tokenizeDetailed(lexed.bodyLines, { fnOpen, fnClose, endnotePrefix });

  const headings = [];   // כותרות (H0–H6) עם מזהה טוקן יציב
  const sideSources = [];// טוקני H7 → מקור ביאור-צד
  const notes = [];      // הערות-גוף מהחלקים הסמנטיים (note-ref) — לא Regex
  const endnotes = [];   // הערות-סיום גלויות
  let nextParaByH7 = new Map(); // ownToken → מזהה הפסקה המארחת הצפויה (הפסקה הבאה)
  const tokens = det.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading') {
      if (t.level === 7) {
        let host = null;
        for (let j = i + 1; j < tokens.length; j++) { if (tokens[j].type === 'paragraph') { host = tokens[j].id; break; } }
        sideSources.push({ key: `h7:${t.id}`, ownToken: t.id, hostToken: host, text: normText(t.text), words: normWords(t.text), order: sideSources.length });
      } else {
        headings.push({ key: `h:${t.id}`, tokenId: t.id, level: t.level, text: normText(t.text), num: t.num != null ? t.num : null, fromKotaret: /^כותרת/.test(String(t.raw || '').trim()) });
      }
    } else if (t.type === 'paragraph') {
      for (const p of (t.parts || [])) {
        if (p.kind === 'note-ref') {
          notes.push({ key: `note:${t.id}#${p.noteIndex}`, sourceId: String(t.id), noteIndex: p.noteIndex, text: normText(t.notes[p.noteIndex]), words: normWords(t.notes[p.noteIndex]), order: notes.length });
        }
      }
    } else if (t.type === 'endnote') {
      endnotes.push({ key: `end:${t.id}`, tokenId: t.id, num: t.num != null ? t.num : null, text: normText(t.text) });
    }
  }

  // **9b.4 — תקציב מפריד צבירת H7 של המורשת:** שתי כותרות 7 רצופות (בלי פסקה
  // ביניהן — טוקנים שאינם פסקה, לרבות כותרות אחרות והערות-סיום, אינם מפרידים
  // אצל המורשת: pendingSideNote ממתין לפסקה) מתמזגות אצלה לביאור-צד אחד עם
  // מפריד "—" (tokenizeDoc: pendingSideNote + ' — ' + txt); המאוחד שומר על
  // זהות פר-טוקן (9b.3 — כל טוקן H7 ← פריט אחד). N כותרות 7 ברצף ⇒ N−1
  // מפרידים לעודפי המורשת.
  let h7AccumulationPairs = 0;
  let h7Run = 0;
  for (const t of det.tokens) {
    if (t.type === 'paragraph') { h7Run = 0; continue; }
    if (t.type === 'heading' && t.level === 7) {
      h7Run++;
      if (h7Run > 1) h7AccumulationPairs++;
    }
  }

  // תוכן צפוי: טקסטי כותרות + חלקי טקסט של פסקאות + גוף הערות + ביאורי-צד + הערות-סיום.
  // (הוראות הדקדוק — "כותרת N -", תוחמים, קידומות — אינן תוכן ואינן נספרות כאן.)
  const contentWords = [];
  for (const h of headings) contentWords.push(...normWords(h.text));
  for (const s of sideSources) contentWords.push(...s.words);
  for (const n of notes) contentWords.push(...n.words);
  for (const e of endnotes) contentWords.push(...normWords(e.text));
  for (const t of tokens) {
    if (t.type !== 'paragraph') continue;
    for (const p of (t.parts || [])) if (p.kind === 'text') contentWords.push(...normWords(p.value));
  }

  // §2.4/§G9: סיווג כותרות לפי דקדוק הייחוס (המורשת) — מדידת פער הדקדוקים.
  const REF_HEADING_RE = /^כותרת\s*(\d+)(?:\s+מספר\s+(\d+))?.*?[-–—]\s*(.*)$/;
  // **9b.4:** הדקדוק הקנוני מזהה את הציטוט כקבוצה שלמה לפני המקף (HEADING_RE);
  // דקדוק הייחוס חותך במקף הראשון — גם כשהוא *בתוך* הציטוט.
  const CANON_CITATION_RE = /^(כותרת\s*([0-7])(?:\s+מספר\s+(\d+))?((?:\s*\([^)]*\))*)|חלק\s+([א-ת]+)|הקדמה)\s*[-–—]\s*(.+)$/;
  const refHeadings = [];
  let refKotaretCount = 0;
  const h7InstructionWords = []; // מילים שדקדוק הייחוס צורך משורות H7 ("כותרת 7 מספר 2", "(מקור: ...)")
  const citationWords = [];      // מילים מציטוטי (מקור: …) — נצרכות ע"י דקדוק הייחוס, נשמרות סמנטית במאוחד לאחר 9b.3
  // **9b.4 — תקציב דליפת הציטוט של המורשת:** כשהמקף הראשון בשורה נמצא בתוך
  // קבוצת הציטוט (למשל "כותרת 7 (מקור – רשויות, 7 – 804) - טקסט"), דקדוק
  // הייחוס מדליף את שארית הציטוט לטקסט הביאור. הדקדוק הקנוני מזהה את הציטוט
  // כולו (9b.3, §6.3 — נצרם מהרינדור כמו הייחוס ונשמר לפרובננס). התקציב
  // נגזר שורה-שורה: הקידומת המדויקת שהודלפה = טקסט הייחוס בלי הסיומת
  // הקנונית. מילת תוכן אמיתית שתחסר במאוחד לא תיכנס לכאן — ותישאר unexplained.
  const citationLeakWords = [];
  let citationLeakLines = 0;
  let citationLeakUnfitted = 0; // שורות שבהן הטקסטים שונים אך אין יחס סיומת — חייבות בדיקה ידנית
  for (const line of lexed.bodyLines) {
    const m = String(line).trim().match(REF_HEADING_RE);
    if (!m) continue;
    const lvl = Number(m[1]);
    refKotaretCount++;
    const rest = String(line).trim().slice(m[0].length - (m[3] ? m[3].length : 0));
    refHeadings.push({ level: lvl, text: normText(m[3] || ''), num: m[2] ? Number(m[2]) : null });
    // קידומת ההוראה שדקדוק הייחוס צורך — לכל רמה (לא רק H7): "כותרת N", "מספר M",
    // ציטוטים לפני המקף, ומקף ההפרדה עצמו. המאוחד מציג את הטקסט שאחרי המקף בלבד.
    {
      const full = String(line).trim();
      const dashAt = full.indexOf(' - ') >= 0 ? full.indexOf(' - ') : full.search(/[-–—]/);
      const prefix = dashAt > 0 ? full.slice(0, dashAt) : full;
      h7InstructionWords.push(...normWords(prefix.replace(/\(מקור[^)]*\)/g, ' ')), '-');
      const cit = prefix.match(/\(מקור[^)]*\)/);
      if (cit) citationWords.push(...normWords(cit[0]));
    }
    // דליפת הציטוט: הטקסט הקנוני שונה מטקסט הייחוס רק כשהמקף הראשון בתוך הציטוט
    {
      const full = String(line).trim();
      const mc = full.match(CANON_CITATION_RE);
      if (mc && mc[6] != null) {
        const canonTxt = mc[6];
        const refTxt = m[3] != null ? m[3] : '';
        if (refTxt !== canonTxt) {
          if (refTxt.endsWith(canonTxt) && canonTxt.length > 0) {
            citationLeakLines++;
            // **9b.4:** הקידומת שהודלפה — כפי שהמורשת מרנדרת אותה (אחרי הממרה
            // שלה: הצמדת פיסוק) — כך שצורות כמו "7," מסווגות מהמקור המדויק.
            citationLeakWords.push(...normWords(refTxt.slice(0, refTxt.length - canonTxt.length).replace(/\s+([,.:;!?])/g, '$1')));
          } else {
            citationLeakUnfitted++;
          }
        }
      }
    }
  }

  // תקציבי סיווג (§2.6) — נגזרים מהדקדוק ומהמבנים, לא כללי רוחב:
  const GRAMMAR_WORDS = ['כותרת', 'מספר', 'סימן', 'הקדמה', 'הערת', 'סיום', 'הערות', 'ביאור', '-', '–', '—', ':', 'חלק'];
  const META_KEYS = ['ספר', 'מחבר', 'נושא', 'מהדורא', 'פרטי', 'שם', 'הספר', 'המחבר', 'נושאים', 'מפורט', 'ושנת', 'מקום', 'הוצאה', 'לאור', 'שמירת', 'זכויות', 'הפקר', 'רשויות', 'חצירות', 'תחומין', 'הקדמה'];
  // ריהוט גוף שמרנדרת המורשת מעבר לתוכן הסמנטי (התנהגות ייחוס מתועדת):
  // (א) שורות מטא גולמיות — המורשת מרנדרת כגוף; המאוחד מחלץ למטא (F-9a-1, טיפול 9b.5);
  // (ב) קידומות הערת-סיום ממוספרות ("הערת סיום-1 - ") — המורשת מרנדרת כגוף;
  //     המאוחד צורך לפי D-40 (עוגן סמן — פריט קישור, לא תוכן).
  const refMetaLineWords = [];
  for (const ml of (lexed.metadataLines || [])) refMetaLineWords.push(...normWords(ml.raw || ''));
  const refEndnotePrefixWords = [];
  for (const line of lexed.bodyLines) {
    const m = String(line).match(/^הערת\s*סיום\s*[-–—]?\s*\d+\s*[-–—]\s*(.+)$/);
    if (m) refEndnotePrefixWords.push(...normWords(String(line).slice(0, String(line).length - m[1].length)));
    // "הקדמה - X": המאוחד — כותרת h0 (המילול נצרך); המורשת — טקסט גוף מילולי (הבדל מתועד)
    if (/^הקדמה\s*[-–—]/.test(String(line).trim())) refEndnotePrefixWords.push(...normWords('הקדמה -'));
  }
  const budgets = core.buildBudgets({
    grammarWords: GRAMMAR_WORDS,
    metaKeys: META_KEYS,
    metaValues: Object.values(lexed.metadata || {}).flatMap(v => normWords(v)),
    h7InstructionWords,
    citationWords,
  });

  return {
    headings, sideSources, notes, endnotes, metadata: lexed.metadata || {},
    contentMultiset: multiset(contentWords),
    contentWordCount: contentWords.length,
    refHeadings, budgets, refKotaretCount,
    canonicalKotaretCount: headings.filter(h => h.fromKotaret).length + sideSources.length,
    // **9b.4:** תקציב דליפת הציטוט של דקדוק הייחוס (מדויק, שורה-שורה)
    citationLeak: { words: multiset(citationLeakWords), lines: citationLeakLines, unfitted: citationLeakUnfitted },
    // **9b.4:** תקציב הממרה הטיפוגרפית של המורשת (stripEditorialNotes)
    legacyJoin: { excess: mapOfDrops(joinExcess), drops: mapOfDrops(joinDrops) },
    // **9b.4:** נרמול גרשיים/מרכאות חד-כיווני (Z.ai fix) — המאוחד מנרמל, המורשת גולמי
    quoteNorm: { drops: quoteNormDrops, excess: quoteNormExcess },
    // **9b.4:** מפריד צבירת H7 רצופים במורשת (זהות פר-טוקן במאוחד)
    h7Accumulation: { pairs: h7AccumulationPairs, dashExcess: new Map([['—', h7AccumulationPairs]]) },
    refLegacyBodyBudgets: {
      metaLines: multiset(refMetaLineWords),
      endnotePrefixes: multiset(refEndnotePrefixWords),
    },
    counts: { headings: headings.length, h7: sideSources.length, notes: notes.length, endnotes: endnotes.length, refHeadings: refHeadings.length },
  };
}

// ---------- §2.3: מלאי מלא מתוצאת מורשת ----------
function legacyInventory(r, settings) {
  const all = [];
  const fnAreas = [];       // אזורי הערה (לשחזור זהויות)
  const sideNotes = [];     // ביאורי-צד {text, page, order}
  const tocGeneralRows = [], tocDetailRows = [];
  const endWords = [];
  let pages = 0;
  for (const pg of r.pages) {
    pages++;
    const isTocGen = pg.type === 'toc-general';
    const isTocDet = pg.type === 'toc-detail';
    if (isTocGen || isTocDet) {
      for (const row of ((pg.toc && pg.toc.rows) || [])) {
        const rows = row.kind === 'group' ? (row.items || []) : [row];
        for (const e of rows) {
          const rec = { level: e.level, text: normText(e.text), targetPage: e.targetPage != null ? e.targetPage : null };
          (isTocGen ? tocGeneralRows : tocDetailRows).push(rec);
          for (const nw of normWords(e.text)) all.push(nw); // TOC = תוכן מוצג
        }
      }
    }
    // פס חוצה-טורים — כותרות H3–H6 חיות כאן במורשת? (המורשת מרנדרת בעמודות; נאסף ליתר ביטחון)
    if (pg.spanning && pg.spanning.lines) {
      for (const ln of pg.spanning.lines) {
        const ws = (ln.words || []).map(w => (w && typeof w === 'object' ? w.t : w));
        for (const nw of normWords(ws.join(' '))) all.push(nw);
      }
    }
    for (const col of (pg.columns || [])) {
      for (const ln of col) {
        const mk = new Set(ln.markerIdx || []);
        for (const w of (ln.windowWords || [])) for (const nw of normWords(w)) all.push(nw);
        (ln.words || []).forEach((w, i) => {
          const t = w && typeof w === 'object' ? w.t : w;
          if (mk.has(i)) return; // סמן — מנוע יודע שהוא סמן; אינו תוכן
          for (const nw of normWords(t)) all.push(nw);
          if (/^endnotes/.test(pg.type || '')) for (const nw of normWords(t)) endWords.push(nw);
        });
      }
    }
    for (const gl of (pg.gateLines || [])) for (const nw of normWords(gl && gl.text)) all.push(nw);
    for (const b of (pg.bands || [])) for (const nw of normWords(b && b.text)) all.push(nw);
    if (/^shaar/.test(pg.type || '')) {
      const model = buildShaarBlocks(pg, settings, r.metadata || {});
      for (const b of ((model && model.blocks) || [])) for (const nw of normWords(b && b.text)) all.push(nw);
    }
    for (const fnArea of (pg.footnotes || [])) {
      fnAreas.push({ page: pg.index, lines: fnArea.lines || [] });
      for (const ln of (fnArea.lines || [])) for (const w of (ln.words || [])) {
        const t = w && typeof w === 'object' ? w.t : w;
        if (w && typeof w === 'object' && w.mk) continue;
        for (const nw of normWords(t)) { all.push(nw); }
      }
    }
    for (const mn of (pg.marginNotes || [])) {
      const txt = mn.lines ? mn.lines.map(l => l.text || '').join(' ') : (mn.text || '');
      sideNotes.push({ text: normText(txt), page: pg.index, order: sideNotes.length });
      for (const nw of normWords(txt)) all.push(nw);
    }
  }
  // שחזור הערות מסמנים (§2.1) — כל סמן פותח הערה; המשכים מצטרפים
  const rec = core.reconstructLegacyNotes(fnAreas);
  const legNotes = rec.notes.map(n => ({
    key: null, marker: n.marker, text: n.text, words: normWords(n.text),
    page: n.page, order: n.order, kind: 'body',
  }));
  return {
    all, pages, fnAreas: fnAreas.length, notes: legNotes,
    noteOrphans: rec.orphans, continuationFragments: rec.continuationFragments,
    sideNotes, sideWords: sideNotes.reduce((n, s) => n + normWords(s.text).length, 0),
    tocGeneralRows, tocDetailRows, endWords,
  };
}

// ---------- §2.3: מלאי מלא מתוצאה מאוחדת (כולל PageModel) ----------
function unifiedInventory(r) {
  const all = [];
  const notes = [];         // רשומות הערה כפי שהוצבו
  const sideNotes = [];     // פריטי עוגן (הערות-צד/תיבות)
  const tocGeneralRows = [], tocDetailRows = [];
  const endWords = [];
  let pages = 0;
  const pushWords = (txt) => { for (const nw of normWords(txt)) all.push(nw); };
  for (const pg of r.pages) {
    pages++;
    // פס חוצה-טורים — כאן מרונדרות כותרות H3–H6 במאוחד (תיקון עיוורון גרסה 4)
    if (pg.spanning && pg.spanning.lines) {
      for (const ln of pg.spanning.lines) pushWords((ln.words || []).join(' '));
    }
    for (const col of (pg.columns || [])) {
      for (const ln of col) {
        const ws = (ln.words || []).map(w => (w && typeof w === 'object' ? w.t : w));
        pushWords(ws.join(' '));
      }
    }
    for (const gl of (pg.gateLines || [])) pushWords(gl && gl.text);
    for (const b of (pg.bands || [])) pushWords(b && b.text);
    if (pg.shaarLayout) for (const b of (pg.shaarLayout.blocks || [])) pushWords(b && b.text);
    if (pg.type === 'toc-general' || pg.type === 'toc-detail') {
      for (const row of ((pg.toc && pg.toc.rows) || [])) {
        const rows = row.kind === 'group' ? (row.items || []) : [row];
        for (const e of rows) {
          const rec = { level: e.level, text: normText(e.text), targetPage: e.targetPage != null ? e.targetPage : null, anchorId: e.anchorId || null, label: e.label != null ? String(e.label) : null };
          (pg.type === 'toc-general' ? tocGeneralRows : tocDetailRows).push(rec);
          pushWords([e.text, e.label || ''].filter(Boolean).join(' ')); // כפי שמוקרן בפועל: טקסט+תווית גיליון
        }
      }
    }
    for (const fn of (pg.footnotes || [])) {
      const isCont = fn.isContinuation === true || fn.mode === 'split-rest' || fn.continuationOf != null;
      notes.push({
        key: fn.noteId != null ? String(fn.noteId) : null,
        sourceId: fn.tokenId != null ? String(fn.tokenId) : (fn.sourceId != null ? String(fn.sourceId) : null),
        anchorId: fn.anchorId != null ? String(fn.anchorId) : null,
        marker: fn.marker != null ? String(fn.marker) : null,
        kind: isCont ? 'continuation' : 'body',
        continuationOf: fn.continuationOf != null ? String(fn.continuationOf) : null,
        wordRange: fn.wordRange || null,
        text: normText(fn.text), words: normWords(fn.text),
        page: pg.index, order: notes.length,
      });
      pushWords(fn.text); // הסמן נספר בעוגן שבגוף (D-30) — שם כבר נכלל בשורות העמודות; המרזב תורם טקסט בלבד
    }
    for (const sn of (pg.sideNotes || [])) {
      const txt = sn && sn.text != null ? sn.text : (sn.lines || []).map(l => l.text || '').join(' ');
      sideNotes.push({
        key: sn.noteId != null ? String(sn.noteId) : null,
        ownToken: sn.ownToken != null ? String(sn.ownToken) : null,
        anchorToken: sn.anchorToken != null ? String(sn.anchorToken) : null,
        text: normText(txt), words: normWords(txt),
        page: pg.index, order: sideNotes.length,
      });
      pushWords(txt);
    }
  }
  const enInfo = r.endnotePagesInfo || {};
  for (const p of (enInfo.pages || [])) for (const n of (p.notes || [])) { for (const w of normWords(n.text)) endWords.push(w); pushWords(n.text); }

  // ---- PageModel (הקנוני של שלב 8): אותו תוכן? ----
  // שורות הערות-צד/תיבות (kind side-note/info-box) מוקרנות גם ב-mp.lines (area=margin)
  // וגם נישאות ב-mp.sideNotes — כדי לא לספור פעמיים אוספים את הטקסט מהרשומות בלבד.
  const NON_BODY_LINE_KINDS = new Set(['side-note', 'info-box']);
  const pmWords = [];
  const pmNotes = [];
  const pmSide = [];
  if (r.pageModel && r.pageModel.pages) {
    for (const mp of r.pageModel.pages) {
      for (const l of (mp.lines || [])) {
        if (NON_BODY_LINE_KINDS.has(l.kind)) continue; // נאסף דרך mp.sideNotes
        const ws = (l.words || []).map(w => (w && typeof w === 'object' ? (w.text != null ? w.text : w) : w));
        for (const nw of normWords(ws.join(' '))) pmWords.push(nw);
      }
      for (const fn of (mp.footnotes || [])) {
        pmNotes.push({ key: fn.noteId != null ? String(fn.noteId) : null, text: normText(fn.text), words: normWords(fn.text) });
        for (const nw of normWords(fn.text)) pmWords.push(nw); // טקסט בלבד — הסמן בעוגן שבגוף (D-30)
      }
      for (const sn of (mp.sideNotes || [])) {
        pmSide.push({ text: normText(sn.text), words: normWords(sn.text) });
        for (const nw of normWords(sn.text)) pmWords.push(nw);
      }
    }
  }
  return {
    all, pages, notes, sideNotes, sideWords: sideNotes.reduce((n, s) => n + s.words.length, 0),
    tocGeneralRows, tocDetailRows, endWords, endNoteCount: (enInfo.pages || []).reduce((n, p) => n + ((p.notes || []).length), 0),
    pageModel: { present: !!(r.pageModel && r.pageModel.pages), words: pmWords, notes: pmNotes, side: pmSide },
  };
}

// ---------- main ----------
(function main() {
  const argv = process.argv.slice(2);
  const jsonOutIdx = argv.indexOf('--json');
  const jsonOut = jsonOutIdx > -1 ? argv[jsonOutIdx + 1] : null;
  const mdIdx = argv.indexOf('--md');
  const mdOut = mdIdx > -1 ? argv[mdIdx + 1] : null;
  const fileArg = argv.find(a => !a.startsWith('--') && a !== jsonOut && a !== mdOut);
  const file = fileArg || path.join(RB, 'tests/fixtures/canonical_corpus.txt');
  const text = fs.readFileSync(file, 'utf8');
  const label = path.relative(ROOT, file).replace(/\\/g, '/');
  const unifiedProfile = argv.includes('--dp-defaults') ? 'dp-defaults' : 'imud-cutover';

  const results = {};
  const pass = (id, detail) => { results[id] = { ok: true, detail }; console.log(`✓ [${id}] ${detail}`); };
  const fail = (id, detail) => { results[id] = { ok: false, detail }; console.log(`✗ [${id}] ${detail}`); };

  registerAllFonts();

  const src = sourceInventory(text);
  console.log(`מקור: ${label}`);
  console.log(`  כותרות (H0–H6): ${src.counts.headings} | H7: ${src.counts.h7} | הערות-גוף (סמנטי): ${src.counts.notes} | הערות-סיום: ${src.counts.endnotes} | כותרות לפי דקדוק הייחוס: ${src.counts.refHeadings}`);
  console.log(`  מילות תוכן צפויות: ${src.contentWordCount.toLocaleString()}`);

  const legSettings = legacySettings();
  const tL = Date.now();
  const legacyRes = typeset(text, legSettings, {});
  if (!legacyRes.legacyProfile) { console.error('הרצת המורשת לא הופעלה'); process.exit(2); }
  const leg = legacyInventory(legacyRes, legSettings);
  console.log(`מורשת: ${leg.pages} עמודים (${Date.now() - tL}ms) | מילים: ${leg.all.length.toLocaleString()} | הערות (שוחזרו מסמנים): ${leg.notes.length} | אזורים: ${leg.fnAreas} | המשכים: ${leg.continuationFragments} | ביאורי-צד: ${leg.sideNotes.length}`);

  const uniSettings = argv.includes('--dp-defaults')
    ? { ...getDefaultSettings(), 'measure-impl': 'font-metrics' }
    : (() => { const s2 = { ...legacySettings() }; delete s2['_layout-profile']; delete s2['_imudRaw']; return s2; })();
  const tU = Date.now();
  const uniRes = typeset(text, uniSettings, {});
  if (uniRes.legacyProfile) { console.error('ההרצה המאוחדת נפלה למורשת'); process.exit(2); }
  const uni = unifiedInventory(uniRes);
  console.log(`מאוחד (${unifiedProfile}): ${uni.pages} עמודים (${Date.now() - tU}ms) | מילים: ${uni.all.length.toLocaleString()} | הערות: ${uni.notes.length} | ביאורי-צד: ${uni.sideNotes.length} | PageModel: ${uni.pageModel.present ? 'כן' : 'לא'}`);

  const legM = multiset(leg.all);
  const uniM = multiset(uni.all);
  const srcM = src.contentMultiset;

  // --- G1/G2: כיסוי מקור (ירידות מסווגות בלבד; unexplained = כשל) ---
  for (const [engineId, engineM, engineName, isLegacyEngine] of [['G1-legacy-covers-source', legM, 'המורשת', true], ['G2-unified-covers-source', uniM, 'המאוחד', false]]) {
    const drops = mDiff(engineM, srcM);
    const cls = core.classifyDrops(drops, src.budgets);
    let unexplained = cls.unexplained;
    // **9b.4:** הממרה הטיפוגרפית של המורשת — צורות המקור ("מילה" + ",") נעלמות
    // אצלה לטובת הצורה המחוברת; תקציב מדויק מהמקור (stripEditorialNotes).
    let joinClassified = 0;
    if (isLegacyEngine && unexplained.length) {
      const cls2 = core.classifyByBudget(unexplained, src.legacyJoin.drops);
      joinClassified = cls2.classified.reduce((n, x) => n + x.miss, 0);
      unexplained = cls2.unexplained;
    }
    // **9b.4:** הנרמול החד-כיווני (Z.ai fix) — המקור הקנוני מנרמל ״→׳; המורשת
    // מרנדרת את הצורה הגולמית ⇒ הצורה המנורמלת חסרה אצל המורשת.
    if (isLegacyEngine && unexplained.length) {
      const cls3 = core.classifyByBudget(unexplained, src.quoteNorm.drops);
      joinClassified += cls3.classified.reduce((n, x) => n + x.miss, 0);
      unexplained = cls3.unexplained;
    }
    const classifiedCount = sumDrops(drops) - sumDrops(unexplained);
    if (!unexplained.length) {
      pass(engineId, `כיסוי מלא; ${sumDrops(drops)} מילים ירידה מסווגות (דקדוק ${classifiedCount} מילים בתקציבים מוגדרים${isLegacyEngine && joinClassified ? `, ${joinClassified} מהממרה הטיפוגרפית של המקור (stripEditorialNotes)` : ''})`);
    } else {
      fail(engineId, `${engineName}: ירידות בלתי-מוסברות — ${sumDrops(unexplained)} מילים: ${fmtDrops(unexplained)}`);
    }
  }

  // --- G3: אין רפאים (עודפים מוסברים; סיווג לפי מקור מוגדר) ---
  const markerVocab = (inv) => { const m = new Map(); for (const n of inv.notes) if (n.marker) m.set(n.marker, (m.get(n.marker) || 0) + 1); return m; };
  const tocTextMultiset = (rows) => multiset(rows.flatMap(r => normWords(r.text)));
  const headingTextMultiset = multiset(src.headings.flatMap(h => normWords(h.text)));
  const sideTextMultiset = multiset(src.sideSources.flatMap(s => s.words));
  const furniture = new Set(['בס״ד', 'הערות', 'המשך', '(המשך)']);
  {
    const raw = rawImudDefaults();
    for (const k of ['imud-book-title', 'imud-book-subtitle', 'imud-book-desc', 'imud-book-sections', 'imud-book-author', 'imud-book-year', 'shaar-back-text', 'inp-book-back-copyright', 'inp-book-back-publishing', 'inp-book-back-contact', 'inp-book-back-extra', 'inp-book-title', 'inp-book-subtitle', 'inp-book-desc', 'inp-book-sections', 'inp-book-author', 'inp-book-year']) {
      const v = raw[k] != null ? raw[k] : legSettings[k];
      if (typeof v === 'string' && v.trim()) for (const w of normWords(v)) furniture.add(w);
    }
    for (const w of normWords('כל הזכויות שמורות למחבר.')) furniture.add(w);
    for (const w of normWords('תוכן העניינים תוכן העניינים המפורט')) furniture.add(w);
  }
  for (const [engineId, engineM, inv, engineName, tocGen, tocDet, isLegacy] of [
    ['G3-no-phantom-legacy', legM, leg, 'המורשת', leg.tocGeneralRows, leg.tocDetailRows, true],
    ['G3-no-phantom-unified', uniM, uni, 'המאוחד', uni.tocGeneralRows, uni.tocDetailRows, false],
  ]) {
    const excess = mDiff(srcM, engineM);
    // סיווג: סמני מספור (מנוע יודע), ריהוט שער מהגדרות, כפילות TOC/כותרות (מתועדת), מספרים (מספור שורות/גיליון)
    const markers = markerVocab(inv);
    const tocDup = multiset([...normWords('תוכן העניינים'), ...tocGen.flatMap(r => normWords(r.text)), ...tocDet.flatMap(r => normWords(r.text))]);
    const tocLabels = multiset([...tocGen.flatMap(r => normWords(r.label || '')), ...tocDet.flatMap(r => normWords(r.label || ''))]);
    const headDup = headingTextMultiset;
    const sideDup = sideTextMultiset; // ביאורי-צד מופיעים גם כפריטי שוליים וגם... (לא כפילות גוף) — משמש לסיווג עודפי טקסט-עוגן
    const refMeta = isLegacy ? src.refLegacyBodyBudgets.metaLines : new Map();
    const refEndPrefix = isLegacy ? src.refLegacyBodyBudgets.endnotePrefixes : new Map();
    // **9b.4:** דליפת הציטוט של דקדוק הייחוס (המורשת) — המקף הראשון בתוך הציטוט
    // מדליף את שאריתו לטקסט הביאור/הכותרת; תקציב מדויק שורה-שורה מהמקור.
    // וכן צורות הפיסוק המחוברות של הממרה שלה (עודפים) — עותקים פרטיים לשער.
    const citationLeak = isLegacy ? new Map(src.citationLeak.words) : new Map();
    const joinExcessMap = isLegacy ? new Map(src.legacyJoin.excess) : new Map();
    const quoteNormExcessMap = isLegacy ? new Map(src.quoteNorm.excess) : new Map();
    const h7DashMap = isLegacy ? new Map(src.h7Accumulation.dashExcess) : new Map();
    // המורשת מייצרת מספור "סימן <גימטריה>" אוטומטי לכותרות H2/H3 (בגוף וב-TOC) —
    // ריהוט מנוע עם מקור מוגדר: הקידומות בפועל בפלט שלה עצמה (עמדה ראשונה בשורת כותרת/רשומה).
    const simanBudget = new Map();
    if (isLegacy) {
      const bump = (w) => simanBudget.set(w, (simanBudget.get(w) || 0) + 1);
      const scanPrefix = (txt) => {
        const mm = String(txt || '').match(/^\s*סימן\s+([א-ת]+)(\s|$)/);
        if (mm) { bump('סימן'); bump(mm[1]); }
      };
      for (const r of [...tocGen, ...tocDet]) scanPrefix(r.text);
      for (const pg of legacyRes.pages) {
        for (const b of (pg.bands || [])) scanPrefix(b && b.text);
        for (const gl of (pg.gateLines || [])) scanPrefix(gl && gl.text);
        if (pg.spanning && pg.spanning.lines) for (const ln of pg.spanning.lines) scanPrefix((ln.words || []).join(' '));
      }
    }
    // כפילות כותרת-שער-המשנה (מתועדת מגרסה 4): החלק (H1) מוצג גם בשער-המשנה וגם
    // כשורת כותרת/TOC — העותק בשער מדוד מהמודל של המנוע עצמו (buildShaarBlocks SSOT).
    const gateTitleBudget = new Map();
    {
      const bumpWords = (txt) => { for (const w of normWords(txt)) gateTitleBudget.set(w, (gateTitleBudget.get(w) || 0) + 1); };
      const pages = isLegacy ? legacyRes.pages : uniRes.pages;
      for (const pg of pages) {
        if ((pg.type || '') !== 'shaar-sub') continue;
        if (isLegacy) {
          const model = buildShaarBlocks(pg, legSettings, legacyRes.metadata || {});
          for (const b of ((model && model.blocks) || [])) if (b && b.text) bumpWords(b.text);
        } else if (pg.shaarLayout) {
          for (const b of (pg.shaarLayout.blocks || [])) if (b && b.text) bumpWords(b.text);
        }
      }
    }
    // המאוחד צורך ערכי מטא בתיבות השער (buildShaarBlocks: settings || meta) —
    // רק ערכים שבאמת מגיעים מהמסמך (כשההגדרה ריקה) נכנסים לתקציב (§6.1 — סמנטיקה מאושרת).
    // **9b.5:** גם ארבעת מקטעי השער האחורי (D-107) — זכויות/הוצאה/קשר/נוספים.
    const gateMetaBudget = new Map();
    if (!isLegacy) {
      const SHAAR_FIELDS = [
        ['imud-book-title', 'שם הספר'], ['imud-book-subtitle', 'נושא'], ['imud-book-desc', 'נושא מפורט'],
        ['imud-book-sections', 'פרטי מהדורא'], ['imud-book-author', 'שם המחבר'], ['imud-book-year', 'מקום ושנת הוצאה'],
        ['imud-book-back-copyright', 'שמירת זכויות'], ['imud-book-back-publishing', 'פרטי הוצאה לאור'],
        ['imud-book-back-contact', 'פרטי קשר'], ['imud-book-back-extra', 'פרטים נוספים'],
      ];
      for (const [setKey, metaKey] of SHAAR_FIELDS) {
        const fromSettings = uniSettings[setKey] != null && String(uniSettings[setKey]).trim() !== '';
        if (!fromSettings && src.metadata[metaKey]) {
          for (const w of normWords(src.metadata[metaKey])) gateMetaBudget.set(w, (gateMetaBudget.get(w) || 0) + 1);
        }
      }
      if (src.metadata['שמירת זכויות'] && !(uniSettings['shaar-back-text'] != null && String(uniSettings['shaar-back-text']).trim() !== '')) {
        for (const w of normWords(src.metadata['שמירת זכויות'])) gateMetaBudget.set(w, (gateMetaBudget.get(w) || 0) + 1);
      }
    }
    const unexplained = [];
    for (const d of excess) {
      let n = 0;
      const take = (m) => { const have = (m && m.get(d.w)) || 0; const t = Math.min(have, d.miss - n); if (t > 0) m.set(d.w, have - t); n += t; };
      if (markers.has(d.w)) { const t = Math.min(markers.get(d.w), d.miss); markers.set(d.w, markers.get(d.w) - t); n += t; }
      if (n < d.miss && furniture.has(d.w)) n = d.miss;
      if (n < d.miss) take(tocDup);
      if (n < d.miss) take(tocLabels);
      if (n < d.miss) take(headDup);
      if (n < d.miss && /^\d+$/.test(d.w)) n = d.miss; // מספרי שורות/גיליון/סימוכין גימטריה ספרתי
      if (n < d.miss) take(sideDup);
      if (n < d.miss) take(refMeta);       // המורשת: שורות מטא גולמיות כגוף (F-9a-1 מתועד; טיפול 9b.5)
      if (n < d.miss) take(refEndPrefix);  // המורשת: קידומות הערות-סיום ממוספרות כגוף (D-40: המאוחד צורך — עוגן, לא תוכן)
      if (n < d.miss) take(citationLeak);  // המורשת: דליפת ציטוט-מקף-פנימי לטקסט (9b.3/9b.4 מתועד)
      if (n < d.miss) take(joinExcessMap);  // המורשת: צורות פיסוק מחוברות (stripEditorialNotes, 9b.4)
      if (n < d.miss) take(quoteNormExcessMap); // המורשת: צורות גרשיים גולמיות (Z.ai fix, 9b.4)
      if (n < d.miss) take(h7DashMap);     // המורשת: מפריד צבירת H7 רצופים (9b.4)
      if (n < d.miss) take(simanBudget);   // המורשת: מספור סימן אוטומטי (ריהוט מנוע)
      if (n < d.miss) take(gateMetaBudget); // המאוחד: ערכי מטא בתיבות השער (צריכה לגיטימית §6.1)
      if (n < d.miss) take(gateTitleBudget); // שני המנועים: כפילות כותרת-החלק בשער-המשנה (מתועד)
      if (n < d.miss) unexplained.push({ ...d, miss: d.miss - n });
    }
    if (!unexplained.length) pass(engineId, `נקי — כל העודפים מסווגים (סמנים, ריהוט, כפילות TOC/כותרות, מספור${isLegacy ? ', ריהוט גוף של דקדוק הייחוס: מטא+קידומות הערות-סיום' : ''})`);
    else fail(engineId, `${engineName}: עודפים בלתי-מוסברים — ${sumDrops(unexplained)} מילים: ${fmtDrops(unexplained)}`);
  }

  // --- G4: גוף הערות — השוואה מלאה בין המנועים (שני הכיוונים בנפרד, §2.2) ---
  {
    const d = core.diffNoteSets(leg.notes, uni.notes.map(n => ({ ...n, key: n.key })));
    const missInUni = sumDrops(d.wordDiffAtoB);
    const missInLeg = sumDrops(d.wordDiffBtoA);
    const problems = [];
    if (missInUni) problems.push(`חסר במאוחד ${missInUni} מילים: ${fmtDrops(d.wordDiffAtoB, 8)}`);
    if (missInLeg) problems.push(`חסר במורשת ${missInLeg} מילים: ${fmtDrops(d.wordDiffBtoA, 8)}`);
    if (d.textMoved.length) problems.push(`החלפות טקסט בין זהויות: ${d.textMoved.length}`);
    if (d.orderInversions.length) problems.push(`אינברסיות סדר: ${d.orderInversions.length}`);
    if (!problems.length) pass('G4-note-bodies', `גוף הערות זהה — ${d.countA} הערות מורשת = ${d.countB} רשומות מאוחד; מילים שוות בשני הכיוונים`);
    else fail('G4-note-bodies', problems.join(' | '));
  }

  // --- G5: זהות הערות מול המקור ---
  {
    // מאוחד: מפתח זהות = sourceId#noteIndex — נגזר מ-noteId (footnote|sourceId|noteIndex)
    const srcKeys = new Map(src.notes.map(n => [n.key, n]));
    const uniByKey = new Map();
    for (const n of uni.notes) {
      let kk = null;
      if (n.key && n.key.startsWith('footnote|')) {
        const parts = n.key.split('|');
        if (parts.length >= 3) kk = `note:${parts[1]}#${parts[2]}`;
      } else if (n.sourceId != null) {
        kk = `note:${n.sourceId}#${n.key ? n.key.split('#')[1] : ''}`;
      }
      if (kk) uniByKey.set(kk, (uniByKey.get(kk) || 0) + 1);
    }
    let missing = 0, extra = 0, dup = 0;
    for (const k of srcKeys.keys()) { const c = uniByKey.get(k) || 0; if (c === 0) missing++; else if (c > 1) dup++; }
    for (const k of uniByKey.keys()) if (!srcKeys.has(k)) extra++;
    const sourceless = uni.notes.filter(n => !n.key && !n.sourceId).length;
    const contNoSrc = uni.notes.filter(n => n.kind === 'continuation' && !n.continuationOf).length;
    if (!missing && !extra && !dup && !sourceless && !contNoSrc) pass('G5-note-identity-unified', `${srcKeys.size} הערות מקור ← ${uniByKey.size} רשומות; זהות מלאה (noteId↔sourceId), בלי חסרים/כפילויות/חסרי-מקור`);
    else fail('G5-note-identity-unified', `חסרות: ${missing}, חסרות-מקור: ${extra}, כפילויות: ${dup}, רשומות בלי זהות: ${sourceless}, המשכים בלי מקור: ${contNoSrc}`);
  }
  {
    // מורשת: התאמה לפי טקסט בסדר הופעה (אין מזהי מקור במורשת — מתועד)
    const d = core.matchNoteSets(src.notes, leg.notes);
    const unmatchedSrc = d.onlyInA.length;
    const unmatchedLeg = d.onlyInB.length;
    if (!unmatchedSrc && !unmatchedLeg && !leg.noteOrphans.length) pass('G5-note-identity-legacy', `${src.notes.length} הערות מקור ← ${leg.notes.length} הערות מורשת (שוחזרו מסמנים); התאמה מלאה`);
    else fail('G5-note-identity-legacy', `הערות מקור בלי הערה במורשת: ${unmatchedSrc} (${d.onlyInA.slice(0, 4).map(x => `"${x.text.slice(0, 30)}"`).join(', ')}); הערות מורשת בלי מקור: ${unmatchedLeg}; מילים יתומות: ${leg.noteOrphans.length}`);
  }

  // --- G6: TOC לפי D-107 (מאוחד) ---
  {
    const expGen = core.tocExpectation(src.headings, { minLevel: 1, maxLevel: 6 });
    const dGen = core.diffToc(expGen, uni.tocGeneralRows);
    if (!dGen.missing.length && !dGen.extra.length && !dGen.duplicates.length) pass('G6-toc-general-unified', `D-107 כללי: ${dGen.actualCount} רשומות, רמות 1–6, ללא H7 — התאמה מלאה`);
    else fail('G6-toc-general-unified', `D-107 כללי: צפוי ${dGen.expectedCount}, בפועל ${dGen.actualCount}; חסרות ${dGen.missing.length} (רמות חסרות: ${[...new Set(dGen.missing.map(m => m.level))].join(',') || '-'}); עודפות ${dGen.extra.length}; כפילויות ${dGen.duplicates.length}`);
  }
  {
    const expDet = core.tocExpectation(src.headings, { minLevel: 2, maxLevel: 6 });
    const dDet = core.diffToc(expDet, uni.tocDetailRows);
    const h1InDetail = uni.tocDetailRows.filter(r => r.level === 1).length;
    const h7InDetail = uni.tocDetailRows.filter(r => r.level === 7).length;
    if (!dDet.missing.length && !dDet.extra.length && !dDet.duplicates.length && !h1InDetail && !h7InDetail) pass('G6-toc-detail-unified', `D-107 מפורט: ${dDet.actualCount} רשומות, רמות 2–6 — התאמה מלאה`);
    else fail('G6-toc-detail-unified', `D-107 מפורט: צפוי ${dDet.expectedCount}, בפועל ${dDet.actualCount}; חסרות ${dDet.missing.length}; עודפות ${dDet.extra.length}; H1 במפורט: ${h1InDetail}; H7 במפורט: ${h7InDetail}`);
  }

  // --- G7: ביאורי-צד ---
  {
    // זהות H7 במאוחד: ownToken מכסה כל טוקן H7 פעם אחת; טקסט שלם; לא לפני עוגן
    const placed = (uniRes.sideNotes && uniRes.sideNotes.placed) || [];
    const deferred = (uniRes.sideNotes && uniRes.sideNotes.deferred) || [];
    const ownCounts = new Map();
    for (const p of placed) { const k = String(p.ownToken); ownCounts.set(k, (ownCounts.get(k) || 0) + 1); }
    const srcH7 = new Map(src.sideSources.map(s => [String(s.ownToken), s]));
    let missing = 0, multi = 0, textMismatch = 0, beforeAnchor = 0, noHost = 0;
    const firstPageByToken = new Map();
    for (const pg of uniRes.pages) {
      const pageLinesList = [...(pg.spanning ? pg.spanning.lines : []), ...(pg.columns || []).flat()];
      for (const ln of pageLinesList) {
        const tok = ln.tokenId != null ? String(ln.tokenId) : (ln.meta && ln.meta.tokenId != null ? String(ln.meta.tokenId) : null);
        if (tok != null && !firstPageByToken.has(tok)) firstPageByToken.set(tok, pg.index);
      }
    }
    for (const [k, s] of srcH7) {
      const c = ownCounts.get(k) || 0;
      if (c === 0) missing++;
      else if (c > 1) multi++;
      if (s.hostToken == null) noHost++;
      const items = placed.filter(p => String(p.ownToken) === k);
      for (const it of items) {
        if (normText(it.text) !== s.text) textMismatch++;
        const anchorPage = firstPageByToken.get(String(it.anchorToken));
        if (anchorPage != null && it.page < anchorPage) beforeAnchor++;
      }
    }
    const sourceless = placed.filter(p => p.ownToken == null || !srcH7.has(String(p.ownToken))).length;
    if (!missing && !multi && !textMismatch && !beforeAnchor && !sourceless && !noHost) pass('G7-side-identity-unified', `${srcH7.size} טוקני H7 ← ${placed.length} פריטים; ownToken ייחודי, טקסט שלם, אין הצבה לפני עוגן (דחויים: ${deferred.length})`);
    else fail('G7-side-identity-unified', `חסרים: ${missing}, כפילויות ownToken: ${multi}, טקסט שונה: ${textMismatch}, לפני עוגן: ${beforeAnchor}, חסרי-מקור: ${sourceless}, בלי מארח צפוי: ${noHost} (מתוך ${srcH7.size} מקור H7; דחויים: ${deferred.length})`);
  }
  {
    // parity ביאורי-צד בין המנועים — מילים ומספרים, שני כיוונים.
    // **9b.4 (§2.6):** הירידות במאוחד מסווגות אך ורק מול תקציב דליפת הציטוט
    // המדויק (שורה-שורה מהמקור): כשהמקף הראשון בשורת H7 נמצא *בתוך* קבוצת
    // הציטוט (למשל "כותרת 7 (מקור – רשויות, 7 – 804) - טקסט"), דקדוק הייחוס
    // (המורשת) חותך באותו מקף ומדליף את שארית הציטוט לטקסט הביאור; הדקדוק
    // הקנוני מזהה את הציטוט כולו כהוראה ואינו מרנדר אותו (9b.3, §6.3 — נשמר
    // לפרובננס). מילת תוכן אמיתית שחסרה במאוחד תישאר unexplained ותכשיל
    // את השער (בדיקת שלילה ב-s9b-shadow-compare.test.js).
    const d = core.diffNoteSets(
      leg.sideNotes.map(s => ({ ...s, kind: 'side' })),
      uni.sideNotes.map(s => ({ ...s, kind: 'side', key: s.key || (s.ownToken != null ? `side:${s.ownToken}` : null) })),
    );
    const missInUni = sumDrops(d.wordDiffAtoB);
    const missInLeg = sumDrops(d.wordDiffBtoA);
    // **9b.4:** סיווג דו-כיווני: (א) חסר במאוחד = דליפת ציטוט (מקף פנימי —
    // דקדוק הייחוס מדליף את שארית הציטוט לטקסט הביאור; הקנוני מזהה את הציטוט
    // כולו כהוראה, 9b.3/§6.3) + צורות פיסוק מחוברות של הממרה של המורשת;
    // (ב) חסר במורשת = צורות המקור שהממרה שלה חיברה (אצל המאוחד הן נשארות
    // כפי שהן). מילת תוכן אמיתית שחסרה תישאר unexplained (בדיקת שלילה).
    const cls = core.classifyByBudget(d.wordDiffAtoB, src.citationLeak.words);
    let unexplainedUni = cls.unexplained;
    let leakClassified = cls.classified.reduce((n, x) => n + x.miss, 0);
    if (unexplainedUni.length) {
      const cls2 = core.classifyByBudget(unexplainedUni, src.legacyJoin.excess);
      leakClassified += cls2.classified.reduce((n, x) => n + x.miss, 0);
      unexplainedUni = cls2.unexplained;
    }
    if (unexplainedUni.length) {
      const cls2b = core.classifyByBudget(unexplainedUni, src.quoteNorm.excess);
      leakClassified += cls2b.classified.reduce((n, x) => n + x.miss, 0);
      unexplainedUni = cls2b.unexplained;
    }
    if (unexplainedUni.length) {
      const cls2c = core.classifyByBudget(unexplainedUni, src.h7Accumulation.dashExcess);
      leakClassified += cls2c.classified.reduce((n, x) => n + x.miss, 0);
      unexplainedUni = cls2c.unexplained;
    }
    const clsLeg = core.classifyByBudget(d.wordDiffBtoA, src.legacyJoin.drops);
    let unexplainedLeg = clsLeg.unexplained;
    if (unexplainedLeg.length) {
      const clsL2 = core.classifyByBudget(unexplainedLeg, src.quoteNorm.drops);
      unexplainedLeg = clsL2.unexplained;
    }
    const unfitted = src.citationLeak.unfitted;
    if (!unexplainedUni.length && !unexplainedLeg.length && !unfitted) pass('G7-side-parity', `ביאורי-צד: ${leg.sideNotes.length} מורשת = ${uni.sideNotes.length} מאוחד; מילים שוות בשני הכיוונים לאחר סיווג מסווג (${leakClassified} מילים: דליפת-ציטוט ${src.citationLeak.lines} שורות מקף-פנימי §6.3 + הצמדת פיסוק של הממרה של המקור)`);
    else {
      const problems = [];
      if (unexplainedUni.length) problems.push(`חסר במאוחד (בלתי-מוסבר) ${sumDrops(unexplainedUni)} — ${fmtDrops(unexplainedUni, 6)}`);
      if (unexplainedLeg.length) problems.push(`חסר במורשת (בלתי-מוסבר) ${sumDrops(unexplainedLeg)} — ${fmtDrops(unexplainedLeg, 6)}`);
      if (unfitted) problems.push(`שורות ציטוט-מקף-פנימי ללא יחס סיומת: ${unfitted} — דורש בדיקה`);
      fail('G7-side-parity', `ביאורי-צד (מילים, לא מספר ביאורים): ${problems.join(' | ')} | ספירה: מורשת ${leg.sideNotes.length} (sideWords=${leg.sideWords}), מאוחד ${uni.sideNotes.length} (sideWords=${uni.sideWords})`);
    }
  }

  // --- G8: PageModel מייצג את אותו תוכן ---
  {
    if (!uni.pageModel.present) fail('G8-pagemodel-parity', 'r.pageModel חסר בתוצאה המאוחדת');
    else {
      const pmM = multiset(uni.pageModel.words);
      const invM = multiset(uni.all);
      const diffA = mDiff(pmM, invM); // במודל, לא באינוונטר
      const diffB = mDiff(invM, pmM); // באינוונטר, לא במודל
      if (!sumDrops(diffA) && !sumDrops(diffB)) pass('G8-pagemodel-parity', `PageModel מייצג את מלוא התוכן (${uni.pageModel.words.length.toLocaleString()} מילים = האינוונטר)`);
      else fail('G8-pagemodel-parity', `PageModel≠מלאי: חסר במודל ${sumDrops(diffA)} מילים (${fmtDrops(diffA, 6)}); חסר במלאי ${sumDrops(diffB)} (${fmtDrops(diffB, 6)})`);
    }
  }

  // --- G9: פער דקדוק הכותרות (קנוני מול ייחוס) ---
  {
    // מדידה על שורות "כותרת N …" בלבד — הצורות "הקדמה -/חלק -" הן הרחבות מתועדות של הקנוני
    // (המורשת מרנדרת אותן כגוף; המאוחד — כותרות h0/h1) ואינן חלק מפער הדקדוק.
    const canonH = src.canonicalKotaretCount;
    const refH = src.refKotaretCount;
    if (canonH === refH) pass('G9-heading-grammar-parity', `דקדוק הכותרות תואם: ${canonH} שורות כותרת מסווגות זהות בשני הדקדוקים`);
    else fail('G9-heading-grammar-parity', `פער דקדוק: הפרסור הקנוני מזהה ${canonH} שורות כותרת ככותרות, דקדוק הייחוס ${refH}; הפער ${refH - canonH} שורות (צורות "מספר N"/"(מקור: …)" לפני המקף) שנכנסות כפסקאות גוף — שורש F-9a-3/F-9a-5 (טיפול בפרוסה 9b.3)`);
  }

  // ---------- §2.7: דוח — הכל נגזר מאותו אובייקט ----------
  const summary = gateSummary(GATES, results);
  const out = {
    tool: 'stage9-shadow-compare', schema: 5, file: label, unifiedProfile,
    started: new Date().toISOString(),
    summary: { total: summary.total, passed: summary.passed, failed: summary.failed, ok: summary.ok },
    gates: Object.fromEntries(GATES.map(g => [g.id, { group: g.group, desc: g.desc, ...(results[g.id] || { ok: false, detail: 'לא הוגדרה תוצאה' }) }])),
    measured: {
      source: {
        contentWords: src.contentWordCount,
        headings: src.counts.headings, h7: src.counts.h7,
        notes: src.counts.notes, endnotes: src.counts.endnotes,
        refGrammarHeadings: src.counts.refHeadings,
        metadata: src.metadata,
      },
      legacy: {
        pages: leg.pages, words: leg.all.length,
        notes: leg.notes.length, fnAreas: leg.fnAreas, continuationFragments: leg.continuationFragments,
        sideNotes: leg.sideNotes.length, sideWords: leg.sideWords,
        tocGeneralRows: leg.tocGeneralRows.length, tocDetailRows: leg.tocDetailRows.length,
        endWords: leg.endWords.length,
      },
      unified: {
        pages: uni.pages, words: uni.all.length,
        notes: uni.notes.length, sideNotes: uni.sideNotes.length, sideWords: uni.sideWords,
        tocGeneralRows: uni.tocGeneralRows.length, tocDetailRows: uni.tocDetailRows.length,
        endNotePages: uni.endNoteCount, pageModelPresent: uni.pageModel.present,
      },
    },
    documented: {
      'המשכי הערות במורשת': 'אזור הערה שלא נפתח בסמן ממשיך את ההערה הקודמת (חיתוך עמוד); "(המשך)" הוא ריהוט ואינו נספר כתוכן',
      'sideWords': 'מספר מילים בביאורי הצד — אינו מספר הביאורים (תיקון ניסוח גרסה 4 שכינתה פער מילים "ביאורים חסרים")',
      'TOC במורשת': `כללי ${leg.tocGeneralRows.length} רשומות (רמות ${[...new Set(leg.tocGeneralRows.map(r => r.level))].sort().join(',') || '-'}), מפורט ${leg.tocDetailRows.length} — נמדד לעומת D-107 במאוחד בלבד; המורשת היא ייחוס התנהגות, לא יעד ההחלטה`,
      'הערות-גוף במורשת': 'המורשת מזרימה הערות במצב continuous — כמה הערות באזור אחת, מופרדות בסמנים; השחזור ב-compare-core.reconstructLegacyNotes',
    },
  };

  const jsonPath = jsonOut || path.join(ROOT, 'audits', `STAGE9_SHADOW_${path.basename(file).replace(/\.[^.]+$/, '')}_${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  // דוח Markdown — מופק מאותו אובייקט (§2.7): שום מספר לא נכתב ידנית
  const md = renderMarkdown(out);
  const mdPath = mdOut || jsonPath.replace(/\.json$/, '.md').replace(/_2026-/, '_v5_2026-');
  fs.writeFileSync(mdPath, md);

  console.log(`\nדוח JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`דוח MD:   ${path.relative(ROOT, mdPath)}`);
  console.log(`שערים: ${summary.passed}/${summary.total} ירוקים (${summary.failed} כשלים)`);
  process.exit(summary.ok ? 0 : 1);
})();

/** §2.7 — הפקת Markdown מאובייקט התוצאות (מספרים נגזרים בלבד). */
function renderMarkdown(out) {
  const L = [];
  const m = out.measured;
  L.push(`# STAGE9_SHADOW v5 — השוואת צללים legacy ↔ מאוחד (9b.1)`);
  L.push('');
  L.push(`> **תאריך:** ${out.started.slice(0, 10)} · **מסמך:** \`${out.file}\` · **פרופיל מאוחד:** ${out.unifiedProfile} · **סכמה:** ${out.schema}`);
  L.push(`> **תוצאה: ${out.summary.passed}/${out.summary.total} שערים ירוקים** (${out.summary.failed} כשלים) — נגזר מרשימת GATES בקוד; אין מספרים כתובים ידנית.`);
  L.push('');
  L.push(`## מדדים (מה כל מספר מודד)`);
  L.push('');
  L.push(`| מדד | ערך | הגדרה |`);
  L.push(`|---|---|---|`);
  L.push(`| מילות תוכן צפויות (מקור) | ${m.source.contentWords.toLocaleString()} | טקסטי כותרות+פסקאות+הערות+ביאורים מהפרסור הקנוני (בלי מילות הוראה) |`);
  L.push(`| הערות-גוף (מקור) | ${m.source.notes} | זוגות תוחמים סמנטיים מהחלקים note-ref — לא Regex |`);
  L.push(`| כותרות H0–H6 / H7 (מקור) | ${m.source.headings} / ${m.source.h7} | טוקנים יציבים של הפרסור הקנוני |`);
  L.push(`| כותרות לפי דקדוק הייחוס | ${m.source.refGrammarHeadings} | הביטוי הרגולרי של המורשת (כולל "מספר N" וציטוטים לפני המקף) |`);
  L.push(`| מורשת | ${m.legacy.pages} עמ', ${m.legacy.words.toLocaleString()} מילים | כל המשטחים: עמודות+חלון+spanning+שערים+TOC+הערות+ביאורים |`);
  L.push(`| הערות מורשת (משוחזרות) | ${m.legacy.notes} מתוך ${m.legacy.fnAreas} אזורים | פיצול לפי סמנים (w.mk); המשכים: ${m.legacy.continuationFragments} |`);
  L.push(`| ביאורי-צד מורשת | ${m.legacy.sideNotes} ביאורים, ${m.legacy.sideWords.toLocaleString()} מילים | **מספר מילים — לא מספר ביאורים** |`);
  L.push(`| מאוחד | ${m.unified.pages} עמ', ${m.unified.words.toLocaleString()} מילים | כל המשטחים כולל spanning (H3–H6) ו-PageModel |`);
  L.push(`| ביאורי-צד מאוחד | ${m.unified.sideNotes} פריטים, ${m.unified.sideWords.toLocaleString()} מילים | פריטי עוגן מוצבים |`);
  L.push(`| TOC כללי/מפורט (מאוחד) | ${m.unified.tocGeneralRows} / ${m.unified.tocDetailRows} רשומות | מדידה בנפרד — תיקון עיוורון גרסה 4 |`);
  L.push('');
  L.push(`## שערים (${out.summary.total})`);
  L.push('');
  L.push(`| # | שער | קבוצה | מצב | תוצאה |`);
  L.push(`|---|---|---|---|---|`);
  const gateIds = Object.keys(out.gates);
  gateIds.forEach((id, i) => {
    const g = out.gates[id];
    L.push(`| ${i + 1} | \`${id}\` | ${g.group} | ${g.ok ? '✓' : '✗'} | ${String(g.detail).replace(/\|/g, '\\|')} |`);
  });
  L.push('');
  L.push(`## הבדלים מתועדים (אינם שער)`);
  L.push('');
  for (const [k, v] of Object.entries(out.documented)) L.push(`- **${k}:** ${v}`);
  L.push('');
  return L.join('\n');
}
