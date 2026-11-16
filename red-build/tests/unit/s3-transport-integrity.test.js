// tests/unit/s3-transport-integrity.test.js — שלב 3, תיקון ביקורת PR #22:
// אימות שלמות הובלת נכסים UI→Worker. הפגם: fromTransport קיבל assetId מוצהר
// בלי לאמת שהוא תואם לזהות המחושבת מהבתים.
'use strict';
const { describe, it, assert, assertEq, report } = require('../harness');
const { AssetResolver } = require('../../src/engine/assets/asset-resolver');
const { validateRequest } = require('../../src/ui/worker-protocol');

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

describe('שלב 3 — AssetResolver.fromTransport: אימות שלמות (תיקון שורש)', () => {
  it('assetId מוצהר שאינו תואם לתוכן — נדחה במפורש, לא מתקבל בשקט', () => {
    const png = tinyPng(8, 12);
    const forged = { schema: 'asset-transport-v1', assets: [{ assetId: 'ast-image-deadbeefdeadbe', bytes: png }] };
    const r = AssetResolver.fromTransport(forged);
    assert(r.transportReport && r.transportReport.ok === false, 'דחייה מדווחת');
    assertEq(r.transportReport.rejected[0].code, 'asset-id-mismatch');
    assert(r.transportReport.rejected[0].computed && r.transportReport.rejected[0].computed.startsWith('ast-image-'), 'הזהות הנכונה מחושבת ומתועדת');
    assert(!r.resolveById('ast-image-deadbeefdeadbe').ok, 'הנכס המזויף לא נרשם');
    assert(r.diagnostics.some(d => d.code === 'asset-id-mismatch'), 'מתועד באבחונים');
  });
  it('פורמט מזהה שגוי (לא ast-<kind>-<hash14>) — נדחה', () => {
    const bad = AssetResolver.fromTransport({ schema: 'asset-transport-v1', assets: [{ assetId: 'not-an-asset-id', bytes: tinyPng(8, 12) }] });
    assertEq(bad.transportReport.rejected[0].code, 'bad-asset-id');
    const bad2 = AssetResolver.fromTransport({ schema: 'asset-transport-v1', assets: [{ assetId: 'ast-video-abcdef12345678', bytes: tinyPng(8, 12) }] });
    assertEq(bad2.transportReport.rejected[0].code, 'asset-id-mismatch', 'סוג לא נתמך במזהה');
  });
  it('bytes חסרים/ריקים — נדחים; סוג שגוי — נדחה', () => {
    const noBytes = AssetResolver.fromTransport({ schema: 'asset-transport-v1', assets: [{ assetId: 'ast-image-00000000000000' }] });
    assertEq(noBytes.transportReport.rejected[0].code, 'empty-bytes');
    const empty = AssetResolver.fromTransport({ schema: 'asset-transport-v1', assets: [{ assetId: 'ast-image-00000000000000', bytes: new Uint8Array(0) }] });
    assertEq(empty.transportReport.rejected[0].code, 'empty-bytes');
  });
  it('כפילות מושלמת (אותו מזהה, אותם בתים) — idempotent; הדוח מדויק', () => {
    const r = new AssetResolver();
    const add = r.addBytes('img/k.png', tinyPng(10, 10));
    const dupTransport = {
      schema: 'asset-transport-v1',
      assets: [
        { assetId: add.assetId, bytes: tinyPng(10, 10) },
        { assetId: add.assetId, bytes: tinyPng(10, 10) }
      ]
    };
    const r2 = AssetResolver.fromTransport(dupTransport);
    assert(r2.transportReport.ok, 'כפילות מושלמת אינה דחייה: ' + JSON.stringify(r2.transportReport));
    assertEq(r2.transportReport.registered, 2, 'שתי הרשומות נספרו');
    assertEq(r2.stats().assets, 1, 'נכס אחד בפועל');
  });
  it('תקרת העברה נאכפת גם בקבלה (maxBytes) — חריגה נדחית עם דיווח', () => {
    const png1 = tinyPng(64, 64);
    const png2 = tinyPng(32, 64); // תוכן שונה — מזהה שונה
    const r = new AssetResolver();
    const a1 = r.addBytes('img/big1.png', png1).assetId;
    const a2 = r.addBytes('img/big2.png', png2).assetId;
    const transport = { schema: 'asset-transport-v1', assets: [
      { assetId: a1, bytes: png1 }, { assetId: a2, bytes: png2 }
    ] };
    const limited = AssetResolver.fromTransport(transport, { maxBytes: png1.length + 1 });
    assert(!limited.transportReport.ok, 'חריגה נדחית');
    assertEq(limited.transportReport.rejected[0].code, 'transport-limit');
    assertEq(limited.transportReport.registered, 1, 'הראשון נרשם, השני נדחה');
  });
  it('transport פגום (סכמה שגויה / לא אובייקט) — resolver ריק עם דחייה מתועדת', () => {
    const bad = AssetResolver.fromTransport({ schema: 'bogus' });
    assert(bad.transportReport && bad.transportReport.ok === false);
    assertEq(bad.transportReport.rejected[0].code, 'bad-transport');
    const worse = AssetResolver.fromTransport(null);
    assertEq(worse.transportReport.rejected[0].code, 'bad-transport');
  });
  it('round-trip של כמה נכסים: זהויות, בתים ומדידות זהים בין הצדדים', () => {
    const ui = new AssetResolver();
    const ids = [];
    for (const [w, h] of [[8, 12], [64, 32], [100, 50]]) {
      ids.push(ui.addBytes(`img/${w}x${h}.png`, tinyPng(w, h)).assetId);
    }
    const t = ui.serializeForTransport();
    assert(t.ok && t.assets.length === 3, 'שלושה נכסים בהובלה');
    const worker = AssetResolver.fromTransport(t);
    assert(worker.transportReport.ok, JSON.stringify(worker.transportReport));
    for (let i = 0; i < ids.length; i++) {
      const m = worker.measure(ids[i]);
      assert(m.ok, `מדידה בצד השני עבור ${ids[i]}`);
      const [w, h] = [[8, 12], [64, 32], [100, 50]][i];
      assertEq(m.width, w); assertEq(m.height, h);
      const back = worker.resolveById(ids[i]);
      assert(back.ok && Buffer.from(back.asset.bytes).equals(tinyPng(w, h)), 'בתים זהים');
    }
  });
  it('הפרוטוקול מאמת סכמת נכסים בבקשת עימוד (validateRequest) — כולל דחיית bytes שגויים', () => {
    const good = { type: 'typeset-request', jobId: 'j1', text: 'x', settings: {}, assets: { schema: 'asset-transport-v1', assets: [{ assetId: 'ast-image-00000000000000', bytes: new Uint8Array(4) }] } };
    assert(validateRequest(good), 'סכמה תקינה עוברת');
    let threw = false;
    try { validateRequest({ type: 'typeset-request', jobId: 'j', text: 'x', settings: {}, assets: { schema: 'asset-transport-v2', assets: [] } }); } catch (_) { threw = true; }
    assert(threw, 'סכמה לא מוכרת נדחית');
    threw = false;
    try { validateRequest({ type: 'typeset-request', jobId: 'j', text: 'x', settings: {}, assets: { schema: 'asset-transport-v1', assets: [{ assetId: 'nope', bytes: new Uint8Array(4) }] } }); } catch (_) { threw = true; }
    assert(threw, 'מזהה שאינו ast-* נדחה');
    threw = false;
    try { validateRequest({ type: 'typeset-request', jobId: 'j', text: 'x', settings: {}, assets: { schema: 'asset-transport-v1', assets: [{ assetId: 'ast-image-00000000000000', bytes: 'a string' }] } }); } catch (_) { threw = true; }
    assert(threw, 'bytes שאינם מערך-בתים נדחים');
  });
  it('serializeForTransport: תקרה בשליחה — {ok:false} עם קוד, לא חריגה שקטה', () => {
    const r = new AssetResolver();
    r.addBytes('img/a.png', tinyPng(32, 32));
    const over = r.serializeForTransport(10);
    assert(!over.ok && over.code === 'transport-limit', over.code);
    const okSer = r.serializeForTransport();
    assert(okSer.ok && okSer.assets.length === 1);
  });
  it('אין נתיבים מקומיים בהובלה — מזהים, בתים, סוג ושמות נייוט יחסיים של המסמך (מקטע ב׳, הוראה §6)', () => {
    const r = new AssetResolver();
    r.addBytes('some/relative/path.png', tinyPng(4, 4));
    const t = r.serializeForTransport();
    const keys = Object.keys(t.assets[0]).sort();
    // **מקטע ב׳:** refs הוא חלק מהחוזה התקני — שמות יחסיים של המסמך
    // (לא נתיבי מערכת): בלי המפה הזו צד העובד אינו יכול לפתור תמונות לפי
    // מקום העיגון במודל.
    assertEq(keys.join(','), 'assetId,bytes,kind,refs', 'שדות ההובלה: מזהה, בתים, סוג + שמות נייוט יחסיים');
    assertEq(t.assets[0].refs.join(','), 'some/relative/path.png', 'השם היחסי נשמר');
    // אין נתיבים מו׋ליים/\ UNC / פרוטוקולים
    for (const ref of t.assets[0].refs) {
      assert(!/^([a-z]:|\\\\|\/\/|[a-z][a-z0-9+.-]*:)/i.test(ref), 'שם יחסי בלבד: ' + ref);
    }
  });
});

report('s3-transport-integrity');
