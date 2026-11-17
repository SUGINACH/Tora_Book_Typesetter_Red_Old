#!/usr/bin/env node
// tools/stage9/diff-h7-grammar.js — השוואת סיווג שורות בין שני הטוקנייזרים
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const RB = path.join(ROOT, 'red-build');
const file = process.argv[2] || path.join(RB, 'tests/fixtures/canonical_corpus.txt');
const text = fs.readFileSync(file, 'utf8');

// הדקדוק המאוחד (dfa-lexer HEADING_RE + block-tokenizer)
const HEADING_RE = /^(כותרת\s*([0-7])|חלק\s+([א-ת]+)|הקדמה)\s*[-–—]\s*(.+)$/;
// הדקדוק המורשת (tokenizeDoc hMatch)
const hMatchRe = /^כותרת\s*(\d+)(?:\s+מספר\s+(\d+))?.*?[-–—]\s*(.*)$/;

const lines = text.replace(/\r\n?/g, '\n').split('\n');
let legacySide = 0, unifiedH7 = 0, legacySideNotUnified = 0, unifiedH7NotLegacy = 0;
const samples = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const lm = line.match(hMatchRe);
  const um = line.match(HEADING_RE);
  const legacyIsSide = !!(lm && Number(lm[1]) === 7); // HEADING_MODES[7]='side_note' תמיד במורשת
  const unifiedIsH7 = !!(um && um[2] !== undefined && Number(um[2]) === 7);
  if (legacyIsSide) legacySide++;
  if (unifiedIsH7) unifiedH7++;
  if (legacyIsSide && !unifiedIsH7) { legacySideNotUnified++; if (samples.length < 15) samples.push({ line: i + 1, text: line.slice(0, 100) }); }
  if (unifiedIsH7 && !legacyIsSide) { unifiedH7NotLegacy++; if (samples.length < 15) samples.push({ line: i + 1, text: '[U] ' + line.slice(0, 100) }); }
}
console.log(`שורות מקור: ${lines.length}`);
console.log(`מורשת-מסווג-הערת-צד (כותרת 7): ${legacySide}`);
console.log(`מאוחד-מסווג-H7: ${unifiedH7}`);
console.log(`מורשת-בלבד (צד, לא H7 במאוחד): ${legacySideNotUnified}`);
console.log(`מאוחד-בלבד: ${unifiedH7NotLegacy}`);
console.log('\nדוגמאות לחוסר התאמה:');
for (const s of samples) console.log(`  שורה ${s.line}: ${s.text}`);
