# RELATED_REPOSITORY_REUSE_AUDIT — אודיט מאגרים קשורים והכרעות reuse/skip (שלב 1)

> **Commit בסיס:** `95e829d44e88f436c9397d82473cd9e2f4a698aa` (Work_2). תאריך בדיקה: 15.11.2026.
> **שיטה:** בדיקת מצב חי דרך GitHub API (ענפים, PRs, commits, עצי קבצים, השוואות blob SHA) + הורדת קבצים לצורך diff ממוקד. לא הועתק קוד בשלב זה.
> **כלל מחייב (מהתוכנית §1.1-15):** אין לייבא רכיב אם הוא מחייב מסלול עימוד נוסף, שכבת תאימות קבועה או אחריות כפולה.

---

## 1. אינוונטר מאגרים (מצב חי, 15.11.2026)

| מאגר | ענף ברירת מחדל | עדכון אחרון | גודל | תפקיד |
|---|---|---|---|---|
| `Tora_Book_Typesetter_Red_Work_2` | main @ `95e829d` | 15.11 15:24 | 161MB | **המאגר הפעיל** — תוכנית קנונית + כל עבודת S |
| `Tora_Book_Typesetter_Red` | main @ `de92fa0` | 15.11 07:11 | 157MB | RED מקביל — עבודת 5 סוכנים (R-series), התפצל ממשפחת RED |
| `Tora_Book_Typesetter_Red_Work` | main @ `025c8b2` | 11.11 00:40 | 161MB | חלוצת העבודה המוקדמת (סשנים 01-06); מקור תיקון heading-rollback |
| `Tora_Book_Typesetter_React` | main @ `a2fa18e` | 09.11 20:39 | 158MB | מימוש TypeScript+React מלא של ארכיטקטורה מאוחדת ("שלבים 94-100/100") |
| `Tora_Book_Typesetter_Yellow` | V22 | 09.11 12:48 | 206MB | תוכנת המקור הצהובה (V22) — מקור היסטורי/פרובננס |
| `Tora_Book_Typesetter_Orange` | main | 07.11 16:33 | 141MB | מנוע Orange ההיסטורי + קורפוס הבדיקה ההיסטורי |
| `Tora_Book_Typesetter_Green` | V23 | 03.11 15:35 | 221MB | גרסת V23 — renderer-bridge, geometry-audit |

קשרים: Work_2 ו־Red_Work נוצרו באותו בוקר (10.11, בהפרש של 2 דקות) — לא fork רשמי של GitHub; ההיסטוריה משותפת חלקית. PROVENANCE.md של Work_2 מתעד שהבסיס from-scratch עם "היסקים מומרים" מ־Gold/Green/V21/Orange/V1/IMUD.

## 2. פער הפיצול Work_2 ↔ Red — הממצא המרכזי

השוואת עצי `red-build/src` (blob SHA): **35 קבצים שונים/חסרים** בין main של Red ל־Work_2:
- **חסרים ב־Work_2 (4):** `ui/boot-failure.js`, `ui/run-info.js`, `ui/text-decode.js` (+העץ מאשר 88 מול 86 קבצים).
- **שונים (31):** כל קבצי הליבה (pipeline, legacy-imud-flow, dp-planner, geometry-projector, pdf-writer, dom-renderer, settings-registry, legacy-settings-map, markers, side-notes, footnote-budget, balancing, endnote-pages, protections-matrix, ornament-ink, headers-builder, font-subset, export-api, html-export, legacy-projector, line-font + קבצי UI).
- **כיוון הפער:** Work_2 מתקדם בזרימת המורשת (S73-S77: גשר הגדרות חי, צבע פר-גופן, תיקוני הערות S75-S77 — `legacy-imud-flow.js` 3,720 שורות מול 2,981 ב־Red). Red מתקדם בתיקוני R-series ובהקשחת UI.
- **בדיקות:** ל־Red 6 קבצי בדיקה שאינם ב־Work_2 (a1-boot-failure, a1-input-integrity, a1-run-summary, regress/heading-rollback, regress/lib/source-oracle, regress/source-families).
- **מסקנה:** המאגרים התפצלו לשני כיוונים; מיזוג גושי (bulk merge) אסור — כל רכיב דורש הערכה פרטנית.

