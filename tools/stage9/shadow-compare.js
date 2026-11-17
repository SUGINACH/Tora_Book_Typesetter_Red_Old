#!/usr/bin/env node
// tools/stage9/shadow-compare.js — השוואת צללים legacy ↔ מאוחד (שלב 9, §6.2)
//
// מטרה: להוכיח (או לאתר פערים) בשימור תוכן וזהויות בין שני מנועי העימוד
// על אותו מקור — לפני כל הסרה של נתיב מורשת (§6.3). הכלי מריץ את שני
// הפרופילים באותו תהליך (אותם גופנים רשומים, אותה סביבת מדידה).
//
// שערי תוכן (כישלון = חסימת המשך שלב 9):
//   G1 כיסוי מקור במורשת — כל מילות התוכן של המקור הגולמי מרונדרות
//      בפלט המורשת, למעט מילות תחביר הנחיות שהמנוע צורך (כותרת N -,
//      הערת סיום -, מקפים, ספרות) — רשימה סגורה ומנויה.
//   G2 כיסוי מקור במאוחד — כמו G1 + מפתחות מטא שהדקדוק המאוחד מחלץ
//      לכריכה (ספר/מחבר/נושא…). כל ירידה שאינה מוסברת = כשל.
//   G3 אין תוכן רפאים — בכל מנוע, עודפי מילים על המקור חייבים להיות
//      מוסברים: סמני מספור/המשך, בס״ד, כותרת עמוד-הערות, או מילים
//      מכפילות כותרות-שער מתועדת.
//   G4 הערות — גוף הערות (bracket) וביאורי הצד זהים מילה-במילה
//      (multiset) בין המנועים.
//   G5 זהות הערות — מספר ההערות הייחודיות לפי קטגוריה שווה בין
//      המנועים, ועוגני המאוחד מכסים את טוקני ההערות של המקור.
//   G6 כותרות — טקסטי הכותרות (רמה 1) זהים בין המנועים ולמקור,
//      וכל כותרות המקור מכוסות בכל מנוע.
//
// הבדלים מתועדים (אינם שער — שני מנועים שונים רשאים לסווג אחרת):
//   מספר עמודים, שבירת שורות, מיקומים; שורות מטא → כריכה (מאוחד)
//   מול טקסט גוף (מורשת); "הקדמה -" → כותרת h0 (מאוחד) מול גוף (מורשת);
//   "הערת סיום -" → פסקה (ברירת מחדל מאוחד) מול עמוד הערות (מורשת);
//   כפילות כותרת-שער (מאוחד: shaarLayout + שורת כותרת; מורשת: gateLine);
//   מילת-חלון בשדה נפרד (מורשת) מול בזרם (מאוחד); פורמט סמן (א. מול א׳);
//   עומק TOC (מורשת: גם h3 ומפורט; מאוחד: כללי בלבד).
//
// שימוש: node tools/stage9/shadow-compare.js [קובץ-טקסט] [--json out.json]
//   ברירת מחדל: red-build/tests/fixtures/canonical_corpus.txt
//   מסמך ראשי:  audits/very_long_test_text.txt
'use strict';

const fs = require('fs');
const path = require('path');

process.env.RED_ENABLE_STRETCH_RECLAIM = process.env.RED_ENABLE_STRETCH_RECLAIM || '1';
process.env.RED_RECLAIM_COMPRESS_MAX = process.env.RED_RECLAIM_COMPRESS_MAX || '20';

const ROOT = path.resolve(__dirname, '..', '..');
const RB = path.join(ROOT, 'red-build');

const { tokenizeDoc, stripEditorialNotes } = require(path.join(RB, 'src/engine/layout/legacy-imud-flow'));
const { importImudSettings } = require(path.join(RB, 'src/engine/core/legacy-settings-map'));
const { getSettingDefs, getDefaultSettings } = require(path.join(RB, 'src/engine/core/settings-registry'));
const { registerFont } = require(path.join(RB, 'src/engine/typography/measure-api'));
const { typeset } = require(path.join(RB, 'src/engine/core/pipeline'));
const { buildShaarBlocks } = require(path.join(RB, 'src/engine/output/shaar-content'));

