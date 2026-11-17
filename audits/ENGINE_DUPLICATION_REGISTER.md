# ENGINE_DUPLICATION_REGISTER — רישום כפילויות, אחריות כפולה ומסלולים מקבילים (שלב 1)

> **Commit:** `95e829d44e88f436c9397d82473cd9e2f4a698aa`. כל ההפניות ל־`red-build/src/` אלא אם צוין.
> חומרה: **גבוהה** = מייצר/הזיז פלט בפועל · **בינונית** = סיכון סחף/תחזוקה מוכח · **נמוכה** = נקיון.
> כל ממצא: ראיות → סיכון → המלצה. **אין למחוק קוד לפני הוכחת חלופה (כלל התוכנית §9 שלב 9).**

---

## 1. רגיסטר חישובים כפולים (עובדה אחת — יותר ממקום אחד)

### D1 · טבלאות גורם-רוחב גופן — ×4, ערכים סותרים [חומרה: גבוהה]
- `typography/measure-table.js:24` (`FONT_PROFILES` — David 1.00) — מקור A (מדידת קירוב).
- `core/pipeline.js:196` (`FONT_WIDTH_PROFILES` — David **1.04**).
- `layout/footnote-budget.js:15` (`NOTE_FONT_FACTORS`).
- `layout/side-notes.js:14` (`SIDE_NOTE_FONT_FACTORS` — David 1.04 / Narkisim 1.10).
**סיכון:** אותה מילה נמדדת במכפיל שונה לפי השאלה שנשאלה (שורה/תקציב/הערת-צד) — מקור מוכח לסחף אומדן מול דיו.
**המלצה:** שלב 3 — מקור יחיד לפרופיל משפחה; האחרים צורכים אותו.

### D2 · רוחבי מילה — נמדדים פעמיים לכל שורה [גבוהה]
- בשבירה: `pipeline.js:515` (`measureWithParen`) → `kp-linebreak.js:23` (`buildItems`); מורשת: `legacy-imud-flow.js:536` (`breakPara`).
- בפרויקציה: `geometry-projector.js:704` (`projectLine`); `legacy-projector.js:84-93` (`placeWords`).
- לוגיקת הגודל-האפקטיבי (סוגריים/סגנון מותאם) קיימת ב־**3 מימושים**: `pipeline.js:515-527`, `geometry-projector.js:655-701`, `legacy-projector.js:86-92` — מחלקת הבאגים המוכחת של S68.
- **מנוע רוחב שלישי = הדפדפן** (אין read-back, אך ה־CSS authoritative לתצוגה; FIT_EPS=0.75 מגן — D-92).
**המלצה:** שלב 7 — פרויקציה אחת לפריט; המקרינים צורכים מדדים קפואים.

### D3 · נוסחת יישור `(colW−Σw)/gaps` — ×4 [גבוהה]
`geometry-projector.js:713`, `:368` (`wrapNoteTokens`), `legacy-projector.js:106`, CSS `text-align-last:justify` (`dom-renderer.js:936`, `html-export.js:56`).
**המלצה:** שלב 4 — חלוקת רווחים במנוע שורות אחד; ה־CSS הופך לאפקט חזותי בלבד.

### D4 · בסיס שורה (half-leading+ascent) — ×4 + נוסחאות גיבוי רדומות [בינונית]
`geometry-projector.js:752` (`attachBaselines`), `:361`, `legacy-projector.js:31` (`baselineOf`), CSS/דפדפן (`dom-renderer.js:137`, מורשת `mkLine:727`). גיבויים רדומים: `pdf-writer.js:407` (×0.78), `:424/:440/:448` (y+9/+10). מדדי A/D עצמם חד-מקוריים (`measure-api.js:177-188`) — ההרכבה לפי-מקרין.
**המלצה:** שלב 7 — baseline במודל העמוד; מחיקת נוסחאות הגיבוי.

### D5 · גובה שורה נגזר מחדש [בינונית]
`dp-planner.js:107` (`Math.round(...)`) מול `measure-api.js:191` (`lineHeightPx`, ללא עיגול). מקדמי סקייל הערות (0.8×/1.25/0.75/1.15) מוקשחים ב־2-3 קבצים כ"א (`dp-planner.js:257-258`, `footnote-budget.js:18-19`, `geometry-projector.js:334,442,536,543`, `side-notes.js:17-18`).
**המלצה:** שלב 3 — lineHeightPx קנוני; סקיילים כהגדרות מדידה לפי סוג פריט.

