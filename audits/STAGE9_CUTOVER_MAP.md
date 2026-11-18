# STAGE9_CUTOVER_MAP — מיפוי נתיבי מורשת לקראת המעבר (§6.1)

> **בסיס:** main `a967e51` (לאחר מיזוג PR #40 — פרוסות 4–6). מסמך זה הוא מלאי הקוד המחייב לשלב 9: כל נקודות ה-dispatch, המבנים הכפולים ונתיבי המורשת, עם ראיות מספרי שורה ותנאי ההסרה של כל יחידה. שלב 9 אינו ניקוי קוסמטי — כל הסרה מותנית בשערי parity של §6.2 (STAGE9_SHADOW report) ובשימור ברירות המחדל המאושרות של המשתמש.

---

## 1. נקודות ה-dispatch החיות (היכן מוחלט בין מנוע מורשת למאוחד)

| # | נקודה | קוד | תנאי | מסלול מורשת | מסלול מאוחד |
|---|---|---|---|---|---|
| D1 | עימוד | `core/pipeline.js:123` | `_layout-profile==='imud' && _imudRaw` | `legacyTypeset` (`layout/legacy-imud-flow.js`, 3,815 שורות) | המשך `typeset` — DP מאוחד |
| D2 | תצוגת DOM | `ui/preview-tab.js:452` | `profile` = legacy/unified | `dom-renderer.renderPage` → `renderLegacyPage` (`dom-renderer.js:1388→761`) | `pagemodel-dom-renderer.renderModelPage` (524 שורות) |
| D3 | ייצוא HTML | `ui/app-shell.js:674-680` | קיום `pageModel` | `exportHtml(result,…)` (`export-api.js:59`) | `exportHtmlFromModel(model,…)` (`export-api.js:95`; חוסר מודל = שגיאה מפורשת) |
| D4 | ייצוא PDF | `ui/engine-worker-main.js:89-100` | `_lastTypesetResult.pageModel && !legacyProfile` | `exportPdf(text,…)` (`export-api.js:150` — **typeset שני** + הקרנה) | `exportPdfFromModel(model,…)` (`export-api.js:532` — אפס עימוד חוזר) |

**תצפית מחייבת:** הפרופיל החי כברירת מחדל הוא legacy (IMUD). הפרופיל המאוחד נבחן רק באודיט מפורש (ללא שינוי ברירת מחדל המשתמש — עד §6.3).

## 2. מבני ביניים כפולים

| מבנה | מקור | צרכנים פעילים | הסרה מותנית ב |
|---|---|---|---|
| `result.pages` (פורמט מורשת, `page.legacy`) | legacyTypeset | D2 (renderLegacyPage), D3-legacy, D4-legacy, run-ours/corpus-invariants | 9c — לאחר ש-D2/D3/D4 מאוחדים והקורפוס עובר מהמודל |
| `result.pageModel` (pagemodel-v1) | buildPageModel (שני הפרופילים!) | D2/D3/D4 המאוחדים | נשאר — מקור הגיאומטריה היחיד |
| `legacyProfile` (דגל תוצאה) | legacy-imud-flow:3793 / worker-protocol.js:58 | app-shell:447, preview-tab:452, engine-worker-main:89 | 9c |
| `projected` (legacy-projector) | `legacy-projector.js` (784 שורות) | exportPdf-legacy בלבד | 9c |
| `geometry-projector` facade | `geometry-projector.js` (68 שורות) | exportPdf-legacy (projectDocument), בדיקות | 9c (לאחר אימות אפס צרכנים) |

## 3. נתיבי מורשת לפי יחידות הסרה (PRs נפרדים, סדר מחייב)

### 9a — מיפוי + השוואת צללים (§6.2) — **בוצע (18.11)**
- כלי: `tools/stage9/shadow-compare.js` — מריץ את אותו טקסט בשני הפרופילים (מורשת חי; מאוחד בקונפיגורציית cutover: הגדרות IMUD ללא דגלי המורשת) ומשווה זהויות ב-12 שערים.
- דוח: `audits/STAGE9_SHADOW_2026-11-18.md`.
- **תוצאה:** קנוני — 10/12 שערים (שני ממצאים: ערכי מטא, h3). very_long — **אין parity**: ביאורי-צד 1,147 מול 2,041 (השמטת ~44% במאוחד — F-9a-3), הערות-גוף 129 מול 81, TOC חלקי, (מקור:) א-סימטרי, שער-אחורי דליל.
- **השלכה:** 9c (הסרות) חסום עד הכרעת F-9a-1…F-9a-8 ב-9b.

### 9b — העברת תיקוני שורש שנותרו למסלול המאוחד
- H3: **הושלם** ב-PR #35 (SSOT `core/h3-contract.js` בשני המנועים).
- Full-Math: **הושלם** ב-PR #36 (רצפת מילות-תוכן + משמר זהויות).
- יתרת הפערים תיקבע לפי דוח 9a (כל פער תוכן = חסימת המשך).

### 9c — הסרת מנוע המורשת (יחידות קטנות, כל אחת עם הוכחות) — **בוצע (18–19.11, PRs #50–#60)**
1. **D4-legacy:** ✅ 9c.1 (PR #50) — ייצוא PDF מה-PageModel בלבד; legacy ללא מודל = שגיאה מפורשת.
2. **D3-legacy:** ✅ 9c.2 (PR #55) — ייצוא HTML מה-PageModel בלבד (`exportHtmlFromModel`), בלי `typeset`/`projectDocument`/parser בנתיב.
3. **D2-legacy:** ✅ 9c.3 (PRs #56, #58) — DOM unified כמקרין PageModel: `preview-tab`, `caret-map`, `buildDebugJson`/`getState`/`canonicalPages` מהמודל; קישורי TOC מהמודל בתצוגה החיה.
4. **D1:** ✅ 9c.4 (PR #60) — הסרת dispatch ל-`legacyTypeset` מה-pipeline; אתחול unified תמידי; ה-Worker/DOM/HTML/PDF מקרינים טהורים. המורשת נותרה **פורט עצמאי מפורש** לכלי אבחון/צלב-ייחוס (`legacyTypeset` ישירות; `exportPdf` עם `engine:'legacy'`) — לא דרך המוצר. הגדרות המשתמש נשמרו (ערכת 40, שערים, גופנים — הפרוטוקול מעביר settings כמו שהיו).
   - במהלך 9c.4 נתפסה ותוקנה בשורש רגרסיית HEADER_POSITION בעמודי פתיחת-סימן (b324782): `headerGeometry` מפחית `h2TopOffset` — הכותרת הרצה נשארת בראש העמוד; סף האודיט הקבוע (107.2) הוחזר ב-full-math-audit (הריכוך "מודע-תבנית" שהסתיר את הרגרסיה בוטל).
5. **9c.5 — הסרת תוצאות כפולות מהפרוטוקול:** הפרוטוקול (`ui-result-v1`) מעביר PageModel + מזהה-מקור (tokens) + דיאגנוסטיקה + המלצות בלבד. הוסרו: `pages` (עמודי התוכנית הגולמיים), `toc`, `tocInsert`, `numberingAudit`, `plannedLayoutHash`. `buildCaretMap` — צורת קריאה אחת (text, tokens, modelPages). `legacy-imud-flow.js`/`legacy-projector.js`/`legacy-settings-map.js` **נותרו** — צרכנים פעילים מוכחים: פורט המורשת (pipeline), `exportPdf` engine:legacy, cross-check/run-ours, 8+ קבצי בדיקה. callgraph (`tools/scan-control-triggers.js`) — 0 הפרות; 3 נתיבי מנוע מותרים (onExplicitRetypeset, engine-worker-main.onMessage, worker-client).

**נעילות אחרי 9c:** canonical `fdff19d8` (ללא שינוי מ-9b); very_long DP `2f8d492e` (1216→1241 עמודים — תיקוני שורש מתועדים בגוף PR #60; שימור תוכן מלא: 86,825=86,825 שורות, מילים זהות בכל האזורים); מורשת `legacy-28f52` (ללא שינוי).

### 9d — סגירת מסמכים
- `ENGINE_RUNTIME_PATHS.md` — עדכון תרשים הצינור (נתיב ה-PDF כבר אינו מריץ typeset שני בפרופיל המאוחד; סעיף 43 מיושן).
- `ENGINE_DUPLICATION_REGISTER.md`, `WORKLOG.md`, `ISSUE_REGISTRY.md`, `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md`.

## 4. נתיבים מתים/מנותקים מועמדים להסרה בשלב 9 (מ-ENGINE_RUNTIME_PATHS §10, לאימות מחדש)

| נתיב | ראיה | פעולה |
|---|---|---|
| `decoration/assets-import.js` | אין קריאה מחוץ לבדיקות | אימות callgraph והסרה |
| `balancing.balancePage` (ישן) | הוחלף ב-optimalSplit/balancePageSafe | הסרה |
| `geometry-projector.attachBasases` | אפס צרכנים | הסרה |
| `shaar-pages.buildPickerModel` + theme-sets | בדיקות בלבד | הכרעה |
| `importProjectZip` (Buffer-gated) | אין חיבור UI | אימות והכרעה |
| שדות מתים (`blk.dh`, `block.firstWord`) | pipeline/dropword | הסרה עם יחידת D1 |
| קישור מורשת `tok#ordinal` | legacy-imud-flow:1446 | יורד עם D1 |

## 5. שערי קבלה לסיום שלב 9 (מההוראה §6.3) — **נבדקו ועברו (19.11)**

- [x] מנוע עימוד פעיל אחד; מקור תוכן אחד; מודל שורות אחד; Planner אחד; PageModel אחד. *(9c.4 — dispatch הוסר; המורשת פורט מפורש לכלים בלבד.)*
- [x] מקרינים טהורים (אפס מדידה/עימוד ב-DOM/HTML/PDF). *(בדיקות שליליות: patch-זורק על typeset/projectDocument בכל מקרין — s9c-cutover/s9c-html-export/s9c-pdf-export.)*
- [x] rollback ברמת commit, לא מנוע שני פעיל. *(אין dispatch; git revert של PR #60 מחזיר את המצב הקודם.)*
- [x] ברירות המחדל והגדרות המשתמש המאושרות נשמרות. *(settings עוברים כמו שהיו; canonical `fdff19d8` ללא שינוי; ערכת IMUD נטענת כרגיל.)*
- [x] `npm test` (84 סוויטות) + determinism + cross-check + corpus-invariants (C1–C12: 12/12) + layout-audit (9/9 + 793/793) + full-math-audit (0 בעיות + דטרמיניזם) ירוקים. *(CI של b324782 — כל הבדיקות ירוקות.)*
