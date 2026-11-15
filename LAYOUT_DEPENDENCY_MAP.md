# LAYOUT_DEPENDENCY_MAP.md — מפת תלויות חיה · Tora Book Typesetter Red
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
