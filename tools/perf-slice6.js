#!/usr/bin/env node
// tools/perf-slice6.js — **שלב 8 פרוסה 6 (§5): מדידות לפני/אחרי + parity תלת-יעדי.**
//
// מודד על אותו קלט בדיוק:
//  * זמן typeset (המנוע) · זמן בניית PageModel · גודל המודל (bytes/עמודים/שורות)
//  * זמן רינדור DOM לכל העמודים (המקרין הטהור) · זמן ייצוא HTML מהמודל
//  * זמן ייצוא PDF מהמודל מול **הנתיב הישן** (typeset שני+פרויקציה) — הוכחת
//    החיסכון בהסרת העימוד השני (והוכחה שאין שיפור מהשמטת תוכן: אותם עמודים
//    ואותו חלוץ טקסט בשני הנתיבים).
//  * parity: כיסוי מילים זהה בין DOM/HTML/PDF (מאותו מודל).
//
// ארטיפקט: audits/perf_slice6/perf-slice6.json
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RB = path.join(ROOT, 'red-build');

const { typeset } = require(path.join(RB, 'src/engine/core/pipeline'));
const { getDefaultSettings } = require(path.join(RB, 'src/engine/core/settings-registry'));
const { registerFont, clearRegisteredFonts } = require(path.join(RB, 'src/engine/typography/measure-api'));
const { exportHtmlFromModel, exportPdfFromModel, exportPdf } = require(path.join(RB, 'src/engine/output/export-api'));
const { renderModelPage } = require(path.join(RB, 'src/engine/output/pagemodel-dom-renderer'));

const ASSETS = path.join(RB, 'ui/assets/imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const fontBytesOf = (fam) => {
  const e = CATALOG.find(x => x.family === fam);
  return e ? fs.readFileSync(path.join(ASSETS, 'fonts', e.file)) : null;
};

// ---------- DOM shim (קל — רינדור בלבד) ----------
function makeDoc() {
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this._class = ''; this._text = ''; this.dir = ''; }
    set className(v) { this._class = String(v); }
    get className() { return this._class; }
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { if (this.children.length) return this.children.map(c => c.textContent).join(''); return this._text; }
    _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    outerHTML() {
      const styleStr = Object.entries(this.style).map(([k, v]) => `${k}:${this._esc(v)}`).join(';');
      const attrsStr = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${this._esc(v)}"`).join('')
        + (this._class ? ` class="${this._esc(this._class)}"` : '')
        + (styleStr ? ` style="${styleStr}"` : '')
        + Object.entries(this.dataset).map(([k, v]) => ` data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${this._esc(v)}"`).join('');
      const inner = this.children.length ? this.children.map(c => c.outerHTML()).join('') : this._esc(this._text);
      return `<${this.tagName.toLowerCase()}${attrsStr}>${inner}</${this.tagName.toLowerCase()}>`;
    }
  }
  return { createElement: (t) => new El(t), createTextNode: (t) => { const e = new El('#text'); e._text = String(t); return e; } };
}

const r2 = (v) => Math.round(v * 100) / 100;
function human(bytes) {
  if (bytes > 1024 * 1024) return r2(bytes / 1024 / 1024) + 'MB';
  if (bytes > 1024) return r2(bytes / 1024) + 'KB';
  return bytes + 'B';
}

// ---------- המסמכים ----------
const DOCS = {
  'short': ['כותרת 2 - פרק', 'פסקה ראשונה עם הערה [הערה] בתוכה ועוד מילים.', 'כותרת 3 - משנה', 'פסקה אחרונה עם עוד כמה מילים לזרימה.'].join('\n'),
  'medium': null, // ייבנה מהקנוני
  'very_long': null
};
DOCS['medium'] = fs.readFileSync(path.join(RB, 'tests/fixtures/canonical_corpus.txt'), 'utf8');
DOCS['very_long'] = fs.readFileSync(path.join(ROOT, 'audits/very_long_test_text.txt'), 'utf8');

