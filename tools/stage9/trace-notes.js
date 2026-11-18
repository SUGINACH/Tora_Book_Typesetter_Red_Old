#!/usr/bin/env node
// tools/stage9/trace-notes.js — מיפוי זהות הערות-גוף: מקור ← מורשת ← מאוחד (§4)
'use strict';
const fs = require('fs');
const path = require('path');
process.env.RED_ENABLE_STRETCH_RECLAIM = process.env.RED_ENABLE_STRETCH_RECLAIM || '1';
process.env.RED_RECLAIM_COMPRESS_MAX = process.env.RED_RECLAIM_COMPRESS_MAX || '20';
const ROOT = path.resolve(__dirname, '..', '..');
const RB = path.join(ROOT, 'red-build');
const { lexDocument } = require(path.join(RB, 'src/engine/parser/dfa-lexer'));
const { tokenizeDetailed } = require(path.join(RB, 'src/engine/parser/block-tokenizer'));
const { importImudSettings } = require(path.join(RB, 'src/engine/core/legacy-settings-map'));
const { getSettingDefs, getDefaultSettings } = require(path.join(RB, 'src/engine/core/settings-registry'));
const { registerFont } = require(path.join(RB, 'src/engine/typography/measure-api'));
const { typeset } = require(path.join(RB, 'src/engine/core/pipeline'));
// **9c.4:** הפורט הנאמן נקרא ישירות — אין עוד dispatch ב-typeset (מנוע יחיד).
const { legacyTypeset } = require(path.join(RB, 'src/engine/layout/legacy-imud-flow'));

const file = process.argv[2] || path.join(RB, 'tests/fixtures/canonical_corpus.txt');
const text = fs.readFileSync(file, 'utf8');
const norm = (s) => String(s == null ? '' : s).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[\ue000-\uf8ff]/g, ' ').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();

// מקור — הערות מהפרסור הסמנטי (לא Regex)
const defaults = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
const lexed = lexDocument(text, {});
const det = tokenizeDetailed(lexed.bodyLines, { fnOpen: String(defaults['fn-delim-open'] || '['), fnClose: String(defaults['fn-delim-close'] || ']') });
const srcNotes = [];
for (const t of det.tokens) {
  if (t.type !== 'paragraph' || !t.notes) continue;
  t.parts.filter(p => p.kind === 'note-ref').forEach(p => {
    srcNotes.push({ tokenId: t.id, noteIndex: p.noteIndex, text: norm(t.notes[p.noteIndex]) });
  });
}
console.log(`מקור (פרסור סמנטי): ${srcNotes.length} הערות-גוף`);

function registerAllFonts() {
  const FONTS = [
    ['Guttman Rashi', 'Guttman-Rashi-Normal.ttf'], ['Frank Ruhl Libre', 'FrankRuhlLibre-VF.ttf'],
    ['Alpha', 'Alpha-Regular.ttf'], ['AlphaBlack', 'Alpha-Black.ttf'], ['AlphaLight', 'Alpha-Light.ttf'],
    ['Lia Sgula', 'Sgula-Regular.ttf'], ['Livorna', 'Livorna-Regular.ttf'], ['FrankReal', 'FrankReal-Regular.ttf'],
    ['David Libre', 'DavidLibre-Regular.ttf'], ['Hadassah Friedlaender', 'Hadassah-Friedlaender.ttf']
  ];
  for (const [fam, f] of FONTS) {
    const fp = path.join(RB, 'ui/assets/imud/fonts', f);
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
  // **9c.4:** ה-raw מוצמד לקריאה הישירה של הפורט (אין עוד dispatch ב-typeset).
  return { ...getDefaultSettings(), ...imp.settings, _imudRaw: legacy, 'body-font': 'Guttman Rashi', 'measure-impl': 'font-metrics' };
}
registerAllFonts();

// מורשת: אזורי הערה עם טקסט מלא
const rl = legacyTypeset(text, legacySettings(), {}); // 9c.4: קריאה ישירה לפורט הנאמן
const legNotes = [];
for (const pg of rl.pages) {
  for (const fa of (pg.footnotes || [])) {
    const words = [];
    for (const ln of (fa.lines || [])) for (const w of (ln.words || [])) {
      const t2 = w && typeof w === 'object' ? w.t : w;
      if (w && typeof w === 'object' && w.mk) continue;
      words.push(t2);
    }
    legNotes.push({ text: norm(words.join(' ')), page: pg.index });
  }
}
console.log(`מורשת: ${legNotes.length} אזורי הערה`);

// מאוחד: רשומות הערה
const uniSettings = (() => { const s2 = { ...legacySettings() }; delete s2['_layout-profile']; delete s2['_imudRaw']; return s2; })();
const r = typeset(text, uniSettings, {});
const uniNotes = [];
for (const pg of r.pages) for (const fn of (pg.footnotes || [])) {
  uniNotes.push({ noteId: fn.noteId, marker: fn.marker, text: norm(fn.text), anchorId: fn.anchorId, isCont: fn.isContinuation === true || fn.continuationOf != null, page: pg.index });
}
// גם המשכים וגם rejected
console.log(`מאוחד: ${uniNotes.length} רשומות במרזב (${uniNotes.filter(n => !n.isCont).length} מקוריות, ${uniNotes.filter(n => n.isCont).length} המשכים)`);

// התאמה לפי טקסט
const srcByText = new Map();
for (const n of srcNotes) { if (!srcByText.has(n.text)) srcByText.set(n.text, []); srcByText.get(n.text).push(n); }
const legMiss = [], uniMiss = [];
const srcUsedLeg = new Set(), srcUsedUni = new Set();
for (const n of legNotes) { const hits = srcByText.get(n.text) || []; const hit = hits.find(h => !srcUsedLeg.has(`${h.tokenId}:${h.noteIndex}`)); if (hit) srcUsedLeg.add(`${hit.tokenId}:${hit.noteIndex}`); else legMiss.push(n); }
for (const n of uniNotes.filter(x => !x.isCont)) { const hits = srcByText.get(n.text) || []; const hit = hits.find(h => !srcUsedUni.has(`${h.tokenId}:${h.noteIndex}`)); if (hit) srcUsedUni.add(`${hit.tokenId}:${hit.noteIndex}`); else uniMiss.push(n); }
console.log(`\nכיסוי מקור→מורשת: ${srcUsedLeg.size}/${srcNotes.length} (אזורים חסרי מקור: ${legMiss.length})`);
console.log(`כיסוי מקור→מאוחד: ${srcUsedUni.size}/${srcNotes.length} (רשומות חסרות מקור: ${uniMiss.length})`);
const srcNoUni = srcNotes.filter(n => !srcUsedUni.has(`${n.tokenId}:${n.noteIndex}`));
const srcNoLeg = srcNotes.filter(n => !srcUsedLeg.has(`${n.tokenId}:${n.noteIndex}`));
console.log(`הערות מקור בלי רשומה במאוחד: ${srcNoUni.length}`);
for (const n of srcNoUni.slice(0, 8)) console.log(`  - tok ${n.tokenId}[${n.noteIndex}]: "${n.text.slice(0, 60)}"`);
console.log(`הערות מקור בלי אזור במורשת: ${srcNoLeg.length}`);
for (const n of srcNoLeg.slice(0, 8)) console.log(`  - tok ${n.tokenId}[${n.noteIndex}]: "${n.text.slice(0, 60)}"`);
