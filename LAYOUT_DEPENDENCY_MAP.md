# LAYOUT_DEPENDENCY_MAP.md — מפת תלויות חיה · Tora Book Typesetter Red

> **עדכון שלב 4 (מקטף א׳, 16.11.2026):** נוצר מודול שורות קנוני `src/engine/line/` — breaks.js (מקור אמת להזדמנויות שבירה; משם מייבאים הקיצורים ותבנית הסמן גם לנתיב המורשת) → line-items.js (חוזה LineItem מה-DocumentModel + מדידה דרך measureItem) → kp-linebreak.breakItemSequence (הרחבת ה-KP הקיים) → line-model.js (LineModel + הקצאת glue חד-פעמית). תלות חדשה: measureDocumentModel → buildLineSequences → layoutSequence (תשתית; הצריכה בנתיב המוצר — מקטע ב׳).
> נבנית אוטומטית מה־require-ים בפועל (סקריפט: `node tools/deps.js` או לפי הטבלה). מצב: 03.11.2026 (אחרי S9 — 66 קשתות).
>
> **עדכון שלב 1 (15.11.2026, אודיט על main `95e829d`; ענף audit/stage1-engine-state-20261115):** המפה לעיל מתארת את שכבות ה־DP. מיפוי המסלולים האמיתי המלא (כולל המנוע המקביל) מתועד ב־`audits/ENGINE_RUNTIME_PATHS.md`. עובדות מפתח שאינן נראות במפת ה־require-ים: (1) **מנוע המורשת `legacy-imud-flow.js` (3,720 שורות) הוא ברירת המחדל החיה** — הוא מופעל מ־`core/pipeline.js:123-126` כש־`_layout-profile==='imud' && _imudRaw` (מוצב באתחול המוצר דרך `legacy-settings-map.importImudSettings`), ומכיל בתוכו טוקניזציה+שבירה גרידי+תכנון+הערות+TOC+שערים+גיליון עצמאיים — כלומר ענף `layout/legacy-imud-flow.js` הוא למעשה **מנוע שני שלם** ולא מודול בצינור; (2) `geometry-projector`/`legacy-projector` נצרכים רק מ־`output/export-api.js:135-137` (PDF בלבד — לא בנתיב התצוגה החיה); (3) ייצוא PDF מריץ `typeset` שני עם font-metrics (`export-api.js:117-122`); (4) רגיסטר החישובים הכפולים (15 עובדות, D1-D15) — `audits/ENGINE_DUPLICATION_REGISTER.md`. החוזה האחיד העתידי: `spec/03_UNIFIED_ITEM_CONTRACT.md`.

## שכבות (מלמטה למעלה)
```
parser/        : dfa-lexer → block-tokenizer → bracket-scanner   (אין תלויות כלפי מטה)
typography/    : measure-api, kp-linebreak, protectors, dropword  (אין תלויות כלפי מטה)
notes/markers  : אין תלויות (מקור סמכות לסמנים)
layout/ordering: אין תלויות (moveLineForward — D-49)
layout/        : page-templates ← column-flow
                 footnote-budget (מקור יחיד לתקציב) ← dp-planner
                 dp-planner ← protections-matrix ← balancing ← ordering
                 dp-planner ← retreat-loop, candidate-generator, headings-escort
                 dp-planner ← side-notes, endnote-pages (מזומנים מהצינור)
                 balancing ← ordering; balancing ← dp-planner? לא — דרך ordering בלבד (מניעת מעגל)
decoration/    : ornament-fit (מקור יחיד למידות והזמנות — F-08/F-09)
                 dividers ← ornament-fit; ornament-plan ← ornament-fit + dividers
                 theme-sets, shaar-boxes, svg-sanitize (אין תלויות פנימיות)
                 assets-import ← svg-sanitize + theme-sets
                 shaar-pages ← theme-sets + custom-pages + page-templates
                 custom-pages ← page-templates; page-decorations ← page-templates
                 folio; headers-builder (עצמאות פר‑סלוט — D-61)
                 toc-builder ← page-templates (עמודי TOC אמיתיים — D-62)
                 numbering-audit (pn-sequence/pn-overflow — S9.1.6)
output/        : dom-renderer ← notes/markers + page-decorations + shaar-boxes + ornament-fit + page-templates + folio (isCssFrame)
                 html-export; project-io ← settings-registry
audit/         : report-schema ← dp-planner(layoutHash); scanners ← settings-registry
core/          : pipeline ← כל השכבות (כולל shaar-pages/ornament-plan/custom-pages — S8); events/ledger (שעון לוגי)
```