## 3. רכיבים מועמדים — הכרעות reuse/skip

### R-RC1 · תיקון R-03: דגלי סוגריים של מילה עם סמן הערה מודבק — **החלטה: reuse (ב־PR נפרד, לאחר אישור)**

| שדה | ערך |
|---|---|
| מאגר/ענף/commit | `Tora_Book_Typesetter_Red` · `work/engine-paren-note-flags` · PR #48 (פתוח, +21/-3 במקור; מלווה ב־PR #49 לבדיקת CI) |
| תפקיד | תיקון שורש ב־`legacy-imud-flow.js` `LineBreaker`: כשמילה נושאת סמן מודבק (`רשות)[הערה]`), דגלי הסוגריים אופסו ו־`)` לפני הסמן לא הוריד את מונה העומק — הדלפה שמסמנת את שאר הפסקה "בתוך סוגריים" |
| **הוכחה שהבאג קיים ב־Work_2** | **כן — `legacy-imud-flow.js:574-577`** (אותו דפוס פגיע בדיוק: `wordParen[i]=false; startsInParen[i]=false; endsInParen[i]=false; continue;`) |
| בדיקות קיימות | `tests/regress/source-families.test.js` (Red; משפחות מקור עם oracle) — לא קיים ב־Work_2 |
| תלותים | אפס (שינוי מקומי; הרוחב המדויק dispW נשמר) |
| הבדלים מול המימוש הנוכחי | הקשר הקוד ב־Work_2 זהה סביב האתר (אותה מחלקה/מתודה); הפאטץ' נחתם מעל אותן שורות |
| סיכון ייבוא | נמוך-בינוני: דורש התאמת מספרי שורות + העברת הבדיקה; השפעה על מדידה בטוחה (דגלים בלבד, רוחב לא משתנה) אך עלולה להזיז סקייל-סוגריים בפסקאות מושפעות — חייב נעילת hash והסבר פער |
| התאמה לעיקרון המנוע האחיד | מחזק: מקרב דגלים למדידה אחידה; אינו מוסיף מסלול |
| **הכרעה** | **reuse** — ייבוא ב־PR נפרד עם הבדיקה, לפי תבנית ה־PR של התוכנית (פער מוכח+שורש+נייטרליות hash). **אין לערבב עם עבודת האודיט** (הוראת §8) |

### R-RC2 · מודולי הקשחת UI של סוכן 1 (Red main, ממוזג) — **החלטה: reuse (שלושתם, PR נפרד)**

| מודול | commit מקור | תפקיד | הוכחות | סיכון | הכרעה |
|---|---|---|---|---|---|
| `ui/boot-failure.js` | Red main `de92fa0` (דרך PR-י סוכן 1; קיים בעץ main) | הודעות כשל אתחול לפי שלב — מבטל נפילה שקטה ל־DP כשנכסי imud נכשלים (פער מתועד ב־Work_2: §3 ב־ENGINE_CURRENT_STATE) | מלווה ב־`tests/e2e/a1-boot-failure.test.js` | נמוך: מודול טהור בלי DOM/מנוע (F-06) | **reuse** |
| `ui/run-info.js` | שם | זהות ריצה אחרונה לתצוגה — מקור יחיד לפס המצב/לשונית הבדיקה | `tests/e2e/a1-run-summary.test.js` | נמוך: טהור, צורך חוזה קיים (ui-result-v1) | **reuse** |
| `ui/text-decode.js` | שם | פענוח קובץ טקסט בלי השחתה שקטה (UTF-8 קפדני → נפילה ל־Windows-1255 מדווחת; BOM) | `tests/e2e/a1-input-integrity.test.js` | נמוך: טהור; סוגר כשל שקט של קלט עברית | **reuse** |

