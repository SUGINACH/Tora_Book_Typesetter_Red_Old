// tests/e2e/s9c-cutover.test.js — שלב 9c פרוסה 9c.4: cutover למנוע יחיד.
// הוכחות הקבלה (§6.3 בהוראה): אין עוד מסלול runtime פעיל של legacyTypeset,
// renderPage (הרנדרר הישן), exportHtml הישן, exportPdf הישן או page.legacy —
// בכל נקודות הכניסה של המוצר. בדיקות שליליות (patch-זורק) + סריקת מקור.
'use strict';

const path = require('path');
const fs = require('fs');
const { describe, it, assert, assertEq, report } = require('../harness');

const RB = path.join(__dirname, '..', '..');
const pipeline = require('../../src/engine/core/pipeline');
const legacyFlow = require('../../src/engine/layout/legacy-imud-flow');
const domRenderer = require('../../src/engine/output/dom-renderer');
const exportApi = require('../../src/engine/output/export-api');
const { serializeTypesetResult } = require('../../src/ui/worker-protocol');
const { importImudSettings } = require('../../src/engine/core/legacy-settings-map');
const { getSettingDefs, getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { createApp } = require('../../src/ui/app-shell');
const { createInlineTransport } = require('../../src/ui/inline-transport');

const DOC = ['שם הספר - ספר ה-cutover', '', 'כותרת 1 - חלק ראשון',
  'פסקה ראשונה עם הערה [הערת גוף לבדיקת ה-cutover] בגוף. ' + 'מילים למילוי הטור ולעמוד '.repeat(10),
  'פסקה שנייה עם עוד מילים. ' + 'תוכן נוסף לבדיקה '.repeat(8)].join('\n');

function makeDoc() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  class ClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...ns) { ns.forEach(n => this.set.add(n)); }
    remove(...ns) { ns.forEach(n => this.set.delete(n)); }
    contains(n) { return this.set.has(n); }
    toggle(n, force) { const want = force === undefined ? !this.set.has(n) : !!force; if (want) this.set.add(n); else this.set.delete(n); return want; }
  }
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {};
      this.style = {}; this._class = ''; this._text = '';
      this.classList = new ClassList(this); this._listeners = new Map();
      this.value = ''; this.checked = false; this.disabled = false; this.type = ''; this.title = '';
    }
    set className(v) { this._class = String(v); } get className() { return this._class; }
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, cb) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(cb); }
    dispatchEvent(ev) {
      ev = ev || {}; ev.target = ev.target || this; ev.type = ev.type || 'click';
      ev.preventDefault = ev.preventDefault || (() => {}); ev.stopPropagation = ev.stopPropagation || (() => {});
      let node = this;
      while (node) { for (const cb of (node._listeners.get(ev.type) || []).slice()) cb(ev); node = node.parentNode; }
      return true;
    }
    click() { this.dispatchEvent({ type: 'click' }); }
    scrollIntoView() { this._scrolled = true; }
    outerHTML() {
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const attrsStr = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')
        + (this._class ? ` class="${esc(this._class)}"` : '');
      const inner = this.children.length ? this.children.map(c => c.outerHTML()).join('') : esc(this._text);
      return `<${this.tagName.toLowerCase()}${attrsStr}>${inner}</${this.tagName.toLowerCase()}>`;
    }
    _matches(sel) { return String(sel).startsWith('.') ? this.classList.contains(sel.slice(1)) : this.tagName === sel.toUpperCase(); }
    querySelectorAll(sel) {
      const out = [];
      (function walk(el) { for (const c of el.children) { if (c._matches && c._matches(sel)) out.push(c); walk(c); } })(this);
      return out;
    }
  }
  return { createElement: (tag) => new El(tag) };
}

/** הפעלת patch-זורק סביב פונקציה — כל קריאה אליה תזרוק. */
function withThrowing(obj, key, label, fn) {
  const orig = obj[key];
  let calls = 0;
  obj[key] = function () { calls++; throw new Error(`אסור קריאה ל${label} במוצר (9c.4 cutover)`); };
  try {
    const out = fn();
    return { out, calls };
  } finally {
    obj[key] = orig;
  }
}