## קשרים קריטיים (אסור לשבור)
- `footnote-budget.getFootnotesReservedHeight` — מקור יחיד לתקציב המרזב (probe==reserved).
- `notes/markers.markerFor` — מקור יחיד לסמנים (גוף + מרזב + עמודי הערות).
- `layout/ordering.moveLineForward` — הזזות טורים חוקיות בלבד (P0-3).
- `core/pipeline` — הצרכן היחיד של planPages/placeSideNotes/buildEndnotePages (סדר CP1..CP5).
- `bodyGeometryHash` — האינווריאנט T1 (D-47); אסור שפאס העיטורים יזיז שורות.
- **S8:** `ornament-fit` — מקור יחיד למידות עיטורים ולהזמנות גובה (F-08/F-09); הרנדרר והפלנר
  צורכים אותו — אין עותקים מקומיים.
- **S8:** `theme-sets.activateThemeSet` — הפעלת ערכה מפעילה את שלושת השערים (F-10 נעול);
  `uniqueShaarId` מבטיח ייחודיות מזהים (שיעור packerandconfigurator).
- **S8:** `shaar-pages.insertShaarPages` — מוזמן מהצינור לפני צילום ה־hash של CP4 (השערים
  חלק מהבסיס הנמדד; תוספת מוצהרת — לא מוטציה).

## תלויות זמן־ריצה
- אפס תלויות חיצוניות (zero runtime dependencies; engines: node>=18).
- offline-guard: exit 7 על בקשה חיצונית (Orange doctrine).


## שלב 2 — שכבת המודל הקנוני (16.11.2026)

- **מסלול DP מתחיל כעת במודל:** `pipeline.typeset` → `lexDocument` →
  `tokenizeDetailed` → **`model/document-model.buildDocumentModel`** →
  `model/adapter.modelToTokens` → צריכת טוקנים כרגיל. המודל = מקור הסמכות
  בפענוח; הטוקנים = תחזית נגזרת (adapter עם תנאי הסרה: שלבים 3–4).
- `model/document-model` תלוי ב: `parser/dfa-lexer`, `parser/block-tokenizer`
  (tokenizeDetailed), `parser/inline-content` (ריצות), `model/{kinds,identity}`;
  אינו תלוי במדידה/שבירה/תכנון/הקרנה (אפס החלטות גאומטריה).
- `model/roundtrip.reconstructSource` — בדיקת נכס (לא נתיב ריצה): שחזור המקור
  מהמודל; מאומת על very_long char-exact.
- `model/registry` — נקודת הרחבה יחידה לסוגי פריטים; `parser/inline-content`
  קורא לו לפריטים מותאמים (parseInlineItemAt).
- **המסלול המורשת לא שונה:** `legacy-imud-flow.tokenizeDoc` נותר עצמאי
  (רגיסטר כפילויות D-2; מיזוג בשלב 9 בלבד).
- באנדלים: ה-Worker וה-UI בנויים מחדש כולל שכבת המודל (D-65 — sha נבדק).

## חוזה גאומטריית כותרת-רוחב (D-S2H3 — נעילה סמנטית לשלבים 4/5/9; 16.11)

החוזה שהוכח וננעל בנתיב המורשת (הפעיל) וחייב להתקיים גם במנוע המאוחד:
- כותרת = **פריט יחיד** עם מקטעי שורה; זהות הפריט על השורה הראשונה (tokenId) וכל השורות שייכות לו.
- **pitch בין שורות הכותרת = גובה השורה בלבד** (34px בכיוול הנוכחי) — אפס רווח מבני בין שורות הכותרת.
- **הרווח התחתון פעם אחת**, בתוך הפס האחרון בלבד (38=34+4), בין השורה האחרונה לתוכן שאחריה.
- **כותרת חד-שורתית** = פס 38 יחיד; התוכן נפתח בסופו (כיוול S4.14 נעול).
- DOM ו-PDF צרכנים טהורים של y/h — אותן עובדות בתצוגה ובייצוא.
- בדיקת נעילה: `red-build/tests/e2e/s2-heading3-spacing.test.js` (מפרט רצוי מוכח).
- **שלב 4:** מנוע השורות המאוחד מיישם את אותו חוזה (מסלול DP עדיין נושא את מחלקת הפגם — `dp-planner.js` spanning). **שלב 5:** אימות גאומטריה ב-Planner. **שלב 9:** שעת הקבלה של המעבר כוללת הוכחת חוזה זה במסלול המאוחד לפני הסרת המורשת.

## שכבת המדידה הקנונית (שלב 3 — 16.11)

`measureItem`/`measureDocumentModel` (measure-api + measure-model) הם מקור הסמכות למדידה מרגע זה:
- **שלב 4** (מנוע שורות מאוחד): צורך MeasuredItem — advance לשבירה, inkBounds להקרנה, breakOpportunities כמפתחות, segments פר-ריצה לתמונת-גופן מדויקת. **אין למדוד מחדש** בשורות (§3.1-8).
- **שלב 5** (Planner): אילוצי תמונה (IMAGE_PLACEMENT) ומידות טבעיות מה-resolver; חית סביבה בכל MeasuredItem לניטרליות בין סביבות.
- **זהויות:** נכסים `ast-<kind>-<sha256[:14]>` (תוכן) וגופנים `fnt-<sha256[:14]>` (תוכן) — זהות המסמך מהמקור נשמרת במודל ונקשרת בזמן בנייה עם resolver.
- **Worker:** העברת נכסים בסכמה `asset-transport-v1` בלבד.