שלושתם טהורים, ללא אחריות עימוד, ללא מסלול מקביל — עומדים בתנאי הייבוא. דורשים חיבור ב־`browser-entry/app-shell` במקביל לעץ ה־UI המתפצל של Work_2 (בדיקת התנגשויות merge).

### R-RC3 · טריגר הרחבות source-families (בדיקות) — **החלטה: reuse עם R-RC1**

`tests/regress/source-oracle.js` + `source-families.test.js` (Red): מסגרת בדיקת משפחות מקור עם oracle — מגדילה את רגישות הרגרסיה לתיקוני שורש במורשת. ייבוא יחד עם R-RC1 (הבדיקה תלויה בו).

### R-RC4 · שליפה מקדימה של גופני עלייה (font prefetch) — **החלטה: skip (לעתה)**

Red PR #38 (פתוח, לא ממוזג גם ב־Red). שיפור UX בטעינה ראשונה. לא הוכח ממוזג/ירוק במאגר המקור; אינו חוסם את האיחוד. לבחינה מחדש לאחר סגירת שלבים 1-2.

### R-RC5 · תיקון heading-rollback (Red PR #43 / Red_Work `ee3a7bc5`) — **החלטה: skip (כבר מכוסה)**

Work_2 מכיל כבר תיקון שורד עצמאי ומפורט יותר לאותו כשל — **S75** ("אובדן כותרת-זנב במעבר טור", 12.11; `legacy-imud-flow.js:2095-2113` עם continue + ניתוח שורש מלא). אין לייבא את הגרסה הקטנה של Red מעל גרסת Work_2 העשירה. (בדיקת הרגרסיה `heading-rollback.test.js` עשויה להתווסף כהרחבת כיסוי — תיעוד בלבד.)

### R-RC6 · עבודת סוכנים ממוזגת ב־Red (PR #44 source-families, #37) — **החלטה: skip (פרט לבדיקות שסופחו לעיל)**

R-01 סווג ל־FIXED במשפחות המקור; השינויים בקוד המנוע של Red חופפים לאזורים שהתפתחו ב־Work_2 בנפרד (S75-S77) — ייבוא הגוש ייצור התנגשויות ואחריות כפולה. הכיסוי הרלוונטי כבר קיים ב־Work_2 או יגיע דרך R-RC1.

### R-RC7 · מימוש TypeScript המאוחד (React) — **החלטה: skip לייבוא קוד; reuse כייעוס-חוזה בלבד**

| שדה | ערך |
|---|---|
| מאגר/commit | `Tora_Book_Typesetter_React` main @ `a2fa18e` (09.11; "שלבים 94-100/100 — התוכנית כולה הושלמה") |
| מבנה | 12 חבילות TS: `content-model` (blocks/inline/notes/spans/atoms — AST קנוני!), `measurement-api` (+harfbuzz, uax14, bidi, cache-key), `layout-engine` (linebreak: dp/greedy/candidates/policy; pagination: notes/endnotes/toc/templates/fixed-point), `layout-api` (ir, projection, canonical-hash, decision-ledger), `policy-torah`, `render-html`, `export-pdf`, `settings-schema` (migrations), `audit-core`, `cli`, `test-fixtures` |
| עדכניות | אחרון 09.11 — **לפני** התוכנית הקנונית של Work_2 (15.11) |
| עדות עבודה | README + playwright; טענת השלמה 100/100 שלבים; אין עדות לפריסה חיה/שימוש משתמש במסמכי Work_2 |
| סיכון ייבוא | **גבוה**: מקביל לתוכנית הקנונית אך בסטאק אחר (TS+Vite+React); ייבוא חבילות יצור שכבת תאימות קבועה/מנוע שני — בניגוד ישיר לעקרון המנוע האחד ולדוקטרינת אפס-תלות של Work_2 |
| התאמה | **כייעוס בלבד**: החוזים של content-model/measurement-api/decision-ledger/canonical-hash הם נקודות התחלה מוכחות-תכנון לשלבים 2-3-5 ב־Work_2 (עם התאמה לאוצר מילים ולאילוצי JS טהור) |
| **הכרעה** | **skip** (קוד); הפניה מפורשת מ־`spec/03_UNIFIED_ITEM_CONTRACT.md` לא נדרשה — מתועד כאן כייעוס |

