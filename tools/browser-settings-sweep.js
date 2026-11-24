// _sweep_harness.js — בדיקת חיווט: כל הגדרות הפאנל ← השפעה על המסמך (Red_Old)
// מופעל ידנית מהקונסולה/‏agent-browser; אינו חלק מהאפליקציה.
(function () {
  'use strict';
  const LIGHT_KEYS = new Set(['background-color','background-opacity','background-image','background-texture','background-inset-mm','footnote-separator-rule','body-last-line-align']);
  const fnv = function (s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(16); };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const app = function () { return window.__toraApp; };

  function patchStatus() {
    const a = app();
    if (!window.__engStatePatched) {
      const orig = a.status.setEngineState.bind(a.status);
      window.__engState = { state: 'idle', info: null };
      a.status.setEngineState = function (state, info) { window.__engState = { state: state, info: info || null }; orig(state, info); };
      window.__engStatePatched = true;
    }
  }

  const ctrl = function (key) { return document.querySelector('.ctl[data-key="' + key + '"]'); };

  function getDomVal(el) {
    if (el.tagName === 'SELECT') return el.value;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return Number(el.value);
    return el.value;
  }
  function setDomVal(el, v) {
    if (el.tagName === 'SELECT') el.value = String(v);
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function normEq(a, b) {
    if (a == null || b == null) return String(a) === String(b);
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' || tb === 'number') { const na = Number(a), nb = Number(b); return (Number.isFinite(na) && Number.isFinite(nb)) ? na === nb : String(a) === String(b); }
    if (ta === 'boolean' || tb === 'boolean') return !!a === !!b;
    return String(a) === String(b);
  }
  const settingsVal = function (key) { return app().getSettings()[key]; };

  async function waitEngine(timeoutMs, genBefore) {
    const a = app();
    const t0 = Date.now();
    // המתן להשלמת עימוד לפי מונה הדור (gen) או שגיאה; המנוע מהיר (~60ms) ועלול
    // לסיים בין poll-ים — לכן gen הוא מקור האמת, לא busy.
    const deadline = Date.now() + timeoutMs;
    let sawBusy = false;
    while (Date.now() < deadline) {
      if (a.engine.busy) sawBusy = true;
      const st = a.getState();
      if (genBefore != null && st.gen > genBefore) return { ran: true, timeout: false, sawBusy };
      if (genBefore == null && !a.engine.busy && window.__engState.state !== 'working' && Date.now() - t0 > 700) return { ran: sawBusy, timeout: false, sawBusy };
      if (window.__engState.state === 'error') return { ran: true, timeout: false, error: true };
      await sleep(25);
    }
    return { ran: sawBusy, timeout: true, sawBusy };
  }

  function clickRetypeset() {
    const btn = [...document.querySelectorAll('button')].find(function (b) { return (b.textContent || '').indexOf('עדכן ועמד') >= 0; });
    if (btn && !btn.disabled) btn.click();
    else app().onExplicitRetypeset();
  }

  async function capture() {
    const a = app();
    const st = a.getState();
    let hh = null, exErr = null;
    try {
      const ex = a.exportRequest('html');
      if (ex && ex.ok) hh = fnv(ex.data);
      else exErr = ex ? (ex.reason || 'not-ok') : 'null';
    } catch (e) { exErr = String((e && e.message) || e); }
    return {
      pages: st.pages, lh: st.layoutHash, hh: hh,
      eng: window.__engState.state,
      err: window.__engState.state === 'error' ? String((window.__engState.info && (window.__engState.info.message || window.__engState.info.label)) || 'error') : (exErr || null)
    };
  }
  const changedVs = function (cap, base) { return cap.pages !== base.pages || cap.lh !== base.lh || cap.hh !== base.hh; };

  function buildPlan() {
    const seen = new Map();
    for (const el of document.querySelectorAll('.ctl[data-key]')) {
      if (!seen.has(el.dataset.key)) seen.set(el.dataset.key, el);
    }
    const heavy = [], light = [];
    for (const entry of seen) {
      const key = entry[0], el = entry[1];
      const bucket = LIGHT_KEYS.has(key) ? light : heavy;
      if (el.tagName === 'SELECT') {
        const cur = el.value;
        const options = [...el.options];
        const isFont = options.length > 20;
        let alts;
        if (isFont) {
          const emb = options.filter(function (o) { return o.value !== cur && String(o.textContent || '').indexOf('קטלוג') < 0; });
          alts = emb.slice(0, 3).map(function (o) { return o.value; });
          if (!alts.length) alts = options.filter(function (o) { return o.value !== cur; }).slice(0, 1).map(function (o) { return o.value; });
        } else {
          alts = options.filter(function (o) { return o.value !== cur; }).map(function (o) { return o.value; });
        }
        for (const v of alts) bucket.push({ key: key, val: v, kind: isFont ? 'font' : 'enum' });
      } else if (el.type === 'checkbox') {
        bucket.push({ key: key, val: !el.checked, kind: 'bool' });
      } else if (el.type === 'number') {
        const cur = Number(el.value);
        const min = el.min !== '' ? Number(el.min) : null;
        const max = el.max !== '' ? Number(el.max) : null;
        const probes = [];
        const add = function (p) {
          if (!Number.isFinite(p)) return;
          let q = Math.round(p * 100) / 100;
          if (min != null && Number.isFinite(min) && q < min) q = min;
          if (max != null && Number.isFinite(max) && q > max) q = max;
          if (q !== cur && probes.indexOf(q) < 0) probes.push(q);
        };
        if (min != null && Number.isFinite(min)) add(min);
        if (max != null && Number.isFinite(max)) add(max);
        const d = Math.max(Math.abs(cur) * 0.25, 1);
        add(cur + d); add(cur - d);
        for (const v of probes.slice(0, 3)) bucket.push({ key: key, val: v, kind: 'num' });
      } else if (el.type === 'color') {
        const cur = String(el.value || '').toLowerCase();
        bucket.push({ key: key, val: cur === '#ff0000' ? '#00ff00' : '#ff0000', kind: 'color' });
      } else {
        const cur = el.value || '';
        bucket.push({ key: key, val: cur === 'בדיקה-סוויפ' ? 'בדיקה-שנייה' : 'בדיקה-סוויפ', kind: 'str' });
      }
    }
    return heavy.concat(light);
  }

  async function runCase(c, base) {
    const a = app();
    const el = ctrl(c.key);
    if (!el) return { key: c.key, kind: c.kind, val: String(c.val), status: 'NO_CONTROL' };
    const before = getDomVal(el);
    const beforeSettings = settingsVal(c.key);
    let r;
    try {
      setDomVal(el, c.val);
      await sleep(100);
      const applied = normEq(settingsVal(c.key), c.val);
      let settleInfo = '';
      if (LIGHT_KEYS.has(c.key)) {
        // **EXT-23:** ה-dirty-guard של הרענון הקל נוקה ב-~2.5 שנ' (debounce);
        // 1.2 שנ' קטעו את הייצוא (err:dirty) — המתנה ארוכה יותר.
        await sleep(2700);
        settleInfo = 'light';
      } else {
        clickRetypeset();
        const genBefore = a.getState().gen;
        const w = await waitEngine(90000, genBefore);
        settleInfo = w.timeout ? 'TIMEOUT' : (w.error ? 'engine-error' : (a.getState().gen > genBefore ? 'engine' : 'no-gen-change'));
        if (w.timeout) {
          try { a.onCancelTypeset(); } catch (e) {}
          await sleep(1500);
        }
        await sleep(60);
      }
      const cap = await capture();
      r = {
        key: c.key, kind: c.kind, val: String(c.val).slice(0, 30), before: String(before).slice(0, 30),
        applied: applied, settle: settleInfo,
        changed: changedVs(cap, base),
        err: cap.err || null, pages: cap.pages, dPages: cap.pages - base.pages, eng: cap.eng,
        hh: cap.hh, lh: cap.lh
      };
    } finally {
      try {
        setDomVal(el, before);
        await sleep(60);
        r.restoredOk = normEq(settingsVal(c.key), beforeSettings);
      } catch (e) { r.restoredOk = false; }
    }
    return r;
  }

  async function init() {
    patchStatus();
    const a = app();
    if (!a.getState().hasResult) { clickRetypeset(); await waitEngine(90000); }
    clickRetypeset(); await waitEngine(90000);
    const base = await capture();
    window.__SWEEP = { status: 'running', phase: 'sweep', idx: 0, plan: buildPlan(), base: base, results: [], startedAt: Date.now() };
    return { total: window.__SWEEP.plan.length, base: { pages: base.pages, lh: base.lh, hh: base.hh } };
  }

  async function step() {
    const S = window.__SWEEP;
    if (!S || S.status !== 'running') return { done: true, status: S ? S.status : 'none' };
    if (S.idx >= S.plan.length) {
      clickRetypeset();
      const genBefore = app().getState().gen;
      const w = await waitEngine(150000, genBefore);
      const cap = await capture();
      S.finalCheck = { ok: !changedVs(cap, S.base), pages: cap.pages, lh: cap.lh, hh: cap.hh, settle: w.timeout ? 'TIMEOUT' : 'ok' };
      S.status = 'done';
      S.ms = Date.now() - S.startedAt;
      try { if (app().clearPersistedSettings) app().clearPersistedSettings(); } catch (e) {}
      return { done: true, finalCheck: S.finalCheck, count: S.results.length };
    }
    const c = S.plan[S.idx];
    let r;
    try { r = await runCase(c, S.base); }
    catch (e) { r = { key: c.key, kind: c.kind, val: String(c.val), status: 'EXCEPTION', err: String((e && e.message) || e) }; }
    S.results.push(r);
    S.idx++;
    return { done: false, idx: S.idx, total: S.plan.length, r: r };
  }

  async function runAll() {
    await init();
    const S = window.__SWEEP;
    let guard = 0;
    while (S.status === 'running' && S.idx < S.plan.length && guard < 5000) {
      guard++;
      try { await step(); } catch (e) { S.results.push({ status: 'EXCEPTION', err: String((e && e.message) || e) }); S.idx++; }
      await sleep(20);
    }
    try { await step(); } catch (e) {}
    return summary();
  }

  function summary() {
    const S = window.__SWEEP;
    if (!S) return null;
    const ok = S.results.filter(function (r) { return r.status !== 'EXCEPTION' && r.status !== 'NO_CONTROL'; });
    const noChange = ok.filter(function (r) { return !r.changed && !r.err && r.applied !== false; });
    const errors = ok.filter(function (r) { return r.err || r.settle === 'TIMEOUT'; });
    const notApplied = ok.filter(function (r) { return r.applied === false; });
    const notRestored = ok.filter(function (r) { return r.restoredOk === false; });
    // **EXT-23:** פסק דין פר-מפתח — wired/partial/no-effect (מקרה אחד
    // ללא שינוי אינו ממית מפתח שלם: ערכים שקולים/תלויי-מסמך מסומנים
    // partial ולא no-effect).
    const perKey = {};
    for (const r of ok) {
      if (!perKey[r.key]) perKey[r.key] = { cases: 0, changed: 0 };
      perKey[r.key].cases++;
      if (r.changed) perKey[r.key].changed++;
    }
    const verdicts = { WIRED: [], PARTIAL: [], NO_EFFECT: [] };
    for (const k of Object.keys(perKey)) {
      const v = perKey[k];
      if (v.changed === v.cases) verdicts.WIRED.push(k);
      else if (v.changed > 0) verdicts.PARTIAL.push(k);
      else verdicts.NO_EFFECT.push(k);
    }
    return {
      total: S.results.length, ms: S.ms || (Date.now() - S.startedAt),
      changedCount: ok.filter(function (r) { return r.changed; }).length,
      perKeyVerdicts: verdicts,
      noChangeKeys: [...new Set(noChange.map(function (r) { return r.key; }))],
      errorKeys: [...new Set(errors.map(function (r) { return r.key; }))],
      notApplied: notApplied.map(function (r) { return { key: r.key, val: r.val, before: r.before }; }),
      notRestoredKeys: [...new Set(notRestored.map(function (r) { return r.key; }))],
      finalCheck: S.finalCheck || null
    };
  }

  window.__sweepInit = init;
  window.__sweepStep = step;
  window.__sweepRunAll = runAll;
  window.__sweepSummary = summary;
  window.__sweepResults = function () { return window.__SWEEP ? window.__SWEEP.results : []; };
  window.__sweepStatus = function () {
    const S = window.__SWEEP;
    return S ? { status: S.status, idx: S.idx, total: S.plan.length, lastKey: S.idx > 0 ? (S.plan[S.idx - 1] || {}).key : null } : null;
  };
})();
