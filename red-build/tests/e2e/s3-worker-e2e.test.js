// tests/e2e/s3-worker-e2e.test.js — שלב 3, תיקון ביקורת PR #22:
// בדיקות Worker אמיתיות end-to-end (worker_threads — structured clone בפועל),
// לא רק unit של validateRequest. מוכיח: רישום גופן קנוני דרך ה-Worker עם fontId
// זהה לצד ה-UI; הובלת נכסים דרך requestTypeset החי; שחזור resolver בצד השני
// עם אותן זהויות ואותן מדידות; דחיית transport פגום; זהות יציבה אחרי respawn.
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { describe, it, assert, assertEq, report } = require('../harness');

const { WorkerEngineClient, workerTransport } = require('../../src/ui/worker-client');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');
const fontResolver = require('../../src/engine/typography/font-resolver');
const { getDefaultSettings } = require('../../src/engine/core/settings-registry');
const { sha256Hex } = require('../../src/engine/assets/hash256');

const REPO = path.join(__dirname, '..', '..');
const ASSETS = path.join(REPO, 'ui', 'assets', 'imud');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ASSETS, 'imud-fonts.json'), 'utf8'));
const bytesOf = (fam) => { const e = CATALOG.find(x => x.family === fam); return fs.readFileSync(path.join(ASSETS, 'fonts', e.file)); };
const BOOTSTRAP = path.join(__dirname, '..', 'fixtures', 'worker', 's3-worker-bootstrap.js');

function tinyPng(w, h) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255,
      (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]), Buffer.from('IDAT'), Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'), Buffer.from([0, 0, 0, 0])
  ]);
}

/** המתנה להודעה הבאה מה-Worker שעונה לפילטר (מדלגת progress). */
function waitFor(worker, pred, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const onMsg = (m) => { if (pred(m)) { cleanup(); resolve(m); } };
    const onErr = (e) => { cleanup(); reject(e); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout waiting for worker message')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); worker.off('message', onMsg); worker.off('error', onErr); }
    worker.on('message', onMsg);
    worker.on('error', onErr);
  });
}

/** תעבורת Worker אמיתית עם דור/respawn — אותו ממשק שהמוצר משתמש בו בדפדפן. */
function realWorkerTransport() {
  let worker = null;
  let terminated = false;
  let handler = null;
  let errorSink = null;
  let generation = 0;
  function attach(w) {
    w.on('message', (ev) => { if (handler) handler(ev); });
    w.on('error', (e) => {
      try { w.terminate(); } catch (_) { /* כבר מת */ }
      terminated = true;
      if (errorSink) { try { errorSink(e); } catch (_) { /* מאזין קולקני */ } }
    });
  }
  function ensure() {
    if (worker && !terminated) return worker;
    worker = new Worker(BOOTSTRAP);
    terminated = false;
    generation++;
    attach(worker);
    return worker;
  }
  return {
    post: (m) => { ensure().postMessage(m); },
    setHandler: (cb) => { handler = cb; },
    setOnError: (cb) => { errorSink = cb; },
    getGeneration: () => generation,
    ensureAlive: () => { ensure(); return generation; },
    terminate: () => {
      if (worker && !terminated) { try { worker.terminate(); } catch (_) { /* כבר מת */ } }
      terminated = true;
    },
    _raw: () => ensure()
  };
}

const SMALL_DOC = 'כותרת 1 - חלק\nפסקה ראשונה לבדיקת עימוד בעובד אמיתי עם נכסים.\nפסקה שנייה [עם הערה] וסיום אמיתי.\n';