// ---------- עזרי נרמול ----------
const normWords = (s) => String(s == null ? '' : s)
  .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // תווי כיוון/בלתי-נראים — לא תוכן
  .replace(/[\ue000-\uf8ff]/g, ' ') // זקיפי PUA פנימיים (הדבקת סמן-הערה לעוגן; המרנדרר מנקה)
  .replace(/[[\]]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);
const multiset = (arr) => { const m = new Map(); for (const w of arr) m.set(w, (m.get(w) || 0) + 1); return m; };
const mEqual = (a, b) => { if (a.size !== b.size) return false; for (const [w, c] of a) if (b.get(w) !== c) return false; return true; };
const mDiff = (sup, sub) => { const d = []; for (const [w, c] of sub) { const have = sup.get(w) || 0; if (have < c) d.push({ w, miss: c - have }); } return d; };
const fmtDrops = (d) => d.map(x => `${x.w}(×${x.miss})`);

// ---------- 1. מלאי המקור ----------
function sourceInventory(text) {
  const defaults = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
  const cfg = { fnOpen: String(defaults['fn-delim-open'] || '['), fnClose: String(defaults['fn-delim-close'] || ']') };
  const { tokens } = tokenizeDoc(text, cfg);
  const noEd = stripEditorialNotes(text);
  const headings = [];
  const sideBodies = [];
  for (const t of tokens) {
    if (t.sideNote) for (const w of normWords(t.sideNote)) sideBodies.push(w);
    if (t.type && t.type.startsWith('h')) headings.push({ level: Number(t.type.slice(1)), text: String(t.text).replace(/\s+/g, ' ').trim() });
  }
  const noteBodies = [];
  for (const m of noEd.matchAll(/\[([^\]]+)\]/g)) for (const w of normWords(m[1])) noteBodies.push(w);
  // המקור כולו (גולמי, ללא הערות עריכה) — התוחמים כן מוסרים (תחביר)
  const srcMultiset = multiset(normWords(noEd));
  const bracketNoteCount = (noEd.match(/\[([^\]]+)\]/g) || []).length;
  return { headings, sideBodies, noteBodies, srcMultiset, bracketNoteCount };
}

