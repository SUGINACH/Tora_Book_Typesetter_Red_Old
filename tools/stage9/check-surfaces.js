#!/usr/bin/env node
// tools/stage9/check-surfaces.js — בדיקת משטחי תוכן שהכלי הנוכחי מפספס (spanning/gateLines/bands)
'use strict';
const fs = require('fs');
const path = require('path');
process.env.RED_ENABLE_STRETCH_RECLAIM = process.env.RED_ENABLE_STRETCH_RECLAIM || '1';
process.env.RED_RECLAIM_COMPRESS_MAX = process.env.RED_RECLAIM_COMPRESS_MAX || '20';
const ROOT = path.resolve(__dirname, '..', '..');
const RB = path.join(ROOT, 'red-build');
const { importImudSettings } = require(path.join(RB, 'src/engine/core/legacy-settings-map'));
const { getSettingDefs, getDefaultSettings } = require(path.join(RB, 'src/engine/core/settings-registry'));
const { registerFont } = require(path.join(RB, 'src/engine/typography/measure-api'));
const { typeset } = require(path.join(RB, 'src/engine/core/pipeline'));

const file = process.argv[2] || path.join(RB, 'tests/fixtures/canonical_corpus.txt');
const text = fs.readFileSync(file, 'utf8');
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
  return { ...getDefaultSettings(), ...imp.settings, 'body-font': 'Guttman Rashi', 'measure-impl': 'font-metrics' };
}
registerAllFonts();
const uniSettings = (() => { const s2 = { ...legacySettings() }; delete s2['_layout-profile']; delete s2['_imudRaw']; return s2; })();
const r = typeset(text, uniSettings, {});
if (r.legacyProfile) { console.error('נפל למורשת'); process.exit(2); }

const normWords = (s) => String(s == null ? '' : s).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[\ue000-\uf8ff]/g, ' ').replace(/[[\]]/g, ' ').split(/\s+/).filter(Boolean);
let spanningWords = 0, spanningSamples = [], gateLineWords = 0, bandWords = 0;
let pagesWithSpanning = 0;
for (const pg of r.pages) {
  if (pg.spanning && pg.spanning.lines && pg.spanning.lines.length) {
    pagesWithSpanning++;
    for (const ln of pg.spanning.lines) {
      const words = normWords((ln.words || []).join(' '));
      spanningWords += words.length;
      if (spanningSamples.length < 12) spanningSamples.push(words.join(' ').slice(0, 70));
    }
  }
  for (const gl of (pg.gateLines || [])) gateLineWords += normWords(gl && gl.text).length;
  for (const b of (pg.bands || [])) bandWords += normWords(b && b.text).length;
}
console.log(`עמודים: ${r.pages.length}, עם spanning: ${pagesWithSpanning}`);
console.log(`מילים ב-spanning.lines: ${spanningWords}`);
console.log(`מילים ב-gateLines: ${gateLineWords}`);
console.log(`מילים ב-bands: ${bandWords}`);
console.log('\nדוגמאות spanning:');
for (const s of spanningSamples) console.log(`  - ${s}`);
// pageModel קיים?
console.log(`\npageModel: ${r.pageModel ? `כן (${r.pageModel.pages ? r.pageModel.pages.length : '?'} עמודים)` : 'לא'}`);