describe('s9c-cutover — מנוע יחיד: הוכחות קבלה (§6.3)', () => {

  it('typeset אינו מפנה עוד למורשת — גם כשההגדרות נושאות את הדגלים הישנים', () => {
    const S = getDefaultSettings();
    // קלט ישן (פרויקט שנשמר לפני ה-cutover) עדיין נושא את הדגלים — הם מתכוננים
    // לנתונים מתים: ה-dispatch הוסר. ההרצה מאוחדת.
    const oldStyle = { ...S, '_layout-profile': 'imud', _imudRaw: { 'size-body': 14 } };
    const r = pipeline.typeset(DOC, oldStyle, {});
    assert(r.legacyProfile !== true, 'ההרצה מאוחדת גם עם דגלי קלט ישנים');
    assert(!!r.pageModel, 'PageModel קיים');
  });

  it('importImudSettings: adapter ערכים בלבד — אין _layout-profile ואין _imudRaw בהגדרות', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
    const { settings } = importImudSettings(raw, new Set(getSettingDefs().map(r => r.id)), {});
    assert(!('_layout-profile' in settings), 'אין דגל פרופיל בהגדרות המיובאות');
    assert(!('_imudRaw' in settings), 'אין raw מוצמד להגדרות המיובאות');
    // הערכים עצמם נשמרים (D-107): גוף, גדלים, TOC
    assert(typeof settings['body-font'] === 'string' && settings['body-font'], 'גופן הגוף מיובא');
    assert(settings['toc-level-1-show'] === true, 'דגלי TOC נגזרים (D-107)');
  });

  it('הפרוטוקול: אין עוד שדה legacyProfile ב-serializeTypesetResult', () => {
    const r = pipeline.typeset(DOC, getDefaultSettings(), {});
    const serialized = serializeTypesetResult(r);
    assert(!('legacyProfile' in serialized), 'השדה הוסר מהפרוטוקול');
    assert(!!serialized.pageModel, 'המודל עובר בפרוטוקול');
  });

  it('הוכחה שלילית מרובעת: patch-זורק על legacyTypeset/renderPage/exportHtml/exportPdf — האפליקציה מלאה עובדת', () => {
    const doc = makeDoc();
    const app = createApp(doc, { transport: createInlineTransport() });
    app.setText(DOC);
    // 1. עימוד עם patch-זורק על legacyTypeset
    let res = withThrowing(legacyFlow, 'legacyTypeset', 'legacyTypeset', () => app.onExplicitRetypeset());
    assertEq(res.calls, 0, 'אפס קריאות legacyTypeset בעימוד');
    return new Promise(resolve => setTimeout(() => {
      assert(app.getState().hasResult, 'יש תוצאה');
      assert(!!app.pageModel(), 'PageModel התקבל');
      assertEq(app.getState().pages, app.pageModel().pages.length, 'המחוון מהמודל');
      const pages = app.preview.root.querySelectorAll('.preview-page');
      assertEq(pages.length, app.pageModel().pages.length, 'התצוגה מהמודל');
      // 2+3. ייצוא HTML ו-PDF עם patch-זורק על הפונקציות הישנות — קודם,
      // כשהמצב נקי (הרינדור-הקל מסמן dirty עד השלמתו).
      res = withThrowing(exportApi, 'exportHtml', 'exportHtml הישן', () => app.exportRequest('html'));
      assertEq(res.calls, 0, 'אפס קריאות exportHtml הישן');
      assert(res.out && res.out.ok === true, 'HTML מהמודל הצליח: ' + JSON.stringify(res.out && res.out.reason));
      assert(String(res.out.data).includes('page-0'), 'עמודי המודל בתוצר');
      res = withThrowing(exportApi, 'exportPdf', 'exportPdf הישן', () => app.exportRequest('pdf'));
      assertEq(res.calls, 0, 'אפס קריאות exportPdf הישן (הסירוב המקומי הוא no-embedded-font — לא נתיב מורשת)');
      // 4. רינדור-קל עם patch-זורק על renderPage הישן (אחרי הייצוא — לא מסמן dirty
      // שחוסם ייצוא) — ואז המתנה להשלמתו.
      res = withThrowing(domRenderer, 'renderPage', 'renderPage הישן', () => app.scheduleLightRefresh());
      assertEq(res.calls, 0, 'אפס קריאות renderPage ברינדור-קל');
      setTimeout(() => {
        assert(app.preview.root.querySelectorAll('.preview-page').length === app.pageModel().pages.length, 'התצוגה אחרי רינדור-קל עדיין מהמודל');
        resolve();
      }, 500);
    }, 400));
  });

  it('סריקת מקור: נקודות הכניסה של המוצר נקיות מנתיבי מורשת runtime', () => {
    const entryPoints = [
      'src/ui/browser-entry.js',
      'src/ui/app-shell.js',
      'src/ui/preview-tab.js',
      'src/ui/engine-worker-main.js',
      'src/ui/worker-protocol.js',
    ];
    for (const f of entryPoints) {
      const src = fs.readFileSync(path.join(RB, f), 'utf8');
      assert(!/legacyTypeset/.test(src), `${f}: אין legacyTypeset`);
      assert(!/require\('\.\.\/engine\/output\/dom-renderer'\)/.test(src), `${f}: אין ייבוא dom-renderer (renderPage)`);
      assert(!/exportHtml\(result/.test(src), `${f}: אין exportHtml הישן`);
      assert(!/exportPdf\(text/.test(src) && !/exportPdf\(msg\.text/.test(src), `${f}: אין exportPdf הישן`);
      assert(!/legacyProfile/.test(src), `${f}: אין legacyProfile`);
      assert(!/page\.legacy/.test(src), `${f}: אין page.legacy`);
      assert(!/'_layout-profile'/.test(src), `${f}: אין _layout-profile`);
    }
    // ה-pipeline עצמו — אין dispatch
    const pipe = fs.readFileSync(path.join(RB, 'src/engine/core/pipeline.js'), 'utf8');
    assert(!pipe.includes("require('../layout/legacy-imud-flow')"), 'pipeline: אין הפניה למנוע המורשת');
    assert(!pipe.includes("_layout-profile"), 'pipeline: אין קריאת דגל פרופיל');
  });

  it('שרשרת ה-cutover המלאה: ייבוא IMUD ⇒ ערכים מאוחדים ⇒ עימוד מאוחד ⇒ מודל ⇒ מקרינים', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(RB, 'ui/assets/imud/default_settings.json'), 'utf8'));
    const { settings } = importImudSettings(raw, new Set(getSettingDefs().map(r => r.id)), {});
    const r = pipeline.typeset(DOC, settings, {});
    assert(r.legacyProfile !== true, 'עימוד מאוחד בהגדרות המקור המיובאות');
    assert(!!r.pageModel, 'PageModel קיים');
    assert(r.contentPreserved === true, 'שימור תוכן בהגדרות המקור');
    // המודל נושא את הערה שבמקור (עוגן + גוף במרזב)
    let noteSeen = false;
    for (const mp of r.pageModel.pages) if ((mp.footnotes || []).length) noteSeen = true;
    assert(noteSeen, 'הערת הגוף הגיעה למודל');
  });
});

report();
