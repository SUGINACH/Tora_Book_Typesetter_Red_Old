// tools/stage9/compare-core.js — ליבת השוואת הצללים (שלב 9b, §2.1/§2.2/§2.5/§2.7)
'use strict';

/**
 * מודול טהור (בלי תלות במנוע) של פרימיטיבים להשוואת זהויות ותוכן בין שני
 * מנועי העימוד. הכלי shadow-compare.js ובדיקות היחידה (s9b-shadow-compare.test.js)
 * צורכים אותו — כך מובטח שהבדיקות השליליות בודקות את אותו קוד שרץ בפועל.
 *
 * עקרונות (הוראת 9b):
 *   §2.1 — מלאי הערות נבנה מהמבנים הסמנטיים; לכל הערה משווים noteId/sourceId/
 *          anchorId/סמן/סוג/continuationOf/wordRange/סדר/טקסט מנורמל. שתי הערות
 *          בעלות טקסט זהה הן שתי זהויות נפרדות.
 *   §2.2 — השוואה דו-כיוונית נפרדת (מה חסר במאוחד מול המורשת; מה חסר במורשת
 *          מול המאוחד); זיהוי החלפת טקסט/עוגן/סמן/סדר — לא רק multiset.
 *   §2.5 — TOC כללי ומפורט נמדדים בנפרד לפי רמה/טקסט/עוגן/יעד.
 *   §2.7 — רשימת שערים אחת בקוד; המספרים בדוח נגזרים ממנה — אין כתיבת מספרים ידנית.
 */

// ---------- נרמול (מוגדר ומתועד — §2.2 "נרמול תחבירי מינימלי") ----------

/** תווי כיוון/בקרה בלתי-נראים — אינם תוכן; זקיפי PUA פנימיים — הדבקת סמן-עוגן. */
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const PUA_RE = /[\ue000-\uf8ff]/g;