### D6 · גובה טור מצטבר `Σ(heightPx×aqStretch)` — ×6 [בינונית]
`dp-planner.js:133`, `balancing.js:13,141`, `geometry-projector.js:573`, `dom-renderer.js:419`, `side-notes.js:42-50`, `dp-planner.js:603`.
**המלצה:** שלב 5 — usedHeight נכס של המתכנן; השאר קוראים.

### D7 · עטיפת טקסט הערה — ×3 (DP) + מראה מורשת [גבוהה]
תקציב: `footnote-budget.js:17` (`noteHeight`); מדיניות פיצול: `dp-planner.js:257-266`; רינדור: `geometry-projector.js:344` (`wrapNoteTokens`). מורשת: `legacy-imud-flow.js:2696-2727` מול `legacy-projector.js:463-549`. שורש אפשרי לפערי אומדן-מול-דיו (ולחקירת F-BL1).
**המלצה:** שלב 6 — מודול עטיפת הערות אחד; אומדן=רינדור.

### D8 · גיאומטריית כותרת-עליונה/גיליון — חלקית מאוחדת (D-81) [בינונית]
מקרין מחשב x/w לכל סלוט (`geometry-projector.js:281`; `legacy-projector.js:661`) — נצרך ע"י PDF+ink בלבד; ה־DOM משתמש ב־flex/`widthPct` (`dom-renderer.js:347,765-807`). גיבויים: `pdf-writer.js:438,446`; `geometry-projector.js:849,857`. עוגן גיליון 25px מוכפל CSS↔JS (`html-export.js:75` מול `geometry-projector.js:241`).
**המלצה:** שלב 7 — page furniture במודל העמוד.

### D9 · משפחת אפסילון-התאמה [בינונית]
0.75 מוקשח ×3: `kp-linebreak.js:125,138,217`; ברירת מחדל 0.75: `protectors.js:84`; `FIT_EPS=0.75`: `legacy-imud-flow.js:406`; אך **0.5** ב־`dp-planner.js:157,190` — חוסר אחידות מכוון-לכאורה שאינו מתועד כהחלטה.
**המלצה:** קבוע יחיד בשלב 4 עם תיעוד סטיות מכוונות.

### D10 · קבועי מורשת מועתקים DOM↔PDF [בינונית]
`GATE_BOX` (`dom-renderer.js:837` ≡ `legacy-projector.js:254`); `BAND_W=2×COL_W+13.48` מול `SINGLE_W=552.3`; מדדי DavidLibre-Bold מוקשחים (`dom-renderer.js:767`).
**המלצה:** שלב 6-7 — קבועי גאומטריה למקור יחיד.

### D11 · אומדן-ואז-עטיפה-מחדש [בינונית]
גבהי הערות-צד/סיום/שערים מוערכים במודל (`side-notes.js:16`, `endnote-pages.js`, `geometry-projector.js:141`) ונעטפים מחדש ברינדור (wrapNoteTokens / flex). אין אכיפה שאומדן ≥ דיו.
**המלצה:** שלב 6 — עטיפה קנונית בשלב המדידה.

### D12 · המרת יחידות `×96/72` מוטמעת ~20 אתרים [נמוכה]
למרות `line-font.js:40` (`ptToPx`) כמקור מוצהר.
**המלצה:** ניקוי בשלב 3.

