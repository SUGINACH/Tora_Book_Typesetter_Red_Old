# CANONICAL_DOCUMENT_MODEL — מפרט מודל המסמך ומודל פריטי ה-inline (שלב 2)

> **מעמד:** תוצר שלב 2 לפי `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md` §2.2.
> **מימוש:** `red-build/src/engine/model/` (document-model, kinds, identity, source-range, registry, validate, roundtrip, adapter) · `red-build/src/engine/parser/inline-content.js`.
> **חוזה־על:** `spec/03_UNIFIED_ITEM_CONTRACT.md` (טיוטת שלב 1 — ממתינה לאישור אדריכלי, שאלה פתוחה 14). מסמך זה מרחיב את החוזה לרמת המימוש ומתעד את נקודות ההכרעה שהושארו פתוחות.
> **ענף:** `stage2/canonical-document-model-20261116` (בסיס: ענף שלב 1 — PR #19).

---

## 1. העיקרון

**מודל פריטים אחד → צינור עימוד אחד → מדידה ושבירה פעם אחת → Planner אחד → PageModel יחיד → מקרינים טהורים.**

המודל הקנוני הוא ייצוג המקור היחיד של תוכן המסמך מרגע הפענוח: לכל פריט זהות, מקור, סדר וסמנטיקה. הוא אינו מכיל שום החלטה גאומטרית (מיקום, מדידה, שבירה) — אלו שלבים 3–7. הפרסר הקיים (`dfa-lexer` + `block-tokenizer`) לא נכתב מחדש; הוא הורחב ברשומות מקור הפיכות, והמודל נבנה מפלטו המפורט.

```
rawText ──lexDocument──► bodyLines + metadata ──tokenizeDetailed──► tokens + lineRecords
                                                                     │
                                                        buildDocumentModel
                                                                     ▼
                                                          DocumentModel (קנוני)
                                                             │            │
                                     modelToTokens (adapter יציאה זמני)   reconstructSource (round-trip)
                                                             ▼            ▼
                                                    זרם טוקנים ל-DP     המקור — תו-מול-תו
```

## 2. מבנה ה-DocumentModel

```ts
DocumentModel {
  version: 1
  docId: string                    // ast-<hash> — נגזר מבייטי המקור בלבד
  source: {
    unifiedLength: number          // אורך הטקסט אחרי איחוד CRLF→LF
    lineMap: LineRecord[]          // כל שורה: start/end/eol/originalStart/originalEnd
    skeleton: SkeletonEntry[]      // סיווג כל שורה: metadata | blank | body(+blockId)
    blankLines: Map<lineIndex, string>  // טקסט הרווחים המקורי המדויק של שורות ריקות
  }
  metadata: { entries: [{ key, value, lineIndex, sourceRange, sourceText }] }
  blocks: Block[]                  // לפי סדר המקור; order = אינדקס רץ במסמך
  notes: NoteBody[]                // גופי הערות שחולצו מפסקאות
  anchors: Anchor[]                // עוגן לכל כותרת (יעד TOC) ולכל סמן הערה
  declarations: { customStyles?: [...] }   // הצהרות מסמך מההגדרות — עם זהות
  diagnostics: Diagnostic[]        // אף פעם לא נבלעים
  parse: { contentHash, tokenCount, lineCount, delimiters }
}
```

### 2.1 סוגי בלוקים (`kinds.js` — BLOCK_KINDS)

| kind | מקור | דוגמה | constraints |
|---|---|---|---|
| `heading` | `כותרת N - …` (N∈0..7), `חלק א - …`, `הקדמה - …` | ראה §4.1 | `keepWithNext: true`, participates: block |
| `paragraph` | שורת טקסט רגילה (כולל `[הערות]` משובצות) | ראה §4.2 | participates: block, splittable: line |
| `endnote` | `הערת סיום - …` / `הערת סיום-N - …` | ראה §4.3 | participates: block, splittable: line |
| `endnoteClass` | `הערות סיום - כותרת` (רבים) | ראה §4.4 | participates: pageFurniture (הוראה) |
| `editorial` | `##…##` (מוסר מהפלט, נשמר לחשבונאות) | ראה §4.5 | participates: none, removed: true |

`parentId` של בלוק = מזהה בלוק ה-`heading` מרמה ≤ 1 המכיל (`null` לפני החלק הראשון) — בדיוק כמו `currentPart` בפייפליין.

### 2.2 תמורת השורה (מקור ↔ קנוני — הפיכה מלאה)

כל בלוק נושא רשומת תמורה (`block.source`) המתעדת את שלבי המעבר משורת המקור לשורה הקנונית:

```
rawLine ──trim──► trimmed ──נרמול 1:1──► pre ──הסרת ##…##→רווח──► mid ──צמצום רווחים──► mid2 ──trim──► canonical
```

- **נרמול 1:1** (חוקי Z.ai, ללא שינוי התנהגות): `״(U+05F4)→׳(U+05F3)`, `‘ ’→"`. כל רשומה: `{offset, original, normalized, code}` — ההיפוך מדויק (שימור אורך ⇒ מיקומים זהים).
- **editorial/droppedWs/edge**: כל תו שהוסר נרשם עם טקסט המקור המדויק וטווחו; `charMap` ממפה כל מיקום קנוני למיקום ב-`pre`.
- **שוליים**: `rawLeadText`/`rawTrailText` — טקסט הרווחים המקורי (לא רק אורך), כולל שורות ריקות של רווחים/טאבים.
- מערכת הקואורדינטות: טווחי המקור (`sourceRange`) נספרים בטקסט המאוחד (CRLF→LF); `lineMap` מאפשר מיפוי חזרה לבייטים הגולמיים.

**הוכחת השימור:** `reconstructSource(model)` בונה את המקור מהפריטים + התחביר + רשומות התמורה בלבד — השוואה תו-מול-תו. מאומת על כל סוגי התוכן ועל הקורפוס הראשי (`very_long`, 3.4MB, char-exact).

## 3. Inline Item Model

### 3.1 חוזה הפריט

```ts
Item {
  id: string                    // itm-<hash> — נגזר מההורה+סוג+סודר+טווח המקור (לא מונה ריצה)
  kind: 'text'|'noteMarker'|'image'|'anchor'|'atomicToken'|'glue'|'penalty'|'custom:<x>'
  parentId: string              // הבלוק המכיל
  order: number                 // סדר קריאה רציף בתוך ההורה (0,1,2,…)
  sourceRange: { start, end }   // קואורדינטות המקור המאוחד
  sourceText: string            // הפרוסל הקנוני המדויק של הטווח (הוכחת כיסוי)
  payload: { … לפי סוג … }
  styleRef: { family, resolvedBy, inherits, multiFamily? }   // הפניה, לא עותק
  constraints: { atomic?, participates, splittable?, overflow?, bindToNeighbor? }
  diagnostics: Diagnostic[]
}
```

### 3.2 סוגי פריטים ודוגמאות JSON

**text** — רצף טקסט רצוף; מקטעים (runs) בעלי family identity משלהם. מילה עם כמה גופנים אינה מצטמצמת למחרוזת שטוחה:

```json
{
  "id": "itm-1a2b3c4d5e6f7",
  "kind": "text",
  "parentId": "blk-9f8e7d6c5b4a3",
  "order": 0,
  "sourceRange": { "start": 148, "end": 231 },
  "sourceText": "מילה רגילה <Frank Ruhl Libre>מילה בגופן</> ומילה אחרונה.",
  "payload": {
    "text": "מילה רגילה מילה בגופן ומילה אחרונה.",
    "runs": [
      { "text": "מילה רגילה ", "fontFamily": null,        "sourceStart": 148, "sourceEnd": 158, "role": null },
      { "text": "מילה בגופן",  "fontFamily": "Frank Ruhl Libre", "sourceStart": 179, "sourceEnd": 188, "role": "fontRange" },
      { "text": " ומילה אחרונה.", "fontFamily": null,     "sourceStart": 192, "sourceEnd": 206, "role": null }
    ]
  },
  "styleRef": { "family": null, "resolvedBy": "per-run", "inherits": false, "multiFamily": true },
  "constraints": { "atomic": false, "participates": "inline", "splittable": "line" },
  "diagnostics": []
}
```

טווחי גופן נתמכים: קינון, מספר משפחות באותו מילה/רצף, גבולות בין מילים, ירושה ו-fallback (מדווח כ-warning — `font-family-unavailable`), טווחים חוצים (נדחים במפורש — `crossing-font-range`), מעבר שורה (עתידי — שלב 4 שומר את המקטעים בשבירה).

**noteMarker** — פריט אטומי עם קישור מבני חד-משמעי:

```json
{
  "id": "itm-0f1e2d3c4b5a6",
  "kind": "noteMarker",
  "parentId": "blk-9f8e7d6c5b4a3",
  "order": 1,
  "sourceRange": { "start": 206, "end": 221 },
  "sourceText": "[הערה פנימית]",
  "payload": {
    "noteRef": "note-cdba3c1f00249",
    "delimiters": { "open": "[", "close": "]" }
  },
  "styleRef": { "family": null, "resolvedBy": "note-marker-style", "inherits": true },
  "constraints": { "atomic": true, "participates": "inline", "splittable": "never", "bindToNeighbor": true },
  "diagnostics": []
}
```

**noteBody** (ברשימת `notes` של המודל):

```json
{
  "id": "note-cdba3c1f00249",
  "kind": "noteBody",
  "parentId": "blk-9f8e7d6c5b4a3",
  "order": 0,
  "sourceRange": { "start": 207, "end": 220 },
  "sourceText": "הערה פנימית",
  "payload": {
    "markerRef": "itm-0f1e2d3c4b5a6",
    "body": "הערה פנימית",
    "atomicText": "הערה\uE000פנימית",
    "runs": [ { "text": "הערה פנימית", "fontFamily": null, "sourceStart": 207, "sourceEnd": 220 } ]
  },
  "continuation": { "sharedId": "note-cdba3c1f00249", "policy": "preserve-identity-on-split" },
  "constraints": { "participates": "inline", "splittable": "line" }
}
```

הקישור **דו-כיווני ומבני** (`noteRef` ⇄ `markerRef`) — לא חיפוש טקסט. זהות ההמשך (`continuation.sharedId`) נשמרת גם כשההערה מתפצלת בין עמודים (מימוש הפיצול — שלבים 5–6; הזהות כבר קבועה כאן).

**image** — פריט אמיתי בזרם (לא ערוץ צדדי):

```json
{
  "id": "itm-8877665544332",
  "kind": "image",
  "parentId": "blk-1122334455667",
  "order": 2,
  "sourceRange": { "start": 96, "end": 114 },
  "sourceText": "#images/pic.jpg.c60#",
  "payload": {
    "assetId": "ast-50f9ee740ff5e",
    "resourcePath": "images/pic.jpg",
    "align": "center",
    "widthPct": 60,
    "naturalWidth": null, "naturalHeight": null, "aspectRatio": null,
    "fit": null, "altText": null,
    "resolution": { "stage": 3, "pending": ["naturalWidth", "naturalHeight", "aspectRatio", "fit"] }
  },
  "constraints": { "atomic": true, "participates": "inline", "splittable": "never", "overflow": "move" },
  "diagnostics": [{ "code": "asset-dimensions-pending-stage3", "message": "מידות הנכס ייפתרו בשלב 3 (AssetResolver); הזהות והמקור כבר קבועים." }]
}
```

תחביר המקור: `#path.ext[.l|c|r][1-100]#` (PNG/JPG/JPEG; פורמט אחר ⇒ אזהרה מפורשת). `assetId` דטרמיניסטי מזהות המקור; המידות הטבעיות ומדיניות ה-fit שייכות ל-AssetResolver של שלב 3 — החוזה כאן מבטיח חיבור ללא שינוי מבני.

**anchor / atomicToken / glue / penalty** — מוגדרים ב-`kinds.js` וב-registry; `anchor` נוצר היום לכל כותרת (יעד TOC/קישורים) ולכל סמן הערה. `glue`/`penalty` יופעלו לפי הצורך בשלב 4 (Line Item contract) — החוזה קיים, המימוש לא הוקדם.

### 3.3 כללי סדר, גבולות ופיצול

- **סדר:** `order` רציף 0..n-1 לכל בלוק; בלוקים לפי סדר המקור. הולידטור דוחה רצף שבור (`item-order-gap`).
- **גבולות בין פריטים:** פרוסל המקור של כל בלוק מכוסה בדיוק פעם אחת על ידי הפריטים + תחביר (תוחמי הערות, סמני גופן, רווחי בין-חלקים, קידומות כותרת) — `rebuildCanonicalLine` זורק שגיאת כיסוי אם חסר או כפול.
- **אטימות:** `noteMarker`, `image`, פריטים מותאמים — `atomic: true` (אסור לחתוך).
- **פיצול:** `text`/`paragraph`/`endnote`/`noteBody` — `splittable: 'line'`; ליבת הכלל: פריט שהתפצל חזותית משמר את `id` המקורי בכל המופעים (`occurrenceKey` ב-identity.js — האינדקס נקבע על ידי שלב העימוד בלבד).

## 4. דוגמאות AST לסוגי בלוקים

**4.1 heading** (`כותרת 3 - שערי שבת`):
```json
{ "id": "blk-3f2a1b0c9d8e7", "kind": "heading", "level": 3, "order": 4,
  "parentId": "blk-9f8e7d6c5b4a3", "lineIndex": 12,
  "sourceRange": { "docId": "doc-…", "start": 487, "end": 504 },
  "payload": { "text": "שערי שבת", "num": null },
  "items": [ { "kind": "text", "payload": { "text": "שערי שבת", "runs": [ … ] } } ],
  "syntax": { "prefix": { "start": 0, "end": 10, "text": "כותרת 3 - " }, "titleSpan": { "start": 10, "end": 17 }, "markerSpans": [] },
  "constraints": { "keepWithNext": true, "participates": "block", "splittable": "never" } }
```

**4.2 paragraph** (`פסקה עם הערה [הערה] סוף`): items = `[text, noteMarker, text]`; `syntax` = `{ partRecords, gaps, noteDelims (עם טקסט התוחמים המדויק), markerSpans, editorialSegments, unmatchedClosers, delimiters }`.

**4.3 endnote** (`הערת סיום-7 - טקסט`): `payload.num = 7`; items = פריט הטקסט של הגוף (עם runs); `syntax.prefix` = `"הערת סיון-7 - "` המדויק.

**4.4 endnoteClass** (`הערות סיום - כותרת`): הוראה — `participates: 'pageFurniture'`, `directive: 'endnote-pages-title'`; `payload.title`.

**4.5 editorial** (`##הערת עורך##`): `removed: true`, `participates: 'none'`; `syntax.editorialSegments` נושאים את הטקסט המלא (`##…##`) לחשבונאות ולשחזור.

**4.6 metadata** (`שם הספר - …`): רשומות עם `key`, `value`, `sourceRange`, `sourceText` — שייכות לשלד, לא ל-blocks.

## 5. כללי זהות

1. `id` נגזר מהמקור בלבד: sha256 מקוצר על (מרחב-שם, docId/parentId, kind, סודר, טווח). **אין מוני ריצה, אין Date.now, אין Math.random.** מוכח: שתי בניות של אותו מקור ⇒ מזהים זהים ביחידות בלוק/פריט/הערה.
2. מרחבי-שם: `doc-`, `blk-`, `itm-`, `note-`, `anc-`, `ast-`, `sty-`.
3. המונה `t#` של זרם הטוקנים הוא **נגזרת של adapter היציאה בלבד** (סדר פליטה דטרמיניסטי) — אינו זהות המודל.
4. פריט שנחתך חזותית: כל המופעים מפנים לאותו `id`; הבחנת מופע רק דרך `occurrenceKey(id, i)` שנקבע בשלבי העימוד.
5. מחיקת פריט אסורה; פריט שאינו ממוקם ⇒ diagnostic.

## 6. כללי אימות (`validate.js`)

מחזיר `{ok, errors, warnings, stats}` — **אף הפרה לא נעלמת בשקט**:

| קוד | חומרה | תנאי |
|---|---|---|
| `block-kind-unknown` / `item-kind-unknown` | error | סוג מחוץ למילון |
| `custom-kind-unregistered` | error | `custom:*` ללא רישום ב-registry |
| `item-id-duplicate` / `block-id-duplicate` / `note-id-duplicate` | error | מזהה כפול |
| `item-order-gap` | error | רצף סדר שבור |
| `item-source-range-invalid` / `item-source-text-missing` | error | טווח/טקסט מקור חסר — אובדן מיפוי |
| `note-marker-orphan` / `note-body-orphan` / `note-marker-ref-invalid` | error | קישור הערה שבור |
| `note-continuation-identity-missing` | error | זהות המשך חסרה |
| `anchor-target-*-orphan` | error | עוגן יתום |
| `heading-without-text` | error | כותרת ללא טקסט ממשי |
| `consecutive-headings-no-text` | error | שתי כותרות רצופות מאותה רמה ללא טקסט ביניהן |
| `text-item-runs-empty` / `run-source-invalid` | error | פריט טקסט בלי מקטעים / טווח גופן פגום |
| `image-asset-id-invalid` | error | תמונה בלי זהות נכס |
| `image-dimensions-pending` | warning | מידות טבעיות — ייפתרו בשלב 3 (מתועד, לא נבלע) |
| `skeleton-line-uncovered` | error | שורת מקור ללא סיווג |
| `unmatched-note-closer` (בבלוק) | warning | תוחם לא תואם — דוקטרינת "דווח, לא תקן" |

## 7. חוזה ההרחבה (registry)

**מרשם יחיד** (`model/registry.js`): הוספת סוג פריט = רישום descriptor אחד עם החריצים `schema`, `validate`, `parse` (אופציונלי), `resourceDeps`, `styleResolution`, `measurementContract`, `layoutConstraints`, `diagnostics`, `projectionContract`. חריצי המדידה/ההקרנה הם **מזהי חוזה** ששלבים 3–8 מחברים אליהם מימוש — לא מימוש בשלב זה. חוקים קשיחים: kind מובנה אינו ניתן להחלפה; `custom:*` חייב קידומת; רישום כפול = שגיאה; פרסר של סוג תובענות מקור רק בהחזרת `consumed > 0`. הוספת kind **אסור** שתדרוש ענף pipeline/breaker/planner/מקרין נפרד.

## 8. חוזי adapters (גבולות זמניים)

| adapter | מיקום | כיוון | תנאי הסרה |
|---|---|---|---|
| `modelToTokens` | `model/adapter.js` | מודל → זרם טוקנים ל-DP pipeline | שלבים 3–4: כשה-pipeline יצרוך את המודל ישירות (מדידה/שבירה מ-Inline Item Model) — ה-adapter ומבנה הטוקנים יימחקו יחד |
| `reconstructSource` | `model/roundtrip.js` | מודל → מקור | קבוע (הוכחת שימור — נשאר לנצח כבדיקת נכס) |

שני ה-adapters טהורים, מסומנים, מוגבלים לגבול, בעלי בדיקות round-trip (41 בדיקות + הקורפוס הראשי). **הוכחת שקילות:** `modelToTokens(buildDocumentModel(x)) ≡ tokenize(x)` — deep-equal על כל סוגי התוכן ועל `very_long` (5,683 טוקנים). הפרסר של המסלול המורשת (`legacy-imud-flow.tokenizeDoc`) לא שונה — הכלה מלאה בשלב 9 בלבד.

## 9. מילון מונחים (מחייב)

`פריט (Item)` · `מקטע (Run)` · `בלוק (Block)` · `מסמך (DocumentModel)` · `שורה (LineModel — שלב 4)` · `תוכנית עמוד (PagePlan — שלב 5)` · `מודל עמוד (PageModel — שלב 7)` · `מקרין (Projector)` · `עוגן (sourceRange/anchor)` · `נכס (assetId)` · `סמן הערה (noteMarker)` · `גוף הערה (noteBody)` · `ריהוט עמוד (pageFurniture)`. ייצוגי ביניים היסטוריים (word/token/box) ממופים למילון זה דרך adapter היציאה בלבד.

## 9. שכבת המדידה הקנונית (שלב 3 — נוסף 16.11)

- **זהויות נכסים:** המודל שומר זהות מסמך מהמקור (`ast-…` מ-resourcePath); פתרון התוכן נקשר בזמן הבנייה עם AssetResolver (`buildDocumentModel(raw, {assets})`) — `payload.contentAssetId` = `ast-<kind>-<sha256[:14]>`, ומידות טבעיות מבתים אמיתיים (`resolution.resolved`). בלי resolver — ה-pending המתועד של שלב 2 נשאר (אבחון, לא השמטה).
- **מדיניות הצבת תמונה:** `IMAGE_PLACEMENT` (inline/block/centered/float-start/float-end) ב-`constraints.placement` — אילוצי אותו מנוע (§3.1-4), לא מסלולים.
- **מדידה:** `measureItem`/`measureDocumentModel` (הרחבת MeasureAPI) — MeasuredItem בלתי-ניתן לשינוי: advance (לשבירה) נפרד מ-inkBounds (להקרנה), segments פר-ריצה, breakOpportunities, מטמון מפתח מלא כולל חית סביבה. פירוט מלא: `audits/STAGE3_MEASUREMENT.md`.

## 10. נקודות הכרעה הממתינות לאישור המשתמש (לא הוכרעו בשלב זה)

1. **שאלה 14 — אישור החוזה:** `spec/03_UNIFIED_ITEM_CONTRACT.md` נותר טיוטה מאושרת-טכנית; המימוש עוקב אחריו אך לא מקבע אותו כמחייב. **הצעה מנומקת לאישור המשתמש** (נוצרה סתירה בין החוזה למימוש ויש להכריע אותה במפורש):
   - **(א) `participates: none`** — החוזה מגדיר `inline|block|pageFurniture|background` בלבד, אך המימוש משתמש בערך `none` לבלוקי editorial (יחד עם `removed: true`). ההצעה: להוסיף לחוזה את `none` בהגדרה מפורשת — שמירה במודל לחשבונאות מקור לבלוקים שהוסרו מהפלט ואינם משתתפים בעימוד; החלופה החלשה — הסרת הערך מהמימוש והסתפקות ב-`removed` לבד — מאבדת את ההבחנה המפורשת ליזורי שלב 5.
   - **(ב) מרחבי הזהות** — נעולים מיד המימוש: `doc-` / `blk-` / `itm-` / `note-` / `anc-` / `ast-` / `sty-`; ההצעה לקבעם בחוזה כרשימה סגורה.
   - **(ג) תמונות בכותרות ובהערות-סיום** — סעיף 3 להלן; ההצעה: לאשר את ההגדרה הנוכחית (כותרות והערות-סיום בלתי-תמונות) כברירית מחדל, ולהשאיר לשלב 3 את השאלה המשמעותית בלבד (האם תמונה inline רשאית להופיע בכותרת מתומכת).
2. **שאלה 12 — שכבת ברירות המחדל:** `styleRef.resolvedBy` מתעד את מקור הפתרון ('body-default' / 'per-run' / 'note-marker-style') אך אינו מכריע איזו שכבה קנונית — נדרש לפני שלב 3.
3. **תחביר inline בכותרות/הערות-סיום:** המימוש מפרסר כותרות והערות-סיון ב-`allowImages: false` (תמונות נשארות טקסט מילולי שם); גופי הערות-שוליים ב-`allowImages: true`. הכרעה סופית — אם וכשתידרש תמונה בכותרת.
