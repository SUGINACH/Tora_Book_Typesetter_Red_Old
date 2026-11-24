// tests/regress/r03-paren-note-flags.test.js — R-03 (יובא מ-Red PR #48): דגלי סוגריים
// של מילה עם סמן הערה מודבק + דליפת מונה העומק.
//
// **השורש (מאומת ב-Work_2 לפני התיקון):** ב-breakPara, מילה שנושאת סמן מודבק
// ('רשות)[הערה]') קיבלה דגלי סוגריים מאופסים וה-')' שלפני הסמן לא הוריד את
// מונה העומק — הדלפה שסימנה את שאר הפסקה "בתוך סוגריים" (מדידה מוקטנת שגויה
// ב-10pt ושבירה מוטה). התיקון: מונה העומק והדגלים מחושבים גם למילת-הסמן
// (הרוחב המדויק dispW נשמר); הערה עצמאית ([...] לבדה) — דגלים כבעבר.
//
// **הבדיקה:** משפחות מיקום שונות של הסמן מול הסוגריים; הערה עם סוגריים בתוכה;
// סוגריים שממשיכים אחרי מילת הסמן. הקביעה מתבצעת על הפלט האמיתי של המנוע
// (parenFlags לכל מילה מוקרנת — S4.19: הדגל עובר לכל חלקי המילה; הסמן עצמו
// אינו טקסט-סוגריים) מול ציפיות שחושבו בנפרד מהמקור.
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, it, assert, assertEq, report } = require('../harness');

const { legacyTypeset } = require('../../src/engine/layout/legacy-imud-flow');
const { importImudSettings } = require('../../src/engine/core/legacy-settings-map');
const { getDefaultSettings, getSettingDefs } = require('../../src/engine/core/settings-registry');
const { registerFont, clearRegisteredFonts } = require('../../src/engine/typography/measure-api');

const ASSETS = path.join(__dirname, '..', '..', 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const LEGACY_DEFAULTS = JSON.parse(fs.readFileSync(path.join(ASSETS, 'default_settings.json'), 'utf8'));
const bytesOf = (fam) => { const e = CATALOG.find(x => x.family === fam); return e ? fs.readFileSync(path.join(ASSETS, 'fonts', e.file)) : null; };

function imudSettings() {
  const available = new Set(CATALOG.map(e => e.family));
  const { settings } = importImudSettings(LEGACY_DEFAULTS, new Set(getSettingDefs().map(r => r.id)), { availableFonts: available });
  return Object.assign({}, getDefaultSettings(), settings);
}
function registerCoreFonts(s) {
  clearRegisteredFonts();
  const fams = new Set([s['body-font'], 'FrankReal', 'DavidLibre-Bold',
    'Hadassah Friedlaender', 'Frank Ruhl Libre', 'David Libre',
    s['f-note-body-font']].filter(Boolean));
  for (const f of fams) { const b = bytesOf(f); if (b) registerFont(f, b); }
}

/** כל שורות הגוף המוקרנות — מילה + דגל סוגריים, לפי סדר הופעה. */
function wordFlagPairs(result) {
  const pairs = [];
  for (const pg of result.pages) {
    for (const col of (pg.columns || [])) {
      for (const u of col) {
        if (u.kind === 'paragraph' && u.parenFlags) {
          for (let i = 0; i < u.words.length; i++) pairs.push([String(u.words[i]), !!u.parenFlags[i]]);
        }
      }
    }
  }
  return pairs;
}

/**
 * מודל ציפיות עצמאי (מיני-אורקל): דגל-סוגריים לכל מילת גוף מהמקור.
 * ההערה [...] אטומה — תוויה אינם נספרים לעומק; קידומת/סיומת של המילה
 * הנושאת את הסמן נספרות כרגיל. מילה שכולה הערה = הסמן (false).
 */
function expectedFlags(sourceLine) {
  const noteRe = /\[[^\]]*\]/g;
  const notes = [];
  let m;
  while ((m = noteRe.exec(sourceLine))) notes.push({ start: m.index, end: m.index + m[0].length });
  const inNote = (i) => notes.some(n => i >= n.start && i < n.end);
  const words = [];
  let cur = '', curHasBodyParen = false, curIsPureNote = true;
  let depth = 0;
  const flush = () => {
    if (!cur) return;
    words.push({ text: cur, flag: curIsPureNote ? false : curHasBodyParen });
    cur = ''; curHasBodyParen = false; curIsPureNote = true;
  };
  for (let i = 0; i < sourceLine.length; i++) {
    const ch = sourceLine[i];
    if (/\s/.test(ch)) { flush(); continue; }
    if (inNote(i)) { cur += ch; continue; }
    cur += ch; curIsPureNote = false;
    if (ch === '(') depth++;
    if (depth > 0) curHasBodyParen = true;
    if (ch === ')' && depth > 0) depth--;
  }
  flush();
  return words;
}

