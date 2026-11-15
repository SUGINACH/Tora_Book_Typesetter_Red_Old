// tests/fixtures/worker/s3-worker-bootstrap.js — מנוף הרצה של ה-Worker האמיתי
// לבדיקות E2E של שלב 3 (תיקון ביקורת PR #22). זו סביבת Worker אמיתית
// (worker_threads — structured clone בפועל בגבול ההודעות), לא תעבורה inline.
// מעבר לפרוטוקול המוצר (createEngineWorkerMain) קיים גשש אחד לבדיקות:
// 's3-probe-assets' — מפעיל את AssetResolver.fromTransport בתוך ה-Worker
// ומדווח על הזהויות/המדידות שנבנו שם, כדי שאפשר להוכיח parity מול צד ה-UI.
'use strict';
const { parentPort } = require('worker_threads');
const { createEngineWorkerMain } = require('../../../src/ui/engine-worker-main');

const handler = createEngineWorkerMain((m) => parentPort.postMessage(m));

parentPort.on('message', (msg) => {
  if (msg && msg.type === 's3-probe-assets') {
    try {
      const { AssetResolver } = require('../../../src/engine/assets/asset-resolver');
      const r = AssetResolver.fromTransport(msg.assets);
      const probe = { ok: true, jobId: msg.jobId, report: r.transportReport, stats: r.stats(), measures: {} };
      for (const id of (msg.probeIds || [])) {
        probe.measures[id] = r.measure(id);
      }
      parentPort.postMessage(probe);
    } catch (e) {
      parentPort.postMessage({ ok: false, jobId: msg.jobId, error: e && e.message ? e.message : String(e) });
    }
    return;
  }
  if (msg && msg.type === 's3-probe-font') {
    try {
      const fontResolver = require('../../../src/engine/typography/font-resolver');
      const out = { ok: true, jobId: msg.jobId, aliases: {}, count: fontResolver.fontCount() };
      for (const alias of (msg.probeAliases || [])) {
        out.aliases[alias] = fontResolver.fontIdOfAlias(alias);
      }
      parentPort.postMessage(out);
    } catch (e) {
      parentPort.postMessage({ ok: false, jobId: msg.jobId, error: e && e.message ? e.message : String(e) });
    }
    return;
  }
  handler(msg);
});
