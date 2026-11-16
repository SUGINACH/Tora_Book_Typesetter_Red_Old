// src/engine/model/registry.js — מרשם יחיד לסוגי פריטים (שלב 2)
// **חוזה:** spec/03_UNIFIED_ITEM_CONTRACT.md §7 · תוכנית §2.1-8:
// פריט מותאם חדש נרשן ב-registry אחד עם kind, schema, validation,
// resource dependencies, style resolution, measurement contract,
// layout constraints, diagnostics ו-projection contract — ואסור שהוספתו
// תדרוש ענף pipeline/breaker/planner/מקרין נפרד או תנאים מפוזרים בקוד.
//
// שלב 2 מגדיר את החוזה והממשקים בלבד: החריצים של מדידה/שבירה/תכנון/הקרנה
// הם הצהרות (מזהי חוזה) ששלבים 3–8 מחברים אליהן מימוש — לא מימוש כאן.
//
// מבוסס על דפוס inline-item-registry של PR #15 (S14) — מוכל כאן במיקום
// הקנוני model/ עם חריצי החוזה המלאים. רישום הוא realm-local (המודול
// נטען בנפרד ב-Node/Worker/UI); תיאורי פריטי הפרויקט שייכים ל-inline-item-types.
'use strict';

const { isItemKind, ITEM_KINDS } = require('./kinds');

/** סוגים מובנים — אין להחליפם; הם מוגדרים בחוזה ובקוד המנוע. */
const BUILT_IN_KINDS = new Set(Object.values(ITEM_KINDS));

/** חריצי חוזה מותרים ברישום סוג. */
const CONTRACT_SLOTS = Object.freeze([
  'schema',            // סכמת payload (מבנה שדות + סוגים) — לאימות
  'validate',          // ולידציה נוספת (פונקציה טהורה)
  'parse',             // פרסר מקור → פריט (תובענות consumed>0) — לפריטים מותאמים
  'resourceDeps',      // תלויות נכסים (['asset:image', …]) — ל-AssetResolver (שלב 3)
  'styleResolution',   // חוזה פתרון סגנון (מזהה/כלל)
  'measurementContract', // מזהה חוזה מדידה (שלב 3) — לעולם לא מימוש כאן
  'layoutConstraints', // אילוצי פריסה הצהרתיים (atomic/keepWithNext/splittable/participates)
  'diagnostics',       // קטלוג אבחון שהסוג יכול להפיק
  'projectionContract' // חוזה הקרנה לכל יעד (DOM/PDF) — מזהים, לא מימושים
]);

const entries = new Map();

function validateKindName(kind) {
  if (typeof kind !== 'string' || !kind.trim()) {
    throw new TypeError('model/registry: kind must be a non-empty string');
  }
  const normalized = kind.trim();
  if (BUILT_IN_KINDS.has(normalized)) {
    throw new TypeError('model/registry: built-in item kind cannot be replaced: ' + normalized);
  }
  if (!isItemKind(normalized)) {
    throw new TypeError('model/registry: custom kind must be prefixed "custom:" — got: ' + normalized);
  }
  return normalized;
}

/**
 * רישום סוג פריט מותאם. descriptor חייב schema + validate + projectionContract;
 * parse הוא אופציונלי (פריטים שמקורם אינו טקסטואלי-inline). הרישום חד-פעמי
 * ומחמיר: רישום כפול של אותו kind הוא שגיאה, לא דריסה שקטה.
 */
function registerItemType(kind, descriptor) {
  const normalized = validateKindName(kind);
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('model/registry: descriptor must be an object');
  }
  for (const slot of Object.keys(descriptor)) {
    if (!CONTRACT_SLOTS.includes(slot)) {
      throw new TypeError(`model/registry: unknown contract slot "${slot}" (allowed: ${CONTRACT_SLOTS.join(', ')})`);
    }
  }
  if (typeof descriptor.schema !== 'object' || descriptor.schema === null) {
    throw new TypeError('model/registry: descriptor.schema (object) is required');
  }
  if (typeof descriptor.validate !== 'function') {
    throw new TypeError('model/registry: descriptor.validate (function) is required');
  }
  if (!descriptor.projectionContract || typeof descriptor.projectionContract !== 'object') {
    throw new TypeError('model/registry: descriptor.projectionContract (object) is required');
  }
  if (entries.has(normalized)) {
    throw new Error('model/registry: item type already registered: ' + normalized);
  }
  entries.set(normalized, Object.freeze({ ...descriptor }));
  return () => entries.delete(normalized);
}

/** פריטי הרישום הרשומים (לבדיקות ולאודיט). */
function registeredKinds() { return Array.from(entries.keys()); }

function descriptorOf(kind) { return entries.get(String(kind)) || null; }

/**
 * parseInlineItemAt — נקודת הכניסה של הפרסר האינליין לפריטים מותאמים
 * (ממשק תואם ל-inline-content.js: consumed>0 תובענות את המקור).
 * @returns {null|{consumed:number, item:object}}
 */
function parseInlineItemAt(source, index, context) {
  for (const [kind, descriptor] of entries) {
    if (typeof descriptor.parse !== 'function') continue;
    const hit = descriptor.parse(source, index, context || {});
    if (hit && Number.isInteger(hit.consumed) && hit.consumed > 0 && hit.item && hit.item.kind === kind) {
      return hit;
    }
    if (hit) throw new TypeError(`model/registry: parse adapter of "${kind}" must return {consumed>0, item} or null`);
  }
  return null;
}

module.exports = {
  BUILT_IN_KINDS, CONTRACT_SLOTS,
  registerItemType, registeredKinds, descriptorOf, parseInlineItemAt
};
