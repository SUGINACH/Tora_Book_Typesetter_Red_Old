# נספח ביקורת — כלי חתימה, Stage 8/9, תמונות ובדיקות גאומטריה
**תאריך:** 19.11.2026  
**בסיס קוד:** `main@178bcc8` (אותו base של PR #66)  
**קשור לדוח:** `audits/STAGE1_MAP_REVIEW_2026-11-19.md`  
**מטרה:** להוסיף ממצאים שנחשפו בהמשך הבדיקה, ולדייק את פרומט ה-reconciliation.

## 1. ממצא קריטי: מבנה החתימה של run-ours אינו PageModel

ב-`tools/layout-parity/run-ours.js`:

- `--unified` אכן קובע `RED_UNIFIED_IMUD=1` לפני קריאת `typeset`.
- לאחר מכן הסקריפט עובר על `result.pages` ובונה בעצמו אובייקט חדש בשם `model`, עם `pages` ו-`document.paragraphSeq`.
- הוא **אינו מעתיק את `result.pageModel`** לתוך `ours-model.json`.
- ה-`paragraphs` של כל עמוד נוצרים מחדש ב-adapter לפי `ln._ln.paraId`; אם השדות אינם קיימים בצורה שה-adapter מצפה לה, הרשימה תהיה ריקה גם כאשר קיימים בלוקים מסוג paragraph ב-DocumentModel.
- `model.meta.engine` כתוב כמחרוזת קבועה `red-build legacy-imud-flow (live path: IMUD defaults + Guttman Rashi + font-metrics)`, גם כשהפקודה רצה עם `--unified`. זו תווית מטעה לנתיב המאוחד.

מכאן:
1. `paragraphs=0` ב-`ours-model.json` הוא כרגע נתון של **adapter החתימה**, לא הוכחה ש-DocumentModel או PageModel חסרים פסקאות.
2. `fontKey=0/4002` או היעדר `y/sizePt` במבנה שורות שהסקריפט מייצר אינם ראיה מספקת לחסר ב-PageModel.
3. עדיין ייתכן שחסר downstream lineage של paragraph/block identity ב-LineModel או ב-PageModel. זה מחייב בדיקה נפרדת של `blockId`, `sourceTokenId`, `part`, `seq`, `sourceRange` והקשר לפסקאות ב-DocumentModel.

**ראיה נגדית חשובה:** `tools/stage9/shadow-compare.js` בונה `unifiedInventory` מתוך `r.pageModel.pages` במפורש. שער G8 (`G8-pagemodel-parity`) בודק שמילות PageModel מכסות את מלוא תוכן המקור. דוח v5 מ-18.11 מציג G8 ירוק. זו ראיה חזקה לכיסוי תוכן ב-PageModel באותה ריצה; היא אינה מוכיחה כשלעצמה שמירת paragraph identity או parity גאומטרי.

**תיקון נדרש במיפוי:** בכל מקום שבו נעשה שימוש ב-`run-ours.js`, לציין אם המספר נמדד ב-`result.pages`, ב-`ours-model.json` שנבנה ב-adapter, ב-`DocumentModel`, ב-`LineModel` או ב-`result.pageModel`. אין לקרוא לכולם "המודל".

## 2. בדיקת s9d — החיבור נכון, אך בדיקת המורשת אינה מוכיחה את שמה

אומת בלוג CI שהבדיקה רצה: `s9d-segment1-geometry: 11/11 passed`. חיבור הבדיקה ל-`npm test` הוא תיקון אמיתי.

אבל ב-`red-build/tests/e2e/s9d-segment1-geometry.test.js` קיימת בדיקה שכותרתה:
`digest הקורפוס הקטן זהה לנעילת 9C.3 (legacy-3ce387962aa20101…)`.

בגוף הבדיקה:
- היא קוראת `typeset(text, getDefaultSettings(), ...)`.
- בדיקה אחרת באותו קובץ מוכיחה במפורש ש-`getDefaultSettings()` אינו פרופיל IMUD (`isImudProfile(plain) === false`).
- `pipeline.typeset` מפעיל legacy רק כאשר `_layout-profile==='imud'` וגם `_imudRaw` קיימים, ובהיעדר force-unified.
- הבדיקה אינה מאמתת `res.legacyProfile === true`.
- היא אינה משווה את `res.layoutHash` לערך נעול. היא בודקת רק שהערך הוא מחרוזת ושיש עמודים.

לכן הבדיקה הזו **אינה בדיקת digest של legacy ואינה נועלת את ה-hash של 9C.3**. היא מריצה את נתיב DP הגנרי ובודקת תנאי smoke חלשים. נדרש:
1. אם המטרה היא להוכיח legacy non-regression — להשתמש בהגדרות IMUD מיובאות, לוודא `legacyProfile===true`, ולהשוות לערך digest ידוע שמקורו בנעילת 9C.3.
2. אם אין מקור hash מאושר ונגיש — לשנות את שם הבדיקה ואת טענת הדוח, ולהוסיף בדיקת legacy ייעודית ללא המצאת golden.
3. להוסיף בדיקת שלילה שמוכיחה כי סטייה ב-hash גורמת לכישלון.

עוד פערי כיסוי ב-s9d:
- בדיקת binding-offset מאמתת רק את `columns[0].x` (הטור הימני) ב-recto/verso; הטור השמאלי אינו נבדק.
- `page-templates.js` מכניס `GEO.HEADER_BASELINE` למאפיין שנקרא `headerHeight`, וההערה בקוד מגדירה אותו כ"גאומטריית הפס". בדיקת s9d מתארת אותו כ-baseline. נדרשת הבהרת חוזה: האם הערך הוא baseline, גובה פס, או נקודת ייחוס אחרת; שם המאפיין והבדיקה צריכים להתאים לסמנטיקה.
- יש להוסיף בדיקות binding גם לתיבות/שוליים ולזוגיות אחרי הוספת שערים ו-TOC, אם אלה מכוסים במקטע.

## 3. Stage 8 — הושלם ברמת המקרינים והייצוא; לא להסיק מכך שה-cutover הושלם

`audits/STAGE8_RENDER_PROJECTIONS.md` ו-`audits/STAGE8_SLICE6_INVENTORY.md` מתעדים שש פרוסות:
1. materialization חד-פעמי;
2. השלמת PageModel, תמונות והעברת Worker;
3. DOM מה-PageModel;
4. HTML מה-PageModel;
5. PDF מה-PageModel;
6. מלאי, parity, פישוט וביצועים.

ממצאים מאומתים במסמכים:
- ה-DOM המאוחד קורא מ-PageModel; בדיקת שלילה מונעת מדידה במקרין.
- HTML/PDF המאוחדים מופקים מאותו PageModel; בדיקות הוכיחו אפס קריאות typeset נוספות בייצוא המאוחד.
- ה-PDF מהמודל חסך במדידת very_long כ-94.9% מזמן הייצוא הישן (43.2s→2.19s); 359,584 מילים במודל וב-HTML.
- החריגים הישנים (renderLegacyPage, exportHtml/exportPdf של legacy, renderFolio המודד ב-DOM הישן) נותרו כפופים לשלב 9.

יש לעדכן את PP-04/05/06 ואת PF-05 במפה לפי תוצרים אלה. עם זאת, Stage 8 אינו מוכיח שהוסר מנוע המורשת או שכל נתיב מוצר כבר משתמש במאוחד.

## 4. Stage 9 — 13/13 ב-shadow v5 הוא שערי כיסוי סמנטי, לא parity גאומטרי מלא

דוח `audits/STAGE9_SHADOW_very_long_2026-11-18_v5.md` מציג 13/13 שערים:
- כיסוי מילות המקור בשני המנועים;
- היעדר תוכן רפאים;
- זהות ותוכן הערות גוף;
- TOC כללי ומפורט לפי D-107;
- זהות/מיקום ביאורי צד;
- כיסוי תוכן PageModel;
- התאמת דקדוק כותרות.

אבל באותו דוח המספרים הם **695 עמודים במורשת מול 896 במאוחד**. רשימת 13 השערים אינה מכילה שער השוואת גאומטריית עמוד/טור, page-count parity או DOM/HTML/PDF מול legacy. לכן יש לתאר את התוצאה כ-`semantic/content shadow gates 13/13`, לא כ-"שקילות מלאה של המנוע" או visual parity.

בנוסף:
- דוח v5 נושא תאריך 18.11 וכותרת 9b.1.
- `ISSUE_REGISTRY.md` מתעד תיקונים מאוחרים 9b.2–9b.5, כולל D-107, דקדוק H7, notes glue ושער אחורי.
- `STAGE9_CUTOVER_MAP.md` עדיין מתאר שרק H3 ו-Full-Math הושלמו, ושיתר 9b טרם נקבע — זהו פער תיעודי מול ISSUE_REGISTRY.

**הוראה:** לבנות crosswalk של כל ממצא F-9a/F-9b מול הקומיט/הבדיקה/הדוח שבו נסגר; להריץ או לאתר ריצת shadow עדכנית לאחר 9b.5; לעדכן את STAGE9_CUTOVER_MAP; ולשמור בנפרד את שערי content, geometry, DOM, HTML, PDF, default-profile ושערי cutover 9c. אין להתחיל הסרת legacy על סמך 13/13 אלה בלבד.

## 5. תמונות — לפצל את AS-04 לשלוש יכולות שונות

הניסוח הנוכחי `AS-04 תמונות: אין תמונה inline; תמונות DOCX אובדות בשתיקה` מערבב יכולות שונות וסותר חלק מהעבודה שכבר קיימת.

### א. תחביר/מודל תמונה inline
- `STAGE2_MODEL_COVERAGE.md` מתעד פריט `image` עם assetId, align, widthPct ו-sourceText, ומחבר אותו לפרסר.
- בשלב 2 הוא עדיין הועבר ל-DP כטקסט מילולי — לא היה אז עימוד תמונה מלא.
- Stage 3 מוסיף AssetResolver, מדידת מידות תמונה והעברת bytes ל-Worker.
- Stage 8 פרוסה 2 מתעד תמונות inline/block/float ב-LineModel וב-PageModel (`page.images`) עם geometry ו-resolved; פרוסה 3 מציגה אותן דרך מקרין PageModel.

לכן "אין תמונה inline" אינו נכון כמצב נוכחי של המודל/מנוע. יש לתעד בנפרד אם קיים משטח UI למשתמש להעלות/לצרף נכסי מסמך; Stage 3 אומר שמשטח UI כזה עדיין לא נבנה.

### ב. ייבוא תמונות מתוך DOCX
`red-build/src/engine/import/docx-import.js` סורק את רצף ה-XML של `w:p`, אוסף טקסט מ-`w:t` והפניות `w:footnoteReference`. אין בו טיפול ב-`w:drawing`, `w:pict`, `word/media` או relationship mapping. לכן תמונות DOCX אינן מומרות לתוכן המנוע, ולא נרשם diagnostic ייעודי לתמונה שנדחתה. זו יכולת נפרדת וחסרה, שיש להוכיח באמצעות fixture DOCX עם תמונה ובדיקת אזהרה/ספירה מפורשת.

### ג. ייבוא נכסי עיצוב לעומת נכסי מסמך
`decoration/assets-import.js` ו-`decoration/asset-registry.js` עוסקים בנכסי עיצוב/שערים. `assets/asset-resolver.js` הוא ה-AssetResolver הקנוני לנכסי מסמך. אין למזג אותם לשורת "asset-registry + hash256" אחת או לטעון שמסלול importAssetFolder הוא העלאת תמונות inline במוצר.

**פעולה:** לפצל את AS-04 (ולבדוק גם AS-05) ל:
- תמונה inline במקור/DocumentModel;
- טעינה/פתרון/מדידה/העברה/הקרנה של נכס מסמך;
- משטח UI לצירוף נכסי מסמך;
- תמונות DOCX (חילוץ, relationships, media, warnings);
- נכסי ספרייה/שערים/עיטורים.

## 6. ביצועים — מספרים ישנים אינם baseline נוכחי

PF-01/02/04 במפה מבוססים על `RUN-19.11` וחתימות מוקדמות של 66 עמודים, 1,226ms וממצאי audit. יש לשמור אותם כמדידה היסטורית ולא כמצב נוכחי. Stage 8 perf-slice6 מודד בעיקר עלות DOM/HTML/PDF לאחר בניית מודל; הוא אינו תחליף למדידת זמן typeset מלא לעומת legacy.

נדרשת מדידה נפרדת ומבוקרת:
- typeset legacy מול unified;
- אותם קורפוסים, settings, fonts, assets וגרסאות Node;
- warm/cold cache ומדידת זיכרון;
- זמן CPU וזמן wall-clock;
- מספר עמודים והבדלי מבנה לצד זמן;
- מדידות Browser/Worker נפרדות מ-Node.

אין להשתמש ב-P6/P7 או במדדי התאמה ל-PDF ההיסטורי כשערי קבלה — הם מחוץ להיקף לפי הוראת המשתמש ו-D-97.

## 7. השלכות על המשך העבודה

1. לתקן את מפת היכולות ואת ה-crosswalk לפני שינויי מנוע.
2. לתקן את כלי חתימת `run-ours` כך שיסמן במטא את הנתיב האמיתי, ויפיק בנוסף חתימה ישירה מתוך PageModel, בלי לערבב אותה עם הסכמה ההיסטורית.
3. לנתב בדיקות paragraph identity לפי מודלי המקור/השורות, לא לפי `paraId` שנוצר ב-adapter בלבד.
4. לתקן את בדיקת s9d כך ששם/נתיב/השוואת hash יתאימו למה שהיא באמת מפעילה.
5. לעדכן Stage9 Cutover Map ולציין אילו שערים סמנטיים עברו ואילו שערי גאומטריה/ייצוא/cutover עדיין חסרים.
6. לפצל תמונות inline, העלאת נכסים, ייבוא DOCX ונכסי עיצוב ליכולות עצמאיות.
7. רק לאחר מכן להחליט אם נדרשת פרוסת קוד לתיקון אובדן מידע. אין להוסיף שדות למודל רק כדי לפצות על adapter שגוי.