describe('שלב 3 — Worker E2E אמיתי: רישום גופן קנוני וזהות בין הצדדים', () => {
  it('register-font דרך ה-Worker עובר ב-Font Resolver ומחזיר fontId זהה לזה שחושב ב-UI', async () => {
    const transport = realWorkerTransport();
    const worker = transport._raw();
    const bytes = bytesOf('Frank Ruhl Libre');
    const expectedFontId = `fnt-${sha256Hex(bytes).slice(0, 14)}`; // אותה נוסחה — מהבתים, בצד ה-UI
    const got = waitFor(worker, (m) => m.type === 'register-font-result');
    worker.postMessage({ type: 'register-font', jobId: 'rf-1', name: 'Frank Ruhl Libre', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
    const res = await got;
    assert(res.ok === true, 'רישום הצליח: ' + JSON.stringify(res));
    assert(res.glyphCount > 0, 'מספר גליפים חוזר');
    assertEq(res.fontId, expectedFontId, 'fontId זהה בשני הצדדים (content-addressed)');
    // הרישום בפועל בתוך ה-Worker — דרך ה-resolver הקנוני (גשש)
    const probe = waitFor(worker, (m) => m.type === 's3-probe-font-result' || (m.ok === true && m.aliases));
    worker.postMessage({ type: 's3-probe-font', jobId: 'pf-1', probeAliases: ['Frank Ruhl Libre'] });
    const p = await probe;
    assertEq(p.aliases['Frank Ruhl Libre'], expectedFontId, 'ה-resolver בתוך ה-Worker מחזיק את אותה זהות');
    await transport.terminate();
  });
  it('רישום כפול של אותו כינוי עם בתים שונים — נדחה דרך ה-Worker (אין החלפה שקטה)', async () => {
    const transport = realWorkerTransport();
    const worker = transport._raw();
    const b1 = bytesOf('Frank Ruhl Libre');
    const b2 = bytesOf('David Libre');
    const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    let res1 = await (waitFor(worker, (m) => m.type === 'register-font-result'), (async () => {
      const p = waitFor(worker, (m) => m.type === 'register-font-result');
      worker.postMessage({ type: 'register-font', jobId: 'rf-2a', name: 'DupName', bytes: ab(b1) });
      return p;
    })());
    assert(res1.ok === true, 'הרישום הראשון עבר');
    const p2 = waitFor(worker, (m) => m.type === 'register-font-result');
    worker.postMessage({ type: 'register-font', jobId: 'rf-2b', name: 'DupName', bytes: ab(b2) });
    const res2 = await p2;
    assert(res2.ok === false, 'הרישום הכפול נדחה');
    assertEq(res2.code, 'alias-conflict', 'סיבה מפורשת: ' + res2.error);
    await transport.terminate();
  });
});

describe('שלב 3 — Worker E2E אמיתי: הובלת נכסים בזרימת העימוד החיה', () => {
  it('requestTypeset עם AssetResolver: ההודעה כוללת assets; ה-Worker משחזר ומחזיר תוצאה תקינה', async () => {
    const transport = realWorkerTransport();
    const client = new WorkerEngineClient(transport);
    // רישום גופן לפני העימוד — כמו הזרימה החיה (imud-library רושם ואז מעמד)
    const bytes = bytesOf('Frank Ruhl Libre');
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    const regP = waitFor(transport._raw(), (m) => m.type === 'register-font-result');
    await client.registerFont({ name: 'Frank Ruhl Libre', bytes: ab });
    const reg = await regP;
    assert(reg.ok === true, 'רישום עבר');
    // הנכסים: resolver חי בצד ה-UI
    const ar = new AssetResolver();
    const assetId = ar.addBytes('img/e2e.png', tinyPng(40, 25)).assetId;
    const settings = { ...getDefaultSettings(), 'body-font': 'Frank Ruhl Libre' };
    const req = client.requestTypeset({ text: SMALL_DOC, settings, assets: ar });
    assert(req.jobId, 'מזהה עבודה הוקצה');
    const result = await req.promise;
    assert(result && result.pageModel && result.pageModel.model && result.pageModel.model.pages.length > 0, 'עימוד הושלם עם מודל בהודעה (9c.5: pages הגולמי הוסר; המודל במעטפת התעבורה)');
    assertEq(result.contentPreserved, true, 'שימור תוכן');
    // הוכחת הגעה לצינור החי: הנכסים הגיעו לתוך typeset והדבר מתועד בעקבות
    // (שער הצריכה המלא — שלב 4; כאן מוכח שהקלטה אינה שקטה)
    const assetEvent = (result.trace && result.trace.events || []).find((e) => e.label === 'doc-assets-received');
    assert(assetEvent, 'הצינור רשם קליטת נכסים בעקבות');
    assertEq(assetEvent.payload.assets, 1, 'נכס אחד הגיע');
    // ההודעה שיצאה באמת כללה את ה-transport (הוכחה: גשש שמודד את אותם מזהים בתוך ה-Worker)
    const probeP = waitFor(transport._raw(), (m) => m.ok === true && m.measures);
    transport._raw().postMessage({ type: 's3-probe-assets', jobId: 'pa-1', assets: ar.serializeForTransport(), probeIds: [assetId] });
    const probe = await probeP;
    assert(probe.report.ok === true, 'fromTransport בתוך ה-Worker: ' + JSON.stringify(probe.report));
    const m = probe.measures[assetId];
    assert(m && m.ok && m.width === 40 && m.height === 25, 'אותה מדידת נכס בתוך ה-Worker');
    await transport.terminate();
  });
  it('transport שכבר נבנה (אובייקט) — התקבל ועבר; transport פגום — דחייה מפורשת לפני שליחה', async () => {
    const transport = realWorkerTransport();
    const client = new WorkerEngineClient(transport);
    const ar = new AssetResolver();
    ar.addBytes('img/ready.png', tinyPng(10, 10));
    const prebuilt = ar.serializeForTransport();
    const req = client.requestTypeset({ text: 'כותרת 1 - חלק\nשורה אחת.\n', settings: getDefaultSettings(), assets: prebuilt });
    const result = await req.promise;
    assert(result && result.pageModel.model.pages.length > 0, 'transport מוכן עובר עד תוצאה');
    // דחייה: אובייקט שגוי
    const bad = client.requestTypeset({ text: 'x', settings: {}, assets: { bogus: true } });
    let msg = '';
    try { await bad.promise; } catch (e) { msg = e.message; }
    assert(msg.includes('AssetResolver') || msg.includes('asset-transport'), 'דחייה מפורשת: ' + msg);
    // דחייה: סריאליזציה שנכשלה (ok:false)
    const failed = client.requestTypeset({ text: 'x', settings: {}, assets: { serializeForTransport: () => ({ ok: false, code: 'transport-limit' }), schema: 'x' } });
    let msg2 = '';
    try { await failed.promise; } catch (e) { msg2 = e.message; }
    assert(msg2.includes('transport-limit'), 'חריצת תקרה נדחית עם הקוד: ' + msg2);
    await transport.terminate();
  });
  it('respawn: זהות הגופן נשמרת והניגון החוזר רושם מחדש את אותה זהות', async () => {
    const transport = realWorkerTransport();
    const client = new WorkerEngineClient(transport);
    const bytes = bytesOf('David Libre');
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    const expectedId = `fnt-${sha256Hex(bytes).slice(0, 14)}`;
    const reg = await client.registerFont({ name: 'David Libre', bytes: ab });
    assert(reg.ok === true && reg.fontId === expectedId, 'נרשם בזהות הצפויה');
    await transport.terminate(); // respawn בפוסט הבא
    const req = client.requestTypeset({ text: 'כותרת 1 - חלק\nפסקה אחרי respawn.\n', settings: getDefaultSettings() });
    const result = await req.promise;
    assert(result && result.pageModel.model.pages.length > 0, 'בקשה אחרי respawn עובדת (הניגון החוזר בוצע)');
    const probeP = waitFor(transport._raw(), (m) => m.ok === true && m.aliases);
    transport._raw().postMessage({ type: 's3-probe-font', jobId: 'pf-2', probeAliases: ['David Libre'] });
    const probe = await probeP;
    assertEq(probe.aliases['David Libre'], expectedId, 'אותה זהות גופן גם אחרי respawn');
    await transport.terminate();
  });
  it('UI↔Worker parity של זהויות נכסים: אותם בתים בשני הצדדים ⇒ אותם מזהים', async () => {
    const transport = realWorkerTransport();
    const worker = transport._raw();
    const pngs = [[8, 12], [64, 32], [100, 50]];
    const ui = new AssetResolver();
    const ids = pngs.map(([w, h]) => ui.addBytes(`img/${w}x${h}.png`, tinyPng(w, h)).assetId);
    const probeP = waitFor(worker, (m) => m.ok === true && m.measures);
    worker.postMessage({ type: 's3-probe-assets', jobId: 'pa-2', assets: ui.serializeForTransport(), probeIds: ids });
    const probe = await probeP;
    assert(probe.report.ok && probe.report.registered === 3, 'שלושה נכסים נבנו ב-Worker: ' + JSON.stringify(probe.report));
    for (let i = 0; i < ids.length; i++) {
      const m = probe.measures[ids[i]];
      assert(m && m.ok, `מדידה קיימת ב-Worker עבור ${ids[i]}`);
      assertEq(m.width, pngs[i][0], 'אותו רוחב');
      assertEq(m.height, pngs[i][1], 'אותו גובה');
      const uiM = ui.measure(ids[i]);
      assert(Math.abs(m.aspectRatio - uiM.aspectRatio) < 1e-12, 'אותו יחס');
    }
    await transport.terminate();
  });
});

report('s3-worker-e2e');