const FAMILIES = [
  ['סמן מודבק למילת הסגירה (הדלפה הקלאסית)', 'גוף א (ב ג רשות)[מקור] ד ה ו ז ט י כ', [
    ['גוף', false], ['א', false], ['(ב', true], ['ג', true], ['רשות)', true], ['ד', false], ['ה', false], ['ו', false], ['ז', false], ['ט', false], ['י', false], ['כ', false]
  ]],
  ['סמן מודבק למילה בתוך הטווח', 'גוף א (ב ג[הערה] ד) ה ו', [
    ['גוף', false], ['א', false], ['(ב', true], ['ג', true], ['ד)', true], ['ה', false], ['ו', false]
  ]],
  ['סוגריים שממשיכים אחרי מילת הסמן', 'גוף (א ב)[מקור] (ג ד) ה', [
    ['גוף', false], ['(א', true], ['ב)', true], ['(ג', true], ['ד)', true], ['ה', false]
  ]],
  ['הערה עם סוגריים בתוכה — הסמן אטום', 'גוף א ב[הערה (עם סוגריים) בפנים] ג ד', [
    ['גוף', false], ['א', false], ['ב', false], ['ג', false], ['ד', false]
  ]],
  ['הערה עצמאית — דגלים כבעבר, בלי השפעה על העומק', 'גוף א (ב ג) [הערה] ד', [
    ['גוף', false], ['א', false], ['(ב', true], ['ג)', true], ['ד', false]
  ]],
  ['סוגריים מקוננים סביב מילת סמן', 'גוף (א (ב ג) ד)[מקור] ה', [
    ['גוף', false], ['(א', true], ['(ב', true], ['ג)', true], ['ד)', true], ['ה', false]
  ]]
];

describe('R-03 — דגלי סוגריים של מילה עם סמן הערה מודבק (יובא מ-Red PR #48)', () => {

  it('מודל הציפיות העצמאי — עקביות פנימית', () => {
    const noParens = expectedFlags('א ב[נ] ג');
    assert(noParens.every(w => !w.flag), 'בלי סוגריים בגוף — אף דגל');
    const unclosed = expectedFlags('א (ב ג ד');
    assertEq(unclosed.filter(w => w.flag).length, 3, 'סוגריים לא-מאוזנים: שאר המילים בטווח (כמו המנוע)');
  });

  for (const [name, line, expect] of FAMILIES) {
    it(`משפחה: ${name}`, () => {
      const s = imudSettings();
      registerCoreFonts(s);
      const doc = 'כותרת 2 - פרק הבדיקה\n' + line + '\nטקסט סיום אמיתי.\n';
      const r = legacyTypeset(doc, s, {});
      clearRegisteredFonts();
      assert(r.contentPreserved === true, 'שימור תוכן נפגע');
      const pairs = wordFlagPairs(r);
      const firstIdx = pairs.findIndex(([w]) => w === 'גוף');
      assert(firstIdx >= 0, 'שורת הבדיקה לא נמצאה בפלט');
      // הסמן (גימטריה+נקודה, עד 3 תווים) אינו טקסט-סוגריים — דלג עליו
      const isMarker = (w) => /^[א-ת]{1,2}\.$/.test(w);
      const got = [];
      for (let i = firstIdx; i < pairs.length && pairs[i][0] !== 'טקסט'; i++) {
        if (isMarker(pairs[i][0])) continue;
        got.push(pairs[i]);
      }
      assertEq(got.length, expect.length, `מספר מילים שונה: got=${JSON.stringify(got.map(g => g[0]))}`);
      for (let i = 0; i < expect.length; i++) {
        assertEq(got[i][0], expect[i][0], `מילה ${i} שונה (got='${got[i][0]}')`);
        assertEq(got[i][1], expect[i][1], `דגל סוגריים של '${expect[i][0]}' שגוי (קיבל ${got[i][1]}, ציפה ${expect[i][1]})`);
      }
    });
  }

  it('fixture הטריגר של Red: הדלפה נעלמה — דגלי המנוע תואמים למודל בשורות המושפעות', () => {
    const p = path.join(__dirname, '..', 'fixtures', 'regress', 'paren-note-trigger.txt');
    const raw = fs.readFileSync(p, 'utf8');
    const affected = raw.split('\n').filter(ln => /\)\[/.test(ln));
    assert(affected.length >= 1, 'תנאי הבדיקה: יש שורת טריגר');
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(raw, s, {});
    clearRegisteredFonts();
    assert(r.contentPreserved === true, 'שימור תוכן ב-fixture');
    const pairs = wordFlagPairs(r);
    const isMarker = (w) => /^[א-ת]{1,2}\.$/.test(w);
    for (const ln of affected) {
      const exp = expectedFlags(ln);
      // עוגן ייחודי: מילת פתיחת הטווח '(' (מילת-החלון של הפסקה עלולה להפריד בין
      // מילת הפתיחה של השורה לבין שאר המילים — לכן לא מיושר לפי המילה הראשונה).
      const expAnchor = exp.findIndex(w => w.text.includes('('));
      assert(expAnchor >= 0, 'תנאי ההשוואה: יש פותח-טווח בשורת הטריגר');
      const anchorWord = exp[expAnchor].text;
      const engAnchor = pairs.findIndex(([w]) => w === anchorWord);
      assert(engAnchor >= 0, `מילת העוגן '${anchorWord}' לא נמצאה בפלט`);
      let k = engAnchor;
      for (let e = expAnchor; e < exp.length; e++) {
        while (k < pairs.length && isMarker(pairs[k][0])) k++;
        if (k >= pairs.length) break;
        assertEq(pairs[k][1], exp[e].flag, `fixture: דגל '${exp[e].text}' (קיבל ${pairs[k][1]}, ציפה ${exp[e].flag}) [שורה: ${ln.slice(0, 30)}…]`);
        k++;
      }
    }
  });

  it('שליטה (אותו קורפוס בלי סמן מודבק): ריצה תקינה ושימור תוכן', () => {
    const p = path.join(__dirname, '..', 'fixtures', 'regress', 'paren-note-control.txt');
    const raw = fs.readFileSync(p, 'utf8');
    const s = imudSettings();
    registerCoreFonts(s);
    const r = legacyTypeset(raw, s, {});
    clearRegisteredFonts();
    assert(r.contentPreserved === true, 'שימור תוכן בשליטה');
    assert(r.pages.length > 0, 'הפלט ריק');
  });
});

report('r03-paren-note-flags');
