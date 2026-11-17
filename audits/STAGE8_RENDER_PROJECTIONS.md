# שלב 8 — מקרינים טהורים, תצוגה וייצוא מתוך PageModel

> מסמך מצב חי — מתעדכן בכל פרוסה. בסיס: main `740721d` (שלב 6 הושלם — PR #30).

## פרוסה 1 (17.11, ענף stage8a/materialization) — הפרדת materialization חד-פעמי (§4.1)

**הפער:** buildPageModel קרא ל-projectDocument מ-output/ — מנגנון שממשיך לקבל החלטות גיאומטריה: מדד מחדש את רוחבי כל מילות הגוף (בגוף הטקסט — כולל כותרות שנמדדו בזמן השבירה בגופן הכותרת ⇒ תצוגה≠ייצוא ברמת המילה), מדד ושבר תוכן מבני (TOC/שערים/סלוטי כותרת/גיליון), וחילק נתיבי מרזב בעצמו.

**הפתרון:**
1. **`layout/structural-stamps.js` (חדש)** — הטבעת גיאומטריית התוכן המבני בזמן התכנון (ה-pipeline קורא לפני בניית המודל, אחרי כל ההחלטות): page.tocLayout (מילים נמדדות), page.shaarLayout (בלוקים+שורות+רוחבים+גופן+צבע+מיקום), page.headerSlotGeo, page.folioGeo, page.footnoteLanes.
2. **`core/materialize.js` (הועבר מ-output/geometry-projector.js)** — המנגנון הפנימי הטהור: רוחבי מילים **מה-LineModel** (measuredAdvance של הפרגמנטים + naturalPx של ה-glue — מדידת השבירה היחידה), תוכן מבני מהחותמות, מיקומים מהתוכנית. **אפס measureTextWidth, אפס נפילות** על תוצר ה-pipeline (מוכח בבדיקה). נפילה לקלט סינתטי ⇒ diagnostic גלוי (materializeFallbacks).
3. **`output/geometry-projector.js` — facade מעבר** לנתיב ה-PDF הוותיק ולבדיקות: מבטיח חותמות (מטביע חד-פעמית לקלט סינתטי, מסומן) ואז מנגנון ה-materialization היחיד — אין מנוע שני. יוסר בשלב 9 לאחר הוכחת parity.
4. **page-model** קורא ל-materializeDocument ישירות; **pipeline** מטביע ומדווח (אירוע structural-stamps).

**ראיות:** s8a-materialization חדשה (6): טוהר (0 מדידות/0 נפילות), חותמות לכל עמוד מבני, שקילות facade (ביט-לביט), רוחבי כותרות מה-LineModel, layoutHash נשמר (f6f32c40 — ההטבעה אינה משנה תכנון), דטרמיניזם הקרנה, נפילה גלויה לקלט סינתטי. cross-check PASS (כל הנעילות); test:determinism OK; 69/70 באצווה + s10-ui ירוקה בנפרד (פלייק ידוע של תחרות פורטים בהרצה טורית — אינו קשור לשינוי; הופיע גם באצוות קודמות).

**שינוי גיאומטרי מתועד:** רוחבי מילות כותרות בהקרנה מתוקנות מגוף-הגוף לגופן הכותרת האמיתי (17 שורות בקנוני; geometryHash המודל משתנה, layoutHash לא). תיקון מחלקת תצוגה≠ייצוא — לא רגרסיה.

**נותר לפרוסאות הבאות:** השלמת שדות PageModel + Worker transport (פרוסה 2); DOM/HTML/PDF מהמודל (פרוסות 3–5); מלאי כפילויות + parity + דוח ביצועים (פרוסה 6).

## פרוסה 1-ביקורת (17.11, ענף stage8b/materialize-boundary) — §3.1–§3.3: גבולות materialization

**הפער שנבדק (הוראת §3):** האם הקוד החדש מושלם רק משום שהבדיקות עברו. נבדקו כל התלויות של core/materialize.js, כל נתיבי ה-fallback, תוצאות PR #30, ודיוק הדיווח על ה-69/70.

**ממצאי הביקורת (לפני התיקון):**
1. **תלות הפוכה core→renderer:** materialize ייבא scrubPUAText מ-output/dom-renderer. הועבר למודול הניטרלי **core/pua-text.js** (קבועי PUA + scrub; dom-renderer צורך ומייצא הלאה — SSOT).
2. **כפילות familyFontKeyOf** — שני עותקים זהים (materialize + structural-stamps). הועבר למקור יחיד **typography/font-keys.js** (עותק שלישי ב-legacy-projector ייסגר בשלב 9).
3. **נקב אמיתי בטוהר הייצור — כותרת עמודי הערות:** projectEndnotePage סינתז את הכותרת בעצמו (fakeLine — מדידה בזמן materialization). במסמכים עם note-placement-mode=endnotes היה מדידה שנייה במסלול הייצור. **תוקן בשורש:** stampEndnoteHeading חדש (structural-stamps) — page.endnoteTitleGeo (מילים+רוחב רווח+גודל+מפתח גופן) נמדד פעם אחת בהטבעה; ההקרנה צורכת. fontKey 'heading' (/F3) נשמר כמו בנתיב הישן.
4. **נפילת-שווא (852 שורות ב-very_long):** שורה חד-מילית אין לה glue ב-LineModel (אין רווחים למלא) — וההקרנה דרשה רוחב רווח בלתי-מותנה ⇒ "נפילת מדידה" כזובה + מדידת רווח. **תוקן בשורש:** רוחב רווח נדרש רק לשורה רב-מילית; חד-מילית ⇒ 0 ללא נפילה.
5. **מצבי הפעלה מתוחמים (§3.1-5):** materializeDocument/projectPage מקבלים {measure, mode}:
   - **'production'** (מ-buildPageModel): אסורה מדידת טקסט. כל חוסר נתון (חותמת TOC/שער/גיליון/כותרת/נתיבים/LineModel/רוחבים) ⇒ diagnostic מזוהה — ולא השחזור ולא מדידה. שורת גוף בלי LineModel: המילים נשמרות (חשבונאות מלאה) ברוחב 0 מסומן + diagnostic. מניעת כפילויית MeasureAPI (היה נבנה פעמיים ב-projectDocument).
   - **'compat'** (ברירת מחדל לקריאה ישירה — בדיקות ותיקות + facade/נתיב PDF ותיק): התנהגות ה-fallback הקודמת, מתועדת ונספרת.
6. **חשבונאות גלויה (§3.1-6):** materializeFallbacks של ה-production נכנסים ל-model.diagnostics, ל-model.meta.materializeFallbacks ול-violations של validatePageModel (code: materialize-fallback) ⇒ כל נפילה בייצור = נראית ב-ledger ובבדיקות קורפוס. ה-diagnostics של הבונה (שהיו נאספים ולא היו נצרכים) נושאים כעת במודל.
7. **תיקון דיוק דיווח — ה-69/70:** נבדק לעומת הריצות האמיתיות: **אין תחרות פורטים** (s10-ui אינה פותחת פורטים כלל; אין listen/createServer באף בדיקת אצווה). ה-CI של ראש ה-PR (#31, 04c4d81f) ירוק בכל שלוש גרסאות Node; הכישלון היחיד ב-CI הוא 'local' = בסיס full-math היסטורי. ה-69/70 היה ארע בהרצת האצווה המקומית בלבד (סביבת sandbox מוגבלת). למרות זאת **יוצבו התפרים הרגישים**: waitFor מותנה-מצב מחליף שינה קבועה בנקודות הא-סינכרון של s10-ui (אותם אסרטים, בלי הנחת זמנים).
8. **היגיינה:** facade מטפל כעת גם ב-shaar-back בלי חותמה וב-endnoteTitleGeo בבדיקת החותמות החסרות.

**ראיות (commit ענף, Node v24.22.3):**
- **s8b-materialize-boundary חדשה (8 בדידות):** probe אטום — patch ל-MeasureAPI.prototype.measureTextWidth שזורק — production materialization + buildPageModel עוברים באפס קריאות (תופס גם מופעים פנימיים); endnotes: כותרת מהחותמה בלי מדידה; very_long 1108 עמודים: 0 נפילות (בעבר 852 שווא); מוצא רוחבי-מילה מה-LineModel לכל שורות הגוף (כולל כותרות בגופן משלהן); הזרקות שליליות (חותמת TOC/LineModel/גיליון חסרים) ⇒ diagnostic+violation, טקסט נשמר, אפס מדידות; compat מתועד; אין תלות core→renderer.
- **אצווה מלאה: 70/70 קבצי סוויטה EXIT=0** (כולל s10-ui 43/43; s8b נוספה לשרשרת).
- test:determinism OK (f6f32c4073c4fd35); cross-check PASSED (קנוני f6f32c40, very_long d2a18112, מורשת legacy-a8bdd — כל הנעילות; באנדלים נבנו מחדש ותואמים).
- layout-audit בדפדפן אמיתי: fixture קטן 10/10 עמודים 0 בעיות; very_long 699/699 עמודים (וירטואליזציה, 43,124 שורות) **0 בעיות** — SIDE_NOTE_OVERLAP עמ' 107 נשאר סגור.
- full-math-audit מקומי: אותו בסיס היסטורי בדיוק (353,687 < 355,967 = 0.98×363,232) — ללא שינוי חתימה; הסף לא שונה.
- נייטרליות גיאומטרית: layoutHash זהים ל-main בכל הקורפוסים (כולל endnotes: 00069e7561722ae3 — ההטבעה החדשה אחרי חישוב finalHash).

**פערים שנצפו ותועדו לפרוסה 2 (לא רגרסיה — קיימים ב-main):** מצב endnotes מפיק 105 הפרות PageModel (planned-line-missing 56 — מיפוי זהות שורות-הערות לפי טקסט נכשל; note-without-id 48 — רשומות buildEndnotePages בלי noteId; line-count-mismatch 1). נסגרים בהשלמת המודל (פרוסה 2), לא במקרינים.

**תוצאות PR #30 שנשמרו (§3.3):** חוזה עיטורים + ornament-ink-missing (נבדק: הדיאגנוסטיקה מגיע כעת גם ל-model.diagnostics); הצמדת הערות לעוגנים (s6c ירוקה 15/15 באצווה); fn-anchor-compromise נשמר (s6b ירוקה 23/23); שימור noteId/anchorId/continuationOf/wordRange — ללא שינוי במסלולים אלה.
