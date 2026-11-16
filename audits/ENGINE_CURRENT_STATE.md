# ENGINE_CURRENT_STATE — מפת מצב עדכנית של המנוע (שלב 1)

> **מסמך:** תוצר שלב 1 לפי `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md` §1.2.
> **Commit:** `95e829d44e88f436c9397d82473cd9e2f4a698aa` (main, 15.11.2026, PR #18).
> **כל ההפניות לקו�ד הן ל־`red-build/src/` ומספרי השורות נכונים ל־commit זה.**
> מסמכים משלימים: `ENGINE_RUNTIME_PATHS.md` (מסלולי ריצה), `ENGINE_DUPLICATION_REGISTER.md` (כפילויות), `SETTINGS_AND_TEXT_IDENTIFIERS_AUDIT.md` (הגדרות), `RELATED_REPOSITORY_REUSE_AUDIT.md` (מאגרים), `baseline_stage1/summary.md` (baseline).

---

## 1. תמצית מנהלים — המצב האמיתי במשפט אחד

**במוצר רצות כרגע שתי מערכות עימוד מלאות ומקבילות** — מנוע מורשת נאמן-מקור (`legacy-imud-flow.js`, 3,720 שורות, הנתיב **ברירת המחדל החיה**) ומנוע DP מודרני (`pipeline.js`+`kp-linebreak.js`+`dp-planner.js`) — עם מקרינים כפולים לכל נתיב, מודלי נתונים מתחרים לכל שלב, ומדידה שמופעלת מחדש בייצוא. הבחירה ביניהן אינה הגדרת משתמש אלא תוצר של נוכחות נכסי ייבוא (`_imudRaw`) בשעת האתחול.

## 2. מצב המאגר בפתיחת השלב (אומת 15.11.2026)

| פריט | מצב |
|---|---|
| `main` HEAD | `95e829d` — "docs: canonical 10-stage engine completion plan" (PR #18, ממוזג) |
| PRs פתוחים | **#17** (draft, `feat/unified-constraint-stage1` @ `df17d36` — אודיט פורנזי+תיקוני FX-1..FX-6 מהתוכנית הקודמת; **לא בתוקף כתוכנית ביצוע** — עבודה קודמת של סוכן, לא נדרס) · **#16** (`feature/agent-2-ssot-fn-anchor` @ `43d5fe6`) · **#15** (draft, `s14/integrated-engine-p0-20261112` @ `cd14c7c`) · **#14** (draft, `docs/user-decisions-and-inline-content-20261112` @ `881a9ce`) |
| Actions על `95e829d` | test(18/20/22)=success · corpus-invariants=success · **layout-audit=failure** · **full-math-audit(local)=failure** (פירוט ב־baseline) |
| היקף קוד מנוע | 80 קבצי JS ב־`red-build/src/{engine,ui,audit}` ≈ 18,767 שורות (ליבה 58 קבצים ≈ 12,000 שורות); הגדלים הגדולים: `legacy-imud-flow.js` ‏3,720 · `dom-renderer.js` ‏1,507 · `pipeline.js` ‏1,226 · `geometry-projector.js` ‏878 · `legacy-projector.js` ‏783 · `pdf-writer.js` ‏767 |

## 3. שני המנועים — מנגנון הבחירה והמשמעות

**נקודת הפיצול:** `core/pipeline.js:123-126` —

```js
if (settingsIn && settingsIn['_layout-profile'] === 'imud' && settingsIn._imudRaw) {
  const { legacyTimeset } = require('../layout/legacy-imud-flow');
  return legacyTimeset(rawText, settingsIn, env);
}
```

**מי מציב את הדגלים (בזמן אתחול המוצר):** `ui/browser-entry.js:167` → `imud.loadLegacyDefaults()` → `importImudSettings()` (`core/legacy-settings-map.js:448-453`) — מופעל כשקובץ `assets/imud/default_settings.json` נטען בהצלחה ומכיל מפתחות מקור (`fn-delim-open`, `size-body`, `line-height-body`). ההחלה: `app-shell.js:202-203` (`Object.assign(settings, imported)`).
**נפילה ל־DP:** אם טעינת הנכסים נכשלת (פתיחה מקומית/ניתוק) — בשקט, ללא הודעת משתמש ב־Work_2 (ב־Red קיים `ui/boot-failure.js` לכך — ראה אודיט מאגרים).
**אין מפתח רישום לבחירת מנוע** — אין `useDP`/`engine-mode`; הבחירה היא תוצר של נכסי מסמך ולא הגדרת משתמש (ראה שאלה פתוחה חדשה §9.1).

**המשמעויות המבניות:**

| היבט | נתיב מורשת (ברירת מחדל חיה) | נתיב DP (מודרני) |
|---|---|---|
| נקודת כניסה | `legacyTypeset()` — `legacy-imud-flow.js:871` | `typeset()` — `pipeline.js:113` |
| טוקניזציה | פנימית: `tokenizeDoc()` — `legacy-imud-flow.js:303` | `dfa-lexer.lexDocument` `:164` + `block-tokenizer.tokenize` `:165` |
| שבירת שורות | **גרידי** משלו: `class LineBreaker` — `legacy-imud-flow.js:407` | Knuth-Plass: `kp-linebreak.breakLines` (דרך `pipeline.js:285-583`) |
| תכנון עמוד | `flowSection` — `legacy-imud-flow.js:1319` | `dp-planner.planPages` — `dp-planner.js:89` |
| הערות | `fnReserveFor`/`placeFootnoteArea` — `legacy-imud-flow.js:2497-2813` | `footnote-budget.js` + `dp-planner.js:233-321` + `side-notes.js` + `endnote-pages.js` |
| מקרין | `legacy-projector.projectLegacyDocument` — `legacy-projector.js` | `geometry-projector.projectDocument` — `geometry-projector.js:55+` |
| בחירת מקרין בייצוא | `result.legacyProfile` → `export-api.js:135-137` | שם |
| בחירת רינדור בתצוגה | `page.legacy` → `dom-renderer.js:1318` | שם |
| היקף קוד | ~3,720 שורות בקובץ אחד | ~2,900 שורות ב־11 מודולים |

## 4. אינוונטר מודולים — לפי שכבה, עם סיווג מצב

סיווגים: **חי-מורשת** (רץ בנתיב המוצר הנוכחי) · **חי-DP** (רץ בנתיב המודרני) · **חי-שניהם** · **מתאם** · **מת** (ללא צרכן במוצר — ראיות ברגיסטר הכפילויות §5 שם).

| מודול | שורות | מצב | הערות מפתח |
|---|---|---|---|
| `core/pipeline.js` | 1,226 | חי-DP + מנהיג מורשת | הפיצול בשורה 123; מודל התוצאה `:1202-1223`; הוכחות שלמות `:894-1107`; `layoutHash` `:1183` |
| `layout/legacy-imud-flow.js` | 3,720 | **חי-מורשת (ברירת המחדל)** | מונולית: טוקניזציה+שבירה+תכנון+הערות+TOC+שערים+גיליון+hash משלו |
| `layout/dp-planner.js` | 634 | חי-DP | `planPages:89`, `optimalSplit:170`, `rejectToBody:295-321`, retreat+protections `:531-561`, `alignColumnBottoms` (D-101) `:659-671` |
| `typography/kp-linebreak.js` | 242 | חי-DP | KP אמיתי (הוחי ב־D-79); **לא רץ כלל תחת פרופיל imud** |
| `typography/measure-api.js` | 247 | חי-שניהם | ברירת מחדל `measure-impl:'table'` (`settings-registry.js:307`); שדרוג שקט ל־`font-metrics` כשנרשם גופן (`measure-api.js:237-242`); ייצוא מאלץ font-metrics (`export-api.js:117-122`) |
| `typography/measure-table.js` | 43 | חי | טבלת קירוב `FONT_PROFILES` — מקור A של רוחב כשאין גופן |
| `typography/font-metrics.js` | 376 | חי | פרנסר sfnt עצמאי (D-72) — מקור B |
| `layout/candidate-generator.js` | 41 | חי-DP | נקודות חיתוך `{cut,before,after,capacity*,score}` |
| `layout/column-flow.js` | 68 | חי-DP | `colCapacityOf:54` — מקור יחיד לקיבולת (S5.2 P-2) |
| `layout/footnote-budget.js` | 72 | חי-DP | probe==reservation (P1-1); גורם רוחב גופן משלו |
| `layout/retreat-loop.js` | 153 | חי-DP | נקרא רק מ־`dp-planner.js:532-561`; מתקן רק column-imbalance; לא רץ במורשת |
| `layout/balancing.js` | 287 | חי-DP (חלקי) | `optimalSplit`/`balancePageSafe` בשימוש; **`balancePage` ישן — מת** |
| `layout/protections-matrix.js` | 281 | חי-DP | אלמנות/יתומים/סדר-קריאה — ledger או תיקון |
| `layout/headings-escort.js` | 33 | חי-DP | החזרת כותרות-זנב |
| `layout/ordering.js` | 29 | חי-DP | `moveLineForward` (D-49) |
| `layout/side-notes.js` | 177 | חי-DP | `placeSideNotes:106-114` — כותב יחיד למיקום הערות-צד |
| `layout/endnote-pages.js` | 215 | חי-DP (דלוק כברירת מחדל) | מופעל רק ב־`endnotes-mode` |
| `layout/page-templates.js` | 89 | חי-DP | סוגי עמודים/קיבולות |
| `output/geometry-projector.js` | 878 | **מתאם (PDF בלבד)** | CP5 → מלבנים; **לא בנתיב התצוגה החיה** — נצרך רק מ־`export-api.js:137` |
| `output/legacy-projector.js` | 783 | מתאם (PDF בלבד) | מקביל לנתיב המורשת |
| `output/dom-renderer.js` | 1,507 | חי (תצוגה+HTML) | מרנדר ממודל העמודים ישירות (`renderPage`); **מתעלם מהמקרינים** — תנאי `page.legacy` בשורה 1318 |
| `output/pdf-writer.js` | 767 | חי (PDF) | צורך פלט מקרין בלבד (עם נוסחאות גיבוי רדומות `:407-448`) |
| `output/line-font.js` | 59 | חי-מורשת | פונקציות עזר גופן/צבע לשערים (S73) |
| `output/html-export.js` | 190 | חי | עוטף את אותו `renderPage` |
| `output/export-api.js` | 575 | חי | ייצוא = **הרצת עימוד שנייה** עם font-metrics (`:117-122`) + הקרנה |
| `parser/*.js` (3 קבצים) | 394 | חי-DP | לא בנתיב המורשת (לה מטוקניזציה משלה) |
| `notes/markers.js` | 186 | חי-DP | MARK_TAG=E102, placeholder E000 (D-53/D-30) |
| `decoration/*` (17 קבצים) | ~2,600 | חי (מעורב) | ornament-fit מקור יחיד למידות; `assets-import.js` **מת** (בדיקות בלבד) |
| `import/docx-import.js` | 220 | חי (חוט UI) | רץ בחוט ה־UI, לא ב־Worker; מחזיר טקסט שטוח — **משמיט תמונות בשקט** |
| `ui/*` (18 קבצים) | ~6,000 | חי | המנוע ב־Worker (`engine-worker-main.js:92` → `typeset`) |

## 5. עובדות מצב קריטיות לשלבים 2–9 (עם ראיות)

1. **הטוקניזר המודרני לא מכיר תמונות בכלל.** הפלט היחיד של `block-tokenizer.tokenize` הוא `heading|paragraph|endnote|endnote-class|editorial` (`block-tokenizer.js:41-129`). תמונות קיימות רק כערוץ צד: עיטורים (`ornament-plan.js:306-326`), רקעי שערים (`page-decorations.js:52-104`), תמונות עמודים מותאמים (`custom-pages.js:55-67`). **תמונה אינה יכולה להופיע בתוך פסקה או הערה כיום.** פירוט: `ENGINE_RUNTIME_PATHS.md` §6.
2. **מילה עם כמה מקטעי גופן — בלתי-אפשרית במודל.** המילים הן מחרוזות בלבד (`kp-linebreak.js:41` — boxes `{text,width}`); family הוא תכונת שורה/בלוק, לא פריט. מה שכן שורד לפי-מילה: `fontKey` בפרויקציה (`geometry-projector.js:730-736` → `pdf-writer.js:348-376`). פירוט: `ENGINE_RUNTIME_PATHS.md` §7.
3. **קישור סמן→גוף הערה הוא ניתוח מחרוזות חוזר.** מבני בפרשנות (`note-ref{noteIndex}` — `block-tokenizer.js:118-126`), אך מומר ל-placeholder `${E102}${marker}\uE000${text}` (`pipeline.js:492`) ומפוצח מחדש ב־6+ אתרים (`pipeline.js:908-917,1044-1058`, `markers.js:150-151`, `footnote-budget.js:20`, `geometry-projector.js:448/457/510`, `dom-renderer.js:49`). פירוט: `ENGINE_RUNTIME_PATHS.md` §8.
4. **המקרינים אינם מקור הגאומטריה של התצוגה החיה.** `geometry-projector`/`legacy-projector` נצרכים רק בנתיב PDF (`export-api.js:135-137`); ה־DOM מרנדר ממודל העמודים ישירות. "תצוגה=ייצוא" נאכף כיום בבדיקות/אודיטים, **לא בבנייה**. פירוט: `ENGINE_DUPLICATION_REGISTER.md` §D2-D4.
5. **ייצוא PDF מריץ עימוד שני.** `exportPdf` קורא `typeset` שוב עם font-metrics (`export-api.js:117-122`) — שלוש הפעלות MeasureAPI נפרדות (חי/ייצוא/פרויקציה) שצריכות להסכים (היסטוריית EXT-13/S71.1: סחף 2-17%). פירוט: `ENGINE_DUPLICATION_REGISTER.md` §D13.
6. **פער נתיבים מבני:** very_long — מורשת Node: 695 עמ' (`legacy-287c1`) · מורשת דפדפן (חי): 699 עמ' · DP: 1335 עמ' (`77d5d5d3`). שלוש תוצאות שונות לאותו קלט.
7. **ממצאי baseline פתוחים (מאומתים מחדש על `95e829d`):** npm test 849/849 ו־C1–C12 ב־12/12 עוברים; אך full-math — רצפת נפח 353,687<355,967 מילים; layout-audit — `SIDE_NOTE_OVERLAP` עמ' 107 (8px+2px). פירוט והשערות שורש: `baseline_stage1/summary.md` + `ENGINE_DUPLICATION_REGISTER.md` §6.
8. **באג R-03 קיים כאן:** דגלי סוגריים של מילה עם סמן מודבק מאופסים ומדליפים מצב עומק — `legacy-imud-flow.js:574-577`; תיקון שורש מפותח ונבדק ב־Red (PR #48) — ראה `RELATED_REPOSITORY_REUSE_AUDIT.md`.

## 6. החלטות משתמש מאומתות מול הקוד (משימה א׳ — סיכום)

ההפרדה המלאה בין החלטות משתמש / דרישות פונקציונליות / הצעות AI שלא אושרו / מימושים / החלטות שהוחלפו — מבוססת על `DECISIONS.md` (D-30..D-106), `PROVENANCE.md`, `spec/01/02` והיסטוריית העבודה:

- **החלטות משתמש מפורשות שאומתו בקוד הנוכחי (הכל תקין):** D-91 (הערות רציפות/מספור פר-פרק/תקרת מרזב; `settings-registry.js:145,148` + `legacy-imud-flow.js:900-904`), D-92 (FIT_EPS=0.75), D-94 (השתמרות כהפרש, `settings-persistence.js:82-96`), D-96 (json_theme_40 באתחול), D-98 (very_long ראשי), D-100 (ביטול parity — ה־workflow הוא corpus-invariants בלבד), D-101/D-106 (stretchLastBlockToBottom דלוק כברירת מחדל `legacy-imud-flow.js:786-788`; alignColumnBottoms `pipeline.js:661-670`; RED_ENABLE_STRETCH_RECLAIM רק למשיכת זנב), **justify דלוק ומוקשח** בכל שלושת נתיבי הפלט (`dom-renderer.js:935-939`, `html-export.js:47`, `legacy-projector.js:106/352/357/406`) — אין הגדרה שיכולה לכבותו.
- **החרגות התוכנית שאומתו:** P6/P7 אינם בשום workflow/שעת (D-100); אין בדיקת התאמה לייחוס ב־CI; ערכת 40 (`json_theme_40`) פעילה אוטומטית; מסלול legacy לא נמחק.
- **אנומליות תיעוד שנמצאו:** (א) **D-106 ו־D-101 כמעט זהות** (אותה החלטה תועדה פעמיים; שורת "עדכון אחרון" מצביעה על D-101) — פגם פנקס, לא סתירת תוכן. (ב) הערות "849 עמ'" מול "704" מול "699" במקומות שונים בתיעוד משקפות תקופות שונות — יש להסתמך על baseline_stage1 בלבד למספרים עדכניים.
- **הצעות AI שאינן החלטות משתמש (להבליט):** כל סדרת S ו־FX בקוד היא מימוש/הצעה של סוכנים; PR #17 (תיקוני FX-1..FX-6) אינו מאושר ואינו ממוזג; האודיט הפורנזי הקודם (`06_FORENSIC_UNIFICATION_AUDIT_2026-11-15.md` בענף `feat/unified-constraint-stage1`) הוא **חומר רקע** — תוכנית הביצוע היחידה היא `spec/00`.

## 7. מה מונע השלמת שלב 1 (סיכון לשעת הקבלה)

כל תנאי השעה נבדקו ומתועדים במסמכים הנלווים; שני תנאים נשארים **חלקיים** במובן מסוים ומתועדים כסהר: (1) "כל נתיב runtime פעיל ממופה עד הפלט" — מופה, לרבות המתים; (2) "חוזה הפריט האחיד אושר מבחינה טכנית" — החוזה נכתב (`spec/03_UNIFIED_ITEM_CONTRACT.md`) אך אישור סופי הוא החלטת אדריכלות שתיבדק שוב בפתיחת שלב 2. פירוט מלא: §10 במסמך זה.

## 8. מילון מונחים אחיד (משימה 1.1-13)

| מונח | משמעות יחידה | הערות שימוש קיימות שיש ליישב |
|---|---|---|
| **פריט (Item)** | יחידה סמנטית אטומית בזרם התוכן: טקסט, סמן הערה, תמונה, עוגן, פריט מותאם | היום: "word"/"token"/"box"/"מילה" מתחלפים |
| **מקטע (Run/Span)** | רצף תווים בעל סגנון/גופן אחיד **בתוך** פריט | היום: `parts[]` (parser), `customSpans/parenSpans` (line), `scope` (bracket) |
| **מדד (Measurement)** | פלט בלתי-משתנה של MeasureAPI לפריט: advance, ascent/descent, height, bounds | היום: מפוזר ב־4 מקורות רוחב |
| **שורה (Line)** | תוצר השבירה: פריטים מסודרים + מדדים + סיבת חיתוך | היום: שני מודלים מתחרים (KP ומורשת) |
| **טור/עמוד (Column/Page)** | מיכל גיאומטרי בעל קיבולת ממקור יחיד | היום: bands/spanning מתחרים |
| **PageModel** | מודל העמוד הסופי הבלתי-משתנה אחרי הקפאת תכנון | היום: pages[] בשני פורמטים (legacy/DP) + CP5 במקרין |
| **מקרין (Projector/Renderer)** | ציור טהור של PageModel — DOM/HTML/PDF | היום: "projector" (PDF) מול "renderer" (DOM) — חלוקה שרירותית |
| **עוגן (Anchor)** | זהות מקור יציבה של פריט בטקסט המקור | היום: tokenId/paraId/markerIdx/noteIdx מתחלפים |

## 9. שאלות פתוחות חדשות שנרשמו (פירוט ב־OPEN_QUESTIONS.md)

1. **OQ-12 — שכבת ברירות המחדל הקנונית:** הרישום (253 הגדרות, ברירות RED) מול ייבוא ברירות המקור (67 סטיות אפקטיביות). איזו שכבה היא "ברירת המחדל" הרשמית לצורך חוזה ובדיקות שלב 2+? (חוסמת חוזה מדידה והגדרות).
2. **OQ-13 — מדיניות ייבוא עבודה מקבילה מ־Red:** R-03 (תיקון שורש מוכח + בדיקות) ושלושה מודולי UI טהורים — לייבא ב־PR-ים נפרדים לפני/אחרי שלב 2? (חוסם סגירת רישום המועמדים לייבוא).
3. **OQ-14 — מדיניות Node↔דפדפן:** פער 695/699 עמ' — האם לקבע דרישת זהות הפלט בין סביבות כשעת שלב 3, או לתעד סובלנות?
4. **OQ-15 — האנומליה D-106/D-101:** לאשר מחיקת שורה כפולה בפנקס DECISIONS (תיקון תיעודי בלבד).

## 10. שעת הקבלה של שלב 1 — מצב מפורש

| תנאי (מהתוכנית §1.3) | מצב | ראייה |
|---|---|---|
| כל נתיב runtime פעיל ממופה עד הפלט | **הושלם ומוכח** | `ENGINE_RUNTIME_PATHS.md` §1-§5 (שני הנתיבים + ייבוא + Node + מתים) |
| לכל מבנה נתונים יצרן וצרכנים מזוהים | **הושלם ומוכח** | `ENGINE_RUNTIME_PATHS.md` §3-§4 (טבלת מודלים) |
| ידוע היכן מידע אובד או מומר לייצוג מצומצם | **הושלם ומוכח** | `ENGINE_RUNTIME_PATHS.md` §9 (18 נקודות אובדן) |
| כל מסלול מדידה/שבירה/פריסה/רינדור כפול רשום | **הושלם ומוכח** | `ENGINE_DUPLICATION_REGISTER.md` §D1-D15 + מודלים מתחרים |
| baseline ניתן לשחזור על commit מזוהה | **הושלם ומוכח** | `baseline_stage1/summary.md` (commit, פקודות, hashes, תוצאות, קישורי CI) |
| החלטות משתמש והחרגות רשומות ללא סתירה | **הושלם ומוכח** (עם 2 אנומליות תיעוד שתועדו כשאלות OQ-15 ולא כסתירות תוכן) | §6 לעיל |
| כל ההגדרות/מזהי טקסט/קידומות/ברירות עברו אודיט מלא | **הושלם ומוכח** | `SETTINGS_AND_TEXT_IDENTIFIERS_AUDIT.md` (253 הגדרות + 161 מיפויי מורשת + ~42 מזהי טקסט + 34 פסאודו-הגדרות) |
| כל מאגר/ענף רלוונטי נבדק; רכיב מועמד מקושר ל-commit, ראיות, reuse/skip | **הושלם ומוכח** | `RELATED_REPOSITORY_REUSE_AUDIT.md` (6 מאגרים, 12 מועמדים עם הכרעות) |
| חוזה הפריט האחיד אושר מבחינה טכנית ואינו מחייב מסלולים מיוחדים | **חלקי** — החוזה נכתב והוכח מבחינה טכנית מול כל סוגי התוכן הקיימים (`spec/03_UNIFIED_ITEM_CONTRACT.md`), אך אישורו הסופי כהחלטת ארכיטקטורה מסומן לאישור בפתיחת שלב 2 (היררכיית סמכות §0.3: חוזה מנוסח במסגרת התוכנית דורש אישור לפני שהופך למחייב) | `spec/03_UNIFIED_ITEM_CONTRACT.md` |

**תנאי עצירה של השלב לא הופעל** — כל קוד שמופעל במוצר זוהה וממופה.