### D13 · שלוש הפעלות MeasureAPI שצריכות להסכים [גבוהה]
חי: `pipeline.js:186` · ייצוא: `export-api.js:117-122` (typeset שני בחוט העימוד, מאלץ font-metrics) · פרויקציה: `export-api.js:137`. היסטוריית סחף EXT-13/S71.1: 2-17%. נוסף: פער סביבות Node↔דפדפן (695↔699 עמ' — F-BL3).
**המלצה:** שלב 3+7 — MeasureAPI אחת; ייצוא מקרין תוצאה קיימת ואינו מעמד מחדש.

### D14 · תקדימים מאוחדים (לשימור בעת האיחוד) [חיובי]
קיבולת טור — `column-flow.js:54` (`colCapacityOf`, S5.2 P-2). תקציב הערות probe==reservation — `footnote-budget.js` (P1-1). `aqStretch` — שדה יחיד עם 8 צרכנים. עוגן כותרות-עליונות — `headers-builder` (D-61).

### D15 · דגלי סוגריים+סמן מודבק — באג R-03 [גבוהה]
`legacy-imud-flow.js:574-577`: מילה עם סמן מודבק מאפסת דגלי סוגריים ומדליפה את מונה העומק לשאר הפסקה. תיקון שורש מפותח+נבדק במאגר Red (PR #48) — ראה אודיט מאגרים.

## 2. מודלים מתחרים (אחריות כפולה מבנית)

| אחריות | מימוש A (DP) | מימוש B (מורשת) | השלכה |
|---|---|---|---|
| טוקניזציה | `parser/dfa-lexer`+`block-tokenizer` | `legacy-imud-flow.tokenizeDoc:303` | שני דקדוקים לאותו פורמט קלט |
| שבירת שורות | `kp-linebreak` (KP) | `LineBreaker:407` (גרידי+חלון) | שתי תורות שורות שונות |
| מודל שורה | `{words,widthPx,heightPx,isLast}` `kp-linebreak.js:181` | `{words,markerIdx,paren*,y,...}` `:3007-3023` | שדות לא ממופים 1:1 |
| תכנון עמוד | `dp-planner` | `flowSection:1319` | מדיניות חיתוך שונה |
| מודל עמוד | `newPage`+spanning | `blankPageObj`+bands+gateLines | שני פורמטי pages[] |
| הערות | מבני (`page.footnotes`) | `fnQueue` מפתח-מחרוזת | מחלקת אובדן מתועדת |
| המרת סמנים | `notes/markers.js` | `LineBreaker.markerWord` | שני ממירים |
| TOC | `toc-builder` | מובנה במורשת | שלושה בוני TOC (כולל מקרן הערות) |
| מקרינים | `geometry-projector` | `legacy-projector` | שתי הקרנות CP5 |
| hash קלט | DP `layoutHash:1183` | מורשת hash משלה | נעילות כפולות ב־cross-check |
| חשבונאות תוכן | מולטיסט מדויק `:894-1114` | ≥-coverage `:3494-3589` | רגישות שונה לאובדן |

**תיקוני תאימות הגנתיים:** `dp-planner.js:49-51`; `legacy-imud-flow.js:1140-1154` — מתאמים שנועדו לגשר, להסירם רק בשלב 9.

## 3. תנאי חריג, fallback וקוד מתאם שהצטברו

- בחירת נתיב ע"י נוכחות נכסים (`pipeline.js:123`) — לא הגדרה (הערת ארכיטקטורה מרכזית).
- נפילה שקטה ל־DP כשנכסי imud נכשלים (בלי הודעה — ב־Red יש `boot-failure.js`).
- שדרוג שקט של מדידה table→font-metrics (`measure-api.js:237-242`).
- `renumberPageScopedMarkers` — דילוג-מלא שקט בהתנגשות (`markers.js:126-131`).
- נוסחאות גיבוי רדומות ב־pdf-writer (`:407-448`).
- `importProjectZip` — Buffer-gated, חיבור UI לא אומת.
- הזרקת `env.*FontBytes` — ערוץ גופנים חלופי.

## 4. קוד שאינו בשימוש (מוכח; מחיקה רק בשלב 9 ב־PR נפרד)

`balancing.balancePage` · `geometry-projector.attachBasases` · `decoration/assets-import.js` (כולו) · `shaar-pages.buildPickerModel` · `theme-sets` פונקציות קבוצה · `block.firstWord` ב־DP (`dropword.js:69`) · `blk.dh` (`pipeline.js:387`) · `media:null` blob-attachment · `images[]` בהרחבות (מאומת, לא מחובר) · עץ `archive/debug/dbg*.js`.

## 5. מסלולים שנראים פעילים אך אינם מחוברים למסלול המוצר

מקריני הגאומטריה בתצוגה החיה (PDF בלבד) · שרשרת DP תחת פרופיל imud (ברירת המחדל) · מספור-מחדש page-scoped (דלוק-כבוי) · `endnote-pages`/`toc-detail`/`autoQualityPass` (מחוברים, דלוקים כברירת מחדל — לגיטימי).

## 6. ממצאי פתוחים מה־baseline הקשורים לכפילויות

- **F-BL1 (full-math — רצפת נפח 353,687<355,967):** מונה האודיט סופר טקסט מרונדר בדפדפן (כולל נגזרים) מול 0.98×מילות המקור. C1 (מולטיסט גוף+מרזב) עובר ב־Node על אותו קלט — כלומר אין הוכחה לאובדן גוף במודל; הכיוונים: (א) פער נתיב Node↔דפדפן (F-BL3, 695↔699 עמ'); (ב) הבדלי מנייה בין האודיט לחשבונאות המנוע (D7/D11 — אומדן מול דיו). מחייב אינסטרומנטציה לפני שלב 9.
- **F-BL2 (SIDE_NOTE_OVERLAP עמ' 107):** H1 — מורשת `emitUnit` `:3028-3042` ללא טיפול התנגשות; H2 — DP `estimateSideNoteHeight` (`side-notes.js:16-36`) מתעלם מ־counterMark ומתעלף ממדדי impl-B (D1). פירוט ב־`ENGINE_RUNTIME_PATHS.md` §8.

## 7. סיכום מדדים (לדוח הפישוט בשלב 9)

| מדד (נכון ל־`95e829d`) | ערך |
|---|---|
| נתיבי runtime ליבה | 2 (מורשת=ברירת מחדל חיה; DP) |
| מנועי שבירת שורות | 2 |
| מקריני CP5 | 2 |
| מקורות רוחב מילה | 4 (measure-table / pipeline / projector / legacy-projector) + דפדפן |
| טבלאות גורם גופן | 4 (סותרות ערכים) |
| מימושי נוסחת יישור | 4 |
| אומדני גובה הערה | 4 |
| הפעלות MeasureAPI לספר אחד (חי+ייצוא) | 2 עימודים + 1 פרויקציה |
| תתי-מודל pages[] פעילים | 2 |
| מתאמים/גשרים מתועדים | RED_SETTING_BRIDGE_S77, legacy-settings-map, page.legacy, legacyProfile |


---

## עדכוני שלב 8 (17.11 — פרוסה 1 + פרוסה 1-ביקורת)

### D-s8a · materialization כפול (pipeline + מקרינים) — **נסגר בפרוסה 1 (PR #31)**
`core/materialize.js` הוא המנגנון היחיד למיקומים סופיים (מופעל פעם אחת ב-buildPageModel); `output/geometry-projector.js` נשאר facade מתועד לנתיב ה-PDF הוותיק ולבדיקות — **יוסר בשלב 9** לאחר הוכחת parity (פרוסה 5 מעבירה את ה-PDF לצריכת המודל).

### D-s8b-1 · scrubPUAText — **נסגר בפרוסה 1-ביקורת**
היה: מוגדר ב-dom-renderer, נצרך ע"י core/materialize (תלות הפוכה core→renderer) + עותק inline ב-structural-stamps. כעת: מקור יחיד `core/pua-text.js` (קבועי PUA + scrub); dom-renderer ו-materialize ו-structural-stamps צורכים ממנו.

### D-s8b-2 · familyFontKeyOf — **נסגר בפרוסה 1-ביקורת**
היה: שני עותקים זהים (core/materialize.js + layout/structural-stamps.js). כעת: מקור יחיד `typography/font-keys.js`. עותק שלישי (fontKeyOf ב-legacy-projector) — נתיב מורשת, ייסגר בשלב 9.

### D-s8b-3 · fallback המודד במקרין — **תוחם בפרוסה 1-ביקורת**
כל נתיבי ה-fallback המודדים של materialization הוגבלו למצב 'compat' מתועד בלבד (קלט סינתטי/נתיב PDF ותיק). במצב 'production' (ה-pipeline): כל חוסר נתון ⇒ diagnostic + violation בלי מדידה. הוכחת אפס-מדידות: probe prototype (s8b).