### R-RC8 · קורפוס היסטורי Orange — **החלטה: reuse — כבר בוצע (סגור)**

`orange_very_long_test_text.txt` כבר מיובא ל־`tests/fixtures/real/` ונצרך ב־`long-real-text.test.js:106` + `tools/perf-baseline.js:152` (D-98: קורפוס מקביל זהה-מקור). אין פעולה נוספת.

### R-RC9 · Yellow (V22) — **החלטה: skip (פרובננס בלבד)**

תוכנת המקור; ערכה ההנדסי מומר כבר להיסקים מתועדים (S4.13 balanceColumns "port נאמן", D-92 רווח-ביטחון). אין קוד ריצה לייבוא — יבוא היה יוצר מנוע שני.

### R-RC10 · Green (V23) — **החלטה: skip (פרובננס בלבד)**

היסקים שהומרו: chapter-end modes, terminal-residual (PROVENANCE). `renderer-bridge.js`/`geometry-audit.js` שייכים לארכיטקטורת המקור ואינם מתאימים למודל Work_2.

### R-RC11 · PRs פתוחים במאגרים האחרים — **החלטה: תיעוד; לא ממזגים בלי בדיקת תוכן (כלל §8)**

- Red: #33 (docs reference-intent), #38 (R-RC4), #47 (המלצות סוכן 5 למעבר לתוכנית v2.0 — נוגד/חופף לתוכנית הקנונית של Work_2; לא ממזגים), #48/#49 (R-RC1).
- Red_Work: #1-#6 (סשנים היסטוריים; תוכנם הקודי כוסה ע"י S75 ב־Work_2 או עקוף ע"י ההתפתחות).
- Work_2 עצמו: #14 (docs הכרעות משתמש), #15 (מודל inline משותף), #16 (SSOT fn-anchor), #17 (FX-1..FX-6 draft) — **לא נמזגו במסגרת שלב 1**; תוכנם נבדק לצורכי אודיט בלבד (מיפוי #16: "very_long 1335→1090" רלוונטי לשלב 5).

## 4. סיכום הכרעות

| רכיב | הכרעה | תזמון |
|---|---|---|
| R-RC1 תיקון R-03 + בדיקה | **reuse** | PR נפרד לאחר אישור (מועמד ראשון לפני/בתחילת שלב 2) |
| R-RC2 boot-failure/run-info/text-decode + בדיקות | **reuse** | PR נפרד (UI; אינו נוגע למנוע) |
| R-RC3 מסגרת source-families | **reuse** | יחד עם R-RC1 |
| R-RC4 font-prefetch | skip (לעתה) | לבחינה מחדש אחרי שלב 2 |
| R-RC5 heading-rollback | skip (S75 מכסה) | — |
| R-RC6 גושי סוכנים Red | skip | — |
| R-RC7 React TS | skip קוד; ייעוס חוזה לשלבים 2-3-5 | — |
| R-RC8 קורפוס Orange | סגור (בוצע) | — |
| R-RC9/R-RC10 Yellow/Green | skip (פרובננס) | — |
| R-RC11 PRs פתוחים | תיעוד בלבד | בדיקת תוכן לפני כל מיזוג עתידי |

**אפס קוד הועתק בשלב זה** — ההכרעות מקושרות למקור מדויק (מאגר/ענף/commit/PR), עם הוכחות ונימוק, לפי דרישת התוכנית.