// מילות דקדוק שמנוע צורך מהנחיות המקור (רשימה סגורה; ספירה מדויקת בדוח):
// כותרת N -, סימן X -, הקדמה -, הערת סיום(-N) -, ביאור: — וכן מקפי-הפרדה,
// ספרות ההנחיות ומפתחות המטא (שני הדקדוקים מחלצים אותם מהגוף).
const GRAMMAR_WORDS = new Set(['כותרת', 'מספר', 'סימן', 'הקדמה', 'הערת', 'סיום', 'ביאור', '-', '–', '—', ':']);
const META_KEYS = new Set(['ספר', 'מחבר', 'נושא', 'מהדורא', 'פרטי', 'שם', 'הספר', 'המחבר', 'נושאים', 'מפורט', 'ושנת', 'מקום', 'הוצאה', 'לאור', 'שמירת', 'זכויות', 'הפקר', 'רשויות', 'חצירות', 'תחומין']);
const isGrammarDrop = (w) =>
  GRAMMAR_WORDS.has(w) || META_KEYS.has(w) || /^\d+$/.test(w) || /^\(מקור/.test(w) || /^סיום[-–—]?\d*$/.test(w);

// ---------- 2. הרצות ----------
function registerAllFonts() {
  const FONTS = [
    ['Guttman Rashi', 'Guttman-Rashi-Normal.ttf'], ['Frank Ruhl Libre', 'FrankRuhlLibre-VF.ttf'],
    ['Alpha', 'Alpha-Regular.ttf'], ['AlphaBlack', 'Alpha-Black.ttf'], ['AlphaLight', 'Alpha-Light.ttf'],
    ['Lia Sgula', 'Sgula-Regular.ttf'], ['Livorna', 'Livorna-Regular.ttf'], ['FrankReal', 'FrankReal-Regular.ttf'],
    ['David Libre', 'DavidLibre-Regular.ttf'], ['Hadassah Friedlaender', 'Hadassah-Friedlaender-Regular.ttf']
  ];
  for (const [fam, file] of FONTS) {
    const fp = path.join(RB, 'ui/assets/imud/fonts', file);
    if (fs.existsSync(fp)) { const r = registerFont(fam, fs.readFileSync(fp)); if (!r.ok) console.error(`registerFont(${fam}): ${r.error}`); }
  }
}
function legacySettings() {
  const legacy = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
  const families = new Set();
  for (const cat of ['imud-fonts.json', 'fonts-extended.json']) {
    const p = path.join(RB, 'ui/assets/imud', cat);
    if (fs.existsSync(p)) for (const f of JSON.parse(fs.readFileSync(p, 'utf8'))) families.add(f.family);
  }
  const imp = importImudSettings(legacy, new Set(getSettingDefs().map(r => r.id)), { availableFonts: families });
  return { ...getDefaultSettings(), ...imp.settings, 'body-font': 'Guttman Rashi', 'measure-impl': 'font-metrics' };
}

// ---------- 3. חילוץ מלא מתוצאת מורשת ----------
function legacyInventory(r, settings) {
  const all = [];          // כל מילה מרונדרת
  const fnWords = [];      // הערות-גוף (bracket)
  const endWords = [];     // הערות-סיום (עמודי ההערות)
  const sideWords = [];    // ביאורי צד
  const markers = [];
  let fnAreas = 0;
  const tocRows = [];
  for (const pg of r.pages) {
    if (pg.type === 'toc-general') for (const row of ((pg.toc && pg.toc.rows) || [])) { tocRows.push(row); for (const nw of normWords(row.text)) all.push(nw); }
    for (const col of (pg.columns || [])) {
      for (const ln of col) {
        const mk = new Set(ln.markerIdx || []);
        for (const w of (ln.windowWords || [])) for (const nw of normWords(w)) all.push(nw);
        (ln.words || []).forEach((w, i) => {
          const t = w && typeof w === 'object' ? w.t : w;
          if (mk.has(i)) { markers.push(t); return; }
          for (const nw of normWords(t)) all.push(nw);
          if (/^endnotes/.test(pg.type || '')) for (const nw of normWords(t)) endWords.push(nw);
        });
      }
    }
    for (const gl of (pg.gateLines || [])) for (const nw of normWords(gl && gl.text)) all.push(nw);
    for (const b of (pg.bands || [])) for (const nw of normWords(b && b.text)) all.push(nw);
    // שערים — המודל חי ברינדרר (buildShaarBlocks); אותו מקור יחיד כמו ה-DOM
    if (/^shaar/.test(pg.type || '')) {
      const model = buildShaarBlocks(pg, settings, r.metadata || {});
      for (const b of ((model && model.blocks) || [])) for (const nw of normWords(b && b.text)) all.push(nw);
    }
    for (const fnArea of (pg.footnotes || [])) {
      fnAreas++;
      for (const ln of (fnArea.lines || [])) for (const w of (ln.words || [])) {
        const t = w && typeof w === 'object' ? w.t : w;
        if (w && typeof w === 'object' && w.mk) { markers.push(t); continue; }
        for (const nw of normWords(t)) { fnWords.push(nw); all.push(nw); }
      }
    }
    for (const mn of (pg.marginNotes || [])) for (const ln of (mn.lines || [])) for (const nw of normWords(ln.text)) { sideWords.push(nw); all.push(nw); }
  }
  return { all, fnWords, endWords, sideWords, markers, fnAreas, tocRows, pages: r.pages.length };
}

// ---------- 4. חילוץ מלא מתוצאה מאוחדת ----------
function unifiedInventory(r) {
  const all = [];
  const fnWords = [];
  const sideWords = [];
  const markers = [];
  const noteIds = new Set(), anchorIds = new Set();
  const tocRows = [];
  for (const pg of r.pages) {
    // טקסטי TOC מרונדרים בעמודות — תוכן לכל דבר (המורשת מקבילה דרך toc.rows)
    for (const col of (pg.columns || [])) for (const ln of col) for (const w of (ln.words || [])) for (const nw of normWords(w)) all.push(nw);
    if (pg.shaarLayout) for (const b of (pg.shaarLayout.blocks || [])) for (const nw of normWords(b && b.text)) all.push(nw);
    for (const fn of (pg.footnotes || [])) {
      for (const nw of normWords(fn.text)) { fnWords.push(nw); all.push(nw); }
      if (fn.marker) markers.push(fn.marker);
      if (fn.noteId) noteIds.add(fn.noteId);
      if (fn.anchorId) anchorIds.add(fn.anchorId);
    }
    for (const sn of (pg.sideNotes || [])) {
      const txt = sn && sn.text != null ? sn.text : (sn.lines || []).map(l => l.text || '').join(' ');
      for (const nw of normWords(txt)) { sideWords.push(nw); all.push(nw); }
    }
  }
  for (const e of (r.toc && r.toc.general) || []) tocRows.push({ level: e.level, text: String(e.text || '').replace(/\s+/g, ' ').trim() });
  const enInfo = r.endnotePagesInfo || {};
  const endNotes = (enInfo.pages || []).reduce((n, p) => n + ((p.notes || []).length), 0);
  const endWords = [];
  for (const p of (enInfo.pages || [])) for (const n of (p.notes || [])) for (const w of normWords(n.text)) endWords.push(w);
  return { all, fnWords, endWords, sideWords, markers, noteCount: noteIds.size, anchorCount: anchorIds.size, tocRows, pages: r.pages.length, endNotes };
}

// ---------- main ----------
(function main() {
  const argv = process.argv.slice(2);
  const jsonOutIdx = argv.indexOf('--json');
  const jsonOut = jsonOutIdx > -1 ? argv[jsonOutIdx + 1] : null;
  const fileArg = argv.find(a => !a.startsWith('--') && a !== jsonOut);
  const file = fileArg || path.join(RB, 'tests/fixtures/canonical_corpus.txt');
  const text = fs.readFileSync(file, 'utf8');
  const label = path.relative(ROOT, file).replace(/\\/g, '/');
  const out = { tool: 'stage9-shadow-compare', schema: 4, file: label, unifiedProfile: argv.includes('--dp-defaults') ? 'dp-defaults' : 'imud-cutover', started: new Date().toISOString(), gates: {}, documented: {}, ok: true, failures: [] };
  const fail = (gate, msg) => { out.ok = false; out.failures.push(`[${gate}] ${msg}`); console.error(`✗ [${gate}] ${msg}`); };
  const pass = (gate, msg) => { console.log(`✓ [${gate}] ${msg}`); out.gates[gate] = msg; };

  registerAllFonts();

  const src = sourceInventory(text);
  const srcTotal = [...src.srcMultiset.values()].reduce((a, b) => a + b, 0);
  console.log(`מקור: ${label}`);
  console.log(`  מילים גולמיות: ${srcTotal.toLocaleString()} | הערות-סוגריים: ${src.bracketNoteCount} (${src.noteBodies.length} מילים) | ביאורי-צד: ${src.sideBodies.length} | כותרות: ${src.headings.length}`);

  const legSettings = legacySettings();
  const tL = Date.now();
  const legacyRes = typeset(text, legSettings, {});
  if (!legacyRes.legacyProfile) { console.error('הרצת המורשת לא הופעלה'); process.exit(2); }
  const leg = legacyInventory(legacyRes, legSettings);
  console.log(`  מורשת: ${leg.pages} עמודים (${Date.now() - tL}ms) | מילים: ${leg.all.length.toLocaleString()} | הערות-גוף: ${leg.fnWords.length} | הערות-סיום: ${leg.endWords.length} | ביאורי-צד: ${leg.sideWords.length}`);

  // המאוחד בקונפיגורציית ה-cutover: הגדרות IMUD הממופות בלי דגלי המורשת
  // (כך ירוץ המנוע המאוחד לאחר שלב 9, עם ברירות המחדל המאושרות של המשתמש).
  const uniSettings = argv.includes('--dp-defaults')
    ? { ...getDefaultSettings(), 'measure-impl': 'font-metrics' }
    : (() => { const s2 = { ...legacySettings() }; delete s2['_layout-profile']; delete s2['_imudRaw']; return s2; })();
  const tU = Date.now();
  const uniRes = typeset(text, uniSettings, {});
  if (uniRes.legacyProfile) { console.error('ההרצה המאוחדת נפלה למורשת'); process.exit(2); }
  const uni = unifiedInventory(uniRes);
  // ריהוט שער מההגדרות (מקור לגיטימי לתוכן שער — אותו מקור מידע בשני המנועים)
  const furniture = new Set(['בס״ד']);
  for (const k of ['imud-book-title', 'imud-book-subtitle', 'imud-book-desc', 'imud-book-sections', 'imud-book-author', 'imud-book-year', 'shaar-back-text']) {
    const v = legSettings[k];
    if (typeof v === 'string' && v.trim()) for (const w of normWords(v)) furniture.add(w);
  }
  // ריהוט השער-האחורי מההגדרות הגולמיות של המקור (inp-book-back-*) + ברירת המחדל
  const rawDefaults = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
  for (const k of ['inp-book-back-copyright', 'inp-book-back-publishing', 'inp-book-back-contact', 'inp-book-back-extra', 'inp-book-title', 'inp-book-subtitle', 'inp-book-desc', 'inp-book-sections', 'inp-book-author', 'inp-book-year']) {
    const v = rawDefaults[k];
    if (typeof v === 'string' && v.trim()) for (const w of normWords(v)) furniture.add(w);
  }
  for (const w of normWords('כל הזכויות שמורות למחבר.')) furniture.add(w);
  // ערכי מטא של המסמך — לסיווג ירידות (המורשת מרנדרת כגוף; המאוחד מחלץ למטא)
  const metaValueMultiset = multiset(Object.values(uniRes.metadata || {}).flatMap(v => normWords(v)));
  console.log(`  מאוחד (${out.unifiedProfile}): ${uni.pages} עמודים (${Date.now() - tU}ms) | מילים: ${uni.all.length.toLocaleString()} | הערות-גוף: ${uni.fnWords.length} | ביאורי-סיום: ${uni.endNotes} | ביאורי-צד: ${uni.sideWords.length} | הערות ייחודיות: ${uni.noteCount} | עוגנים: ${uni.anchorCount}`);

  const legM = multiset(leg.all);
  const uniM = multiset(uni.all);

  // G1 — כיסוי מקור במורשת
  const legDrops = mDiff(legM, src.srcMultiset);
  const legUnexplained = legDrops.filter(d => !isGrammarDrop(d.w));
  if (!legUnexplained.length) pass('G1-legacy-covers-source', `כיסוי מלא; ${legDrops.length} ירידות תחביר מוסברות (${fmtDrops(legDrops).slice(0, 6).join(', ')})`);
  else fail('G1-legacy-covers-source', `ירידות בלתי-מוסברות: ${fmtDrops(legUnexplained).slice(0, 12).join(', ')}${legUnexplained.length > 12 ? ` … (${legUnexplained.length})` : ''}`);

  // G2 — כיסוי מקור במאוחד; ירידות ערכי-מטא מסווגות בנפרד (ממצא 9b)
  const uniDrops = mDiff(uniM, src.srcMultiset);
  // תקציב ערכי-מטא: ירידה מסווגת "מטא" רק עד כדי כמות הופעת המילה בערכי המטא;
  // עודף מעבר לזה (למשל מילים מכותרות h3 שאינן מרונדרות) נשאר בלתי-מוסבר.
  const uniMetaDrops = [];
  const uniUnexplained = [];
  for (const d of uniDrops) {
    const budget = metaValueMultiset.get(d.w) || 0;
    if (isGrammarDrop(d.w)) continue;
    if (budget >= d.miss) uniMetaDrops.push(d);
    else if (budget > 0) { uniMetaDrops.push({ w: d.w, miss: budget }); uniUnexplained.push({ w: d.w, miss: d.miss - budget }); }
    else uniUnexplained.push(d);
  }
  if (!uniUnexplained.length && !uniMetaDrops.length) pass('G2-unified-covers-source', `כיסוי מלא; ${uniDrops.length} ירידות דקדוק מוסברות (${fmtDrops(uniDrops).slice(0, 6).join(', ')})`);
  else {
    if (!uniUnexplained.length) pass('G2-unified-except-meta', `כיסוי מלא למעט ערכי-מטא; ${uniDrops.length} ירידות דקדוק מוסברות`);
    else fail('G2-unified-covers-source', `ירידות בלתי-מוסברות: ${fmtDrops(uniUnexplained).slice(0, 12).join(', ')}${uniUnexplained.length > 12 ? ` … (${uniUnexplained.length})` : ''}`);
    if (uniMetaDrops.length) fail('G2-meta-values', `ערכי מטא של המסמך אינם מרונדרים במסלול המאוחד (המורשת מרנדרת אותם כטקסט גוף; השער נקבע מהגדרות imud-book-*): ${fmtDrops(uniMetaDrops).slice(0, 10).join(', ')}${uniMetaDrops.length > 10 ? ` … (${uniMetaDrops.length})` : ''} — ממצא 9b`);
  }

  // G3 — אין תוכן רפאים (עודפים על המקור חייבים הסבר)
  const headingVocab = new Set(src.headings.flatMap(h => normWords(h.text)));
  const phantomOk = (w) =>
    (w.length <= 3 && /^[0-9]*[א-ת]+[.,׳״]{0,2}$/.test(w)) ||
    w === 'הערות' || w === 'בס״ד' || w === 'המשך' || /^\(המשך\)$/.test(w) ||
    /^[0-9]+$/.test(w) || /^[a-zA-Z]+$/.test(w) ||
    furniture.has(w) || headingVocab.has(w); // ריהוט שער מהגדרות + כפילות כותרות/TOC מתועדת
  const legPhantom = mDiff(src.srcMultiset, legM).filter(d => !phantomOk(d.w));
  const uniPhantom = mDiff(src.srcMultiset, uniM).filter(d => !phantomOk(d.w));
  if (!legPhantom.length) pass('G3-no-phantom-legacy', `נקי (${leg.markers.length} סמנים מתועדים)`);
  else fail('G3-no-phantom-legacy', `עודפים בלתי-מוסברים: ${fmtDrops(legPhantom).slice(0, 12).join(', ')}`);
  if (!uniPhantom.length) pass('G3-no-phantom-unified', `נקי (${uni.markers.length} סמנים מתועדים)`);
  else fail('G3-no-phantom-unified', `עודפים בלתי-מוסברים: ${fmtDrops(uniPhantom).slice(0, 12).join(', ')}`);

  // G4 — גוף הערות זהה בין המנועים
  if (mEqual(multiset(leg.fnWords), multiset(uni.fnWords))) pass('G4-note-bodies', `הערות-גוף זהות (${leg.fnWords.length} מילים)`);
  else fail('G4-note-bodies', `הערות-גוף שונות — חסר במאוחד: ${fmtDrops(mDiff(multiset(uni.fnWords), multiset(leg.fnWords))).slice(0, 8).join(', ')} | חסר במורשת: ${fmtDrops(mDiff(multiset(leg.fnWords), multiset(uni.fnWords))).slice(0, 8).join(', ')}`);
  if (mEqual(multiset(leg.sideWords), multiset(uni.sideWords))) pass('G4-side-bodies', `ביאורי-צד זהים (${leg.sideWords.length} מילים)`);
  else fail('G4-side-bodies', `ביאורי-צד שונים — חסר במאוחד: ${fmtDrops(mDiff(multiset(uni.sideWords), multiset(leg.sideWords))).slice(0, 8).join(', ')} | חסר במורשת: ${fmtDrops(mDiff(multiset(leg.sideWords), multiset(uni.sideWords))).slice(0, 8).join(', ')}`);

  // G5 — זהות הערות
  if (leg.fnAreas === uni.noteCount && uni.noteCount === src.bracketNoteCount) pass('G5-note-count', `הערות-גוף: מורשת ${leg.fnAreas} = מאוחד ${uni.noteCount} = סוגריים במקור ${src.bracketNoteCount}`);
  else fail('G5-note-count', `הערות-גוף: מורשת ${leg.fnAreas}, מאוחד ${uni.noteCount}, סוגריים במקור ${src.bracketNoteCount}`);
  if (uni.anchorCount >= src.bracketNoteCount) pass('G5-anchors', `עוגני המאוחד (${uni.anchorCount}) ≥ הערות המקור (${src.bracketNoteCount})`);
  else fail('G5-anchors', `עוגני המאוחד (${uni.anchorCount}) < הערות המקור (${src.bracketNoteCount})`);

  // G6 — כותרות
  const expH1 = src.headings.filter(h => h.level === 1).map(h => h.text);
  const legH1 = leg.tocRows.filter(r => r.level === 1).map(r => r.text);
  const uniH1 = uni.tocRows.filter(r => r.level === 1).map(r => r.text);
  const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (eqArr(legH1, expH1) && eqArr(uniH1, expH1)) pass('G6-headings', `כותרות רמה-1 זהות בשלושת המקורות (${expH1.length})`);
  else fail('G6-headings', `כותרות שונות: מורשת ${legH1.length}, מאוחד ${uniH1.length}, מקור ${expH1.length}`);
  // כיסוי: כל כותרות המקור (1–2) מופיעות ב-TOC של כל מנוע
  const legTocSet = new Set(leg.tocRows.map(r => r.text));
  const uniTocSet = new Set(uni.tocRows.map(r => r.text));
  const missLeg = src.headings.filter(h => h.level <= 2 && !legTocSet.has(h.text)).map(h => h.text);
  const missUni = src.headings.filter(h => h.level <= 2 && !uniTocSet.has(h.text)).map(h => h.text);
  if (!missLeg.length && !missUni.length) pass('G6-toc-coverage', 'כל כותרות המקור (רמות 1–2) מכוסות ב-TOC של שני המנועים');
  else fail('G6-toc-coverage', `חסרות ב-TOC: מורשת ${JSON.stringify(missLeg.slice(0, 4))}, מאוחד ${JSON.stringify(missUni.slice(0, 4))}`);

  // הבדלים מתועדים (אינם שער)
  out.documented = {
    pages: { legacy: leg.pages, unified: uni.pages },
    markers: { legacySample: leg.markers.slice(0, 12), unifiedSample: uni.markers.slice(0, 12) },
    grammarDrops: {
      legacy: fmtDrops(legDrops).slice(0, 15),
      unified: fmtDrops(uniDrops).slice(0, 15),
      unifiedMetaValues: fmtDrops(uniMetaDrops).slice(0, 15)
    },
    classification: [
      'שורות מטא ("ספר -" וכו׳): מאוחד → בלוקי כריכה (shaarLayout); מורשת → טקסט גוף',
      '"הקדמה - X": מאוחד → כותרת h0 (מילת המפתח נצרכת); מורשת → טקסט גוף מילולי',
      '"הערת סיום - X": מורשת → עמוד הערות (endnotes); מאוחד (ברירת מחדל) → פסקת גוף; במצב endnotes → עמודי הערות',
      'כפילות כותרת-שער: מאוחד מציג כותרת חלק גם ב-shaar-sub וגם כשורת כותרת; מורשת — gateLine בלבד',
      'מילת-חלון: מורשת → שדה windowWords נפרד; מאוחד → בזרם המילים',
      'עומק TOC: מורשת — כללי (h1–h3) + מפורט; מאוחד — כללי בלבד',
      `פורמט סמן: מורשת ${JSON.stringify(leg.markers[0])}; מאוחד ${JSON.stringify(uni.markers[0])}`
    ],
    endnotes: { legacyNotes: leg.endWords.length, unifiedNotes: uni.endNotes }
  };

  const jsonPath = jsonOut || path.join(ROOT, 'audits', `STAGE9_SHADOW_${path.basename(file).replace(/\.[^.]+$/, '')}_${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  console.log(`\nדוח: ${path.relative(ROOT, jsonPath)}`);
  console.log(out.ok ? '✓ השוואת הצללים עברה — כל שערי התוכן והזהויות תקינים' : `✗ נכשלו ${out.failures.length} שערים`);
  process.exit(out.ok ? 0 : 1);
})();