## שכבת מנוע השורות הקנוני (שלב 4 מקטע א׳ — 16.11)

`buildLineSequences` (line-items) → `layoutSequence` (line-model) → `breakItemSequence`
(kp-linebreak) הם מקור הסמכות לשבירת שורות מהמודל הקנוני:
- **LineItem (חוזה v2):** זהות נגזרת-מקור (`#w@docStart-docEnd`) — יציבה בין בניות;
  sourceRange מוחלט + blockId; פרגמנטים פר-ריצה למילה מרובת-גופנים; צמידות
  סמן⇄עוגן מבנית מקושרת לפי noteRef (glue פנימי + penalty אסור).
- **breaks.js:** מקור אמת אחד להזדמנויות — והוא **משתתף בפועל** בהחלטת החיתוך
  ב-DP (breakBetweenItems + canStartLineWith/canEndLineWith); קיצורים משותפים
  עם protectors של המורשת.
- **תמונות:** inline = תיבה; block/centered = LineModel נפרד; **float = אילוץ
  אזור בלבד** (extractFloats — אין ספירת רוחב כפולה; זהות/עוגן/צד ב-floats/
  floatAreas; מיקום עמוד סופי — שלב 5).
- **justify:** מדיניות מהגדרות המסמך (justifyPolicyOf): גוף stretch (03.11(ד)),
  שורה אחרונה לפי body-last-line-align; הקצאת glue פעם אחת ב-LineModel —
  ה-renderer צורך ואינו מותח.
- **Overflow:** ערוץ דטרמיניסטי אחד; יחידה צמודה אטומית גם בגיבוי
  (overflow-joined-unit עם noteRef); פריט רחב ⇒ overflow-item-own-line.
- **wrap/DP:** lineOf אטומי עם cost/parent + אימות שוט-אחרי מול lineWidthAt
  (אינדקס שורה סופי) — wrap-width-mismatch מדווח מפורש.
- **שלב 5 פרוסה 1 (מומש):** המתכנן צורך את LineModel דרך ה-accessor הטהור
  של הגשר (words/heightPx נגזרים); כל החלטות הקיבולת עוברות constraint-matrix
  (SSOT: חלונות פיצול, תפרים, מחסניות yPx אמיתיות — FX-5); ליווי מכוון-הצבה
  (FX-1); הערות בהכרעת המיקום (FX-3); מונוטוניות טורים מבנית (flowCol);
  נתיבי מרזב/מדדי הערה מ-SSOT (footnote-lanes/noteMetrics). נמדד: המתכנן אינו
  מודד מחדש ואינו משנה מדדי שורה (s5-unified-planner — טוהר).
- **שלב 5 פרוסה 2 (פתוח):** FX-6 (פער בלוקים נצבר), חוזה ColumnModel/PagePlan,
  capacity מורחב.
- **הגבול:** נתיב המוצר עבר למנוע הקנוני (שלב 4 מקטע ב׳ — הגשר
  pipeline-bridge); breakLines נשאר למורשת עד שלב 9; אין breaker/MeasureAPI שניים.

## שכבת ה-Planner הקנוני — חוזים ומדידה (שלב 5 פרוסה 2 — 17.11)

- **gapBeforePx (FX-6):** החותמת על שורת פתיחת הבלוק היא מקור האמת היחיד
  לפער בין בלוקים: שער הכניסה (pushLines), הגובה התפוס (planningUsedHeight
  בתכנון; usedHeight ברינדור), הקרנת DOM (margin-top), הקרנת PDF
  (התקדמות-y), מפריד הטורים ועוגן הערות-צד — כולם נגזרים ממנה. דיכוי
  בראש טור (GAP_HEAD_POLICY); המתיחה חלה על השורות בלבד — הפער קבוע
  (columnStretchParts).
- **plan-model.js (חוזי PagePlan/ColumnModel):** page.plan נבנה בסוף
  ה-pipeline (finalizePagePlans) — validation + freeze; הטורים בהפניה חיה
  (אין מודל מקבילי ל-PageModel העתידי). עמודי זרימה מסומנים dpPlanned.
- **reservations:** page.reservations (all-columns/last-column) — מופחתים
  ב-colCapacityOf; capacityReservationsOf מייצג את כל הגורמים שוללי
  שטח-הגוף — מנגנון הרחבת ריהוט-העמוד של שלב 6.
- **מדידת הערות:** stampNoteMetrics (CP2) — מדידה חד-פעמית עם מבנה שורות
  (noteRows) שהפיצול וההקרנה העתידית (שלב 6/7) יצרכו; noteHeight צורך
  חותמת קודם חישוב; מונה __rowsStats לחשבונאות בדיקה.
- **decision-trace.js:** opt-in; ספירות תמיד; רשומות {p,k,d} קומפקטיות —
  הצבות/פיצולים/ליווי/הערות/נסיגות/overflow.