function normWords(s) {
  return String(s == null ? '' : s)
    .replace(INVISIBLE_RE, '')
    .replace(PUA_RE, ' ')
    .replace(/[[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** נרמול טקסט הערה שלם (בלי פיצול מילים): רווחים כפולים/תווי בקרה בלבד. */
function normText(s) {
  return String(s == null ? '' : s)
    .replace(INVISIBLE_RE, '')
    .replace(PUA_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function multiset(arr) {
  const m = new Map();
  for (const w of arr) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
function mEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [w, c] of a) if (b.get(w) !== c) return false;
  return true;
}
/** מילים שחסרות ב-sup מתוך sub (כיוון יחיד — קריאה פעמיים בשני כיוונים, §2.2). */
function mDiff(sup, sub) {
  const d = [];
  for (const [w, c] of sub) {
    const have = sup.get(w) || 0;
    if (have < c) d.push({ w, miss: c - have });
  }
  return d;
}
function sumDrops(d) { return d.reduce((n, x) => n + x.miss, 0); }
function fmtDrops(d, cap = 12) {
  const head = d.slice(0, cap).map(x => `${x.w}(×${x.miss})`).join(', ');
  return d.length > cap ? `${head} … (${d.length} סוגים)` : head;
}

// ---------- §2.1: זהות הערה ----------

/**
 * מתאר זהות הערה אחיד. שדות לא-קיימים = null — ההשוואה מדווחת רק על מה
 * שקיים בשני הצדדים (§2.1 "ככל שהמידע קיים").
 */
function noteIdentity(n) {
  return {
    key: n.key != null ? String(n.key) : null,           // מזהה יציב (מנוע/מקור)
    sourceId: n.sourceId != null ? String(n.sourceId) : null,
    anchorId: n.anchorId != null ? String(n.anchorId) : null,
    marker: n.marker != null ? normText(n.marker) : null,
    kind: n.kind || null,                                 // body|side|end|placeholder|continuation
    continuationOf: n.continuationOf != null ? String(n.continuationOf) : null,
    wordRange: n.wordRange ? { from: n.wordRange.from, to: n.wordRange.to } : null,
    order: n.order != null ? Number(n.order) : null,
    text: normText(n.text),
    words: normWords(n.text),
  };
}

/**
 * התאמת הערות בין שני מלאיים — לפי מפתח זהות (key) כשקיים, ואחרת לפי טקסט
 * מנורמל בסדר הופעה (occurrence-based): שתי הערות בעלות טקסט זהה נשארות שתי
 * זהויות — ההתאמה צורכת מופע אחד מכל צד, לעולם לא ממזגת.
 */
function matchNoteSets(a, b) {
  const A = a.map(noteIdentity);
  const B = b.map(noteIdentity);
  const pairs = [];
  const usedB = new Set();
  // מעבר ראשון: מפתח זהות משותף
  const bByKey = new Map();
  B.forEach((nb, j) => { if (nb.key != null) { if (!bByKey.has(nb.key)) bByKey.set(nb.key, []); bByKey.get(nb.key).push(j); } });
  A.forEach((na, i) => {
    if (na.key == null) return;
    const cands = (bByKey.get(na.key) || []).filter(j => !usedB.has(j));
    if (cands.length) { pairs.push({ a: i, b: cands[0], by: 'key' }); usedB.add(cands[0]); }
  });
  // מעבר שני: טקסט מנורמל בסדר הופעה (רק ללא-מותאמים)
  const bByText = new Map();
  B.forEach((nb, j) => { if (!usedB.has(j)) { if (!bByText.has(nb.text)) bByText.set(nb.text, []); bByText.get(nb.text).push(j); } });
  const usedA = new Set(pairs.map(p => p.a));
  A.forEach((na, i) => {
    if (usedA.has(i)) return;
    const cands = (bByText.get(na.text) || []).filter(j => !usedB.has(j));
    if (cands.length && na.text) { pairs.push({ a: i, b: cands[0], by: 'text' }); usedB.add(cands[0]); usedA.add(i); }
  });
  const onlyInA = A.map((_, i) => i).filter(i => !usedA.has(i)).map(i => A[i]);
  const onlyInB = B.map((_, j) => j).filter(j => !usedB.has(j)).map(j => B[j]);
  return { A, B, pairs, onlyInA, onlyInB };
}

/**
 * §2.2 — השוואת הערות מלאה בין שני מלאיים. מחזיר:
 *  - missingInB / missingInA: רשימות זהויות (לכל כיוון בנפרד)
 *  - anchorChanged / markerChanged: הערות מותאמות ששדה משמעותי השתנה
 *  - textMoved: טקסט של הערה אחת נמצא אצל זהות אחרת (זיהוי החלפה)
 *  - wordDiffAtoB / wordDiffBtoA: מילים חסרות לפי כיוון (multiset נפרד)
 *  - orderInversions: זוגות מותאמים שסדרם היחסי התהפך
 */
function diffNoteSets(a, b) {
  const { A, B, pairs, onlyInA, onlyInB } = matchNoteSets(a, b);
  const res = {
    countA: A.length, countB: B.length,
    matched: pairs.length,
    missingInB: onlyInA,
    missingInA: onlyInB,
    anchorChanged: [], markerChanged: [], kindChanged: [],
    textMoved: [],
    wordDiffAtoB: [], wordDiffBtoA: [],
    orderInversions: [],
  };
  for (const p of pairs) {
    const na = A[p.a], nb = B[p.b];
    if (na.anchorId != null && nb.anchorId != null && na.anchorId !== nb.anchorId) {
      res.anchorChanged.push({ a: na, b: nb });
    }
    if (na.marker != null && nb.marker != null && na.marker !== nb.marker) {
      res.markerChanged.push({ a: na, b: nb });
    }
    if (na.kind && nb.kind && na.kind !== nb.kind) res.kindChanged.push({ a: na, b: nb });
  }
  // החלפת טקסט בין זהויות: זוג מותאם שטקסט שונה, והטקסט של A נמצא ב-B אצל זהות אחרת
  const textOwnersB = new Map();
  B.forEach((nb, j) => { if (!textOwnersB.has(nb.text)) textOwnersB.set(nb.text, []); textOwnersB.get(nb.text).push(j); });
  for (const p of pairs) {
    const na = A[p.a], nb = B[p.b];
    if (na.text === nb.text || !na.text) continue;
    const otherJ = (textOwnersB.get(na.text) || []).find(j => j !== p.b);
    if (otherJ != null) res.textMoved.push({ a: na, b: nb, textFoundAt: B[otherJ].key || B[otherJ].text.slice(0, 30) });
  }
  // מילים לפי כיוון — על הטקסט המלא של כל מלאי (§2.2: חישוב אחד לכל כיוון)
  const wordsA = A.flatMap(n => n.words);
  const wordsB = B.flatMap(n => n.words);
  res.wordDiffAtoB = mDiff(multiset(wordsB), multiset(wordsA)); // חסר ב-B
  res.wordDiffBtoA = mDiff(multiset(wordsA), multiset(wordsB)); // חסר ב-A
  // סדר: אינברסיות בין זוגות מותאמים לפי order
  const ordered = pairs.filter(p => A[p.a].order != null && B[p.b].order != null)
    .sort((x, y) => A[x.a].order - A[y.a].order);
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      if (B[ordered[i].b].order > B[ordered[j].b].order) {
        res.orderInversions.push({ a: [A[ordered[i].a].key || A[ordered[i].a].text.slice(0, 20), A[ordered[j].a].key || A[ordered[j].a].text.slice(0, 20)] });
      }
    }
  }
  return res;
}

// ---------- §2.5: TOC ----------

/** ציפיית רשומות TOC לפי D-107: כללי 1–6, מפורט 2–6, H7 מוסתר בשניהם. */
function tocExpectation(headings, { minLevel, maxLevel }) {
  return headings
    .filter(h => h.level >= minLevel && h.level <= maxLevel && h.level !== 7)
    .map(h => ({ level: h.level, text: normText(h.text), key: h.key != null ? String(h.key) : null }))
    .filter(h => h.text);
}

/** השוואת רשומות TOC בפועל מול ציפייה — לפי (רמה, טקסט) בסדר הופעה + כפילויות.
 * כפילות = עודף הופעות של (רמה+טקסט) בפועל על פני הציפייה — כותרות שונות
 * בעלות אותו טקסט (מקורות/עמודים שונים) אינן כפילות אלא רשומות נפרדות. */
function diffToc(expected, actual) {
  const exp = expected.slice();
  const act = actual.map(r => ({ level: r.level, text: normText(r.text), targetPage: r.targetPage != null ? r.targetPage : null }));
  const missing = [], matched = [], extra = [];
  const usedAct = new Set();
  // התאמה בסדר: רשומה צפויה מוצאת את ההופעה הראשונה הלא-צרוכה של (רמה+טקסט)
  for (const e of exp) {
    const idx = act.findIndex((a, i) => !usedAct.has(i) && a.level === e.level && a.text === e.text);
    if (idx >= 0) { usedAct.add(idx); matched.push({ expected: e, actual: act[idx] }); }
    else missing.push(e);
  }
  act.forEach((a, i) => { if (!usedAct.has(i)) extra.push(a); });
  // כפילויות: הופעות בפועל מעבר לציפייה לאותו מפתח (רמה+טקסט)
  const expCount = new Map();
  for (const e of exp) { const k = `${e.level}|${e.text}`; expCount.set(k, (expCount.get(k) || 0) + 1); }
  const actCount = new Map();
  for (const a of act) { const k = `${a.level}|${a.text}`; actCount.set(k, (actCount.get(k) || 0) + 1); }
  const duplicates = [];
  for (const [k, c] of actCount) {
    const over = c - (expCount.get(k) || 0);
    for (let i = 0; i < over; i++) { const [level, ...rest] = k.split('|'); duplicates.push({ level: Number(level), text: rest.join('|') }); }
  }
  return { expectedCount: exp.length, actualCount: act.length, matched: matched.length, missing, extra, duplicates };
}

// ---------- §2.6: סיווג חריגות לפי מקור מוגדר ----------

/**
 * סיווג ירידות (מילים במקור שאינן בפלט). כל כלל נובע מדקדוק או מהחלטה כתובה
 * ומתועד בשם; ירידה שלא נכנסת לאף תקציב = "unexplained" (כשל).
 * budgets: { grammar:Map, metaKeys:Map, metaValues:Map, h7Instruction:Map, citation:Map }
 */
function classifyDrops(drops, budgets) {
  const out = { grammar: [], metaKeys: [], metaValues: [], h7Instruction: [], citation: [], unexplained: [] };
  for (const d of drops) {
    const take = (m) => { const have = (m && m.get(d.w)) || 0; if (have >= d.miss) { m.set(d.w, have - d.miss); return d.miss; } if (have > 0) m.set(d.w, 0); return have; };
    let n = take(budgets.grammar);
    if (n < d.miss) n += take(budgets.h7Instruction);
    if (n < d.miss) n += take(budgets.citation);
    if (n < d.miss) n += take(budgets.metaKeys);
    if (n < d.miss) n += take(budgets.metaValues);
    if (n < d.miss) out.unexplained.push({ w: d.w, miss: d.miss - n }); // רק השארית הבלתי-מסווגת
  }
  return out;
}

/** בניית תקציב סיווג ממלאי מקור (מילים לפי סוג מקור מוגדר). */
function buildBudgets({ grammarWords, metaKeys, metaValues, h7InstructionWords, citationWords }) {
  return {
    grammar: multiset(grammarWords || []),
    metaKeys: multiset(metaKeys || []),
    metaValues: multiset(metaValues || []),
    h7Instruction: multiset(h7InstructionWords || []),
    citation: multiset(citationWords || []),
  };
}

// ---------- §2.7: סיכום שערים מרשימה אחת ----------

/** גוזר סיכום (כולל מספרים) מרשימת הגדרות השערים + תוצאות — מקור יחיד. */
function gateSummary(gateDefs, results) {
  const list = gateDefs.map(g => ({
    id: g.id, group: g.group || null, desc: g.desc || '',
    ok: !!(results[g.id] && results[g.id].ok),
    detail: results[g.id] ? (results[g.id].detail || '') : 'לא הוגדרה תוצאה',
  }));
  const passed = list.filter(g => g.ok).length;
  const failed = list.length - passed;
  return { total: list.length, passed, failed, gates: list, ok: failed === 0 };
}

// ---------- שחזור הערות מורשת מאזורי הערה (§2.1 — מבנים סמנטיים) ----------

/**
 * אזורי הערה של המורשת → הערות. כללי השחזור (מתועדים ומוכחים בבדיקות):
 *  - מילת סמן (w.mk) פותחת הערה חדשה (במצב continuous כמה הערות באזור אחד);
 *  - מילה ללא סמן מצטרפת להערה הפתוחה — לרבות המשך מהעמוד הקודם;
 *  - המילה "(המשך)" היא ריהוט המשך — מוסרת מהטקסט ונספרת בנפרד;
 *  - מילים לפני הסמן הראשון במסמך כולו = ממצא orphan (לא נזרקות בשקט).
 * @param {Array<{page:Number, lines:Array<{words:Array}>}>} areas בסדר עמודים
 */
function reconstructLegacyNotes(areas) {
  const notes = [];
  let cur = null;
  let orphans = [];
  let continuationFragments = 0;
  for (const area of areas) {
    let firstWordOfArea = true;
    for (const ln of (area.lines || [])) {
      for (const w of (ln.words || [])) {
        const t = w && typeof w === 'object' ? w.t : w;
        const isMk = !!(w && typeof w === 'object' && w.mk);
        if (isMk) {
          cur = { key: null, marker: String(t), text: [], page: area.page, order: notes.length, kind: 'body' };
          notes.push(cur);
        } else if (!cur) {
          orphans.push({ word: String(t), page: area.page });
        } else {
          if (firstWordOfArea && /^\(המשך\)$/.test(String(t).trim())) { continuationFragments++; firstWordOfArea = false; continue; }
          cur.text.push(String(t));
        }
        firstWordOfArea = false;
      }
    }
  }
  for (const n of notes) n.text = n.text.join(' ');
  return { notes, orphans, continuationFragments };
}

module.exports = {
  normWords, normText, multiset, mEqual, mDiff, sumDrops, fmtDrops,
  noteIdentity, matchNoteSets, diffNoteSets,
  tocExpectation, diffToc,
  classifyDrops, buildBudgets, gateSummary,
  reconstructLegacyNotes,
};