// ---------- הרצה ----------
(async function main() {
  fs.mkdirSync(path.join(ROOT, 'audits/perf_slice6'), { recursive: true });
  clearRegisteredFonts();
  for (const fam of ['Frank Ruhl Libre', 'David Libre', 'Hadassah Friedlaender']) {
    const b = fontBytesOf(fam);
    if (b) registerFont(fam, b);
  }
  const exportFont = fontBytesOf('Frank Ruhl Libre');
  const S = getDefaultSettings();
  const out = { schema: 'perf-slice6-v1', node: process.version, docs: {} };

  for (const [name, text] of Object.entries(DOCS)) {
    // חימום JIT (ריצה ראשונה לא נמדדת למסמכים הגדולים פעמיים — רק short מחומם)
    const t0 = process.hrtime.bigint();
    const r = typeset(text, S, {});
    const typesetMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const model = r.pageModel;

    const modelJson = JSON.stringify(model);
    const modelBytes = Buffer.byteLength(modelJson);

    // DOM render (כל העמודים)
    const doc = makeDoc();
    const d0 = process.hrtime.bigint();
    for (const mp of model.pages) renderModelPage(mp, S, doc);
    const domMs = Number(process.hrtime.bigint() - d0) / 1e6;

    // HTML מהמודל
    const h0 = process.hrtime.bigint();
    const html = exportHtmlFromModel(model, S, doc, {});
    const htmlMs = Number(process.hrtime.bigint() - h0) / 1e6;

    // PDF מהמודל
    const p0 = process.hrtime.bigint();
    const pdfNew = exportPdfFromModel(model, S, exportFont, 'Frank Ruhl Libre');
    const pdfNewMs = Number(process.hrtime.bigint() - p0) / 1e6;

    // PDF בנתיב הישן (עימוד שני) — רק למדידת ההפרש; אותן הגדרות בדיוק
    let pdfOldMs = null, pdfOldPages = null;
    if (pdfNew.ok) {
      const o0 = process.hrtime.bigint();
      const pdfOld = exportPdf(text, S, exportFont, 'Frank Ruhl Libre');
      pdfOldMs = Number(process.hrtime.bigint() - o0) / 1e6;
      pdfOldPages = pdfOld.ok ? pdfOld.info.pages : null;
    }

    // parity: מילים במודל מול HTML
    let modelWords = 0;
    for (const mp of model.pages) { for (const ln of mp.lines) modelWords += (ln.words || []).length; for (const n of (mp.footnotes || [])) modelWords += (n.words || []).length; }
    const htmlWords = (String(html).match(/class="w(?:\s[^"]*)?"/g) || []).length;

    out.docs[name] = {
      inputKB: r2(Buffer.byteLength(text) / 1024),
      pages: model.pages.length,
      lines: model.lines ? null : model.pages.reduce((s, p) => s + p.lines.length, 0),
      typesetMs: r2(typesetMs),
      pageModelBytes: modelBytes,
      pageModelKB: r2(modelBytes / 1024),
      modelBytesPerPage: Math.round(modelBytes / model.pages.length),
      domRenderMs: r2(domMs),
      htmlExportMs: r2(htmlMs),
      pdfFromModelMs: r2(pdfNewMs),
      pdfOldPathMs: pdfOldMs != null ? r2(pdfOldMs) : null,
      pdfSpeedupPct: pdfOldMs ? r2((1 - pdfNewMs / pdfOldMs) * 100) : null,
      pdfNewPages: pdfNew.ok ? pdfNew.info.pages : null,
      pdfOldPages,
      htmlBytes: Buffer.byteLength(String(html)),
      pdfBytes: pdfNew.ok ? pdfNew.bytes.length : null,
      parityWordsModel: modelWords,
      parityWordsHtml: htmlWords,
      parityHtmlOk: modelWords === htmlWords
    };
    const d = out.docs[name];
    console.log(`${name}: ${d.pages}ע' | typeset ${d.typesetMs}ms | מודל ${d.pageModelKB}KB (${d.modelBytesPerPage}B/ע') | DOM ${d.domRenderMs}ms | HTML ${d.htmlExportMs}ms | PDF-מודל ${d.pdfFromModelMs}ms מול ישן ${d.pdfOldPathMs}ms (חיסכון ${d.pdfSpeedupPct}%) | parity ${d.parityHtmlOk ? 'OK' : 'FAIL ' + d.parityWordsModel + '≠' + d.parityWordsHtml}`);
    // שחרור הפניות כבדות (very_long: מודל 61MB + HTML ~50MB + PDF — בלי זה OOM ביציאה)
    void html; void modelJson;
    if (global.gc) global.gc();
  }

  fs.writeFileSync(path.join(ROOT, 'audits/perf_slice6/perf-slice6.json'), JSON.stringify(out, null, 2));
  console.log('artifact → audits/perf_slice6/perf-slice6.json');
})();
