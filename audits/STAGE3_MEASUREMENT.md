# STAGE3_MEASUREMENT — נכסים, סגנונות ומדידה אחידה (שלב 3)

> **תוכנית:** `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md` §§3.1–3.3.
> **ענף:** `stage3/assets-styles-measurement` (בסיס: main `db3ff53` — שלב 2 ממוזג).
> **מימוש:** `src/engine/assets/` · `src/engine/typography/font-resolver.js` · `src/engine/typography/units.js` · הרחבת `measure-api.js` · `src/engine/measure/measure-model.js` · הרחבת `model/document-model.js` + `model/kinds.js` · הרחבת `ui/worker-protocol.js` + `ui/engine-worker-main.js`.
> **בדיקות:** `tests/unit/s3-assets.test.js` (17) · `tests/unit/s3-measure.test.js` (21).

---

## 1. תמצית

שלב 3 הושלם כ**תשתית מדידה קנונית אחידה** מעל המודל הקנוני של שלב 2 — בלי לגעת במסלולי הריצה הקיימים (DP/מורשת): כל השינויים החדשים הם הרחבה בלבד; **אפס שינוי פריסה** (כל הנעילות זהות: canonical `80f9ed6c`, very_long DP `77d5d5d3`, very_long legacy `legacy-7dd45`). שלב 4 יחליף את צריכת המדידה במנוע השורות המאוחד — החוזה כאן כבר כתוב, נבדק ונעול.

## 2. מה נבנה

### 2.1 Asset Resolver יחיד (`src/engine/assets/asset-resolver.js`)
- **מקורות:** בתים ישירות (מזהה פנימי/data source), ZIP (zip-reader הקיים), provider סביבתי (תיקייה/קובץ מקומי — fs ב-Node, File API בדפדפן; ה-resolver עצמו טהור), רשימת הפניות.
- **זהות content-addressed:** `ast-<kind>-<sha256(bytes)[:14]>` — אותם בתים ⇒ אותו מזהה בכל סביבה ובכל ריצה (מוכח בבדיקות). זהות המסמך (מהמקור, שלב 2) נשמרת במודל; הזהות מהתוכן נקשרת ב-`contentAssetId` בזמן הבנייה עם resolver.
- **בטיחות נתיבים:** נורמליזציה אחידה; דחיית `..`/absolute/כונן/NUL; סיומות נתמכות בלבד (png/jpg/jpeg/gif/bmp/webp/svg — הרשימה שהמוצר תומך בה בפועל). כל דחייה = אבחון מפורש.
- **Worker transport (§3.1-2):** `serializeForTransport()` / `fromTransport()` — בתים + מזהים בלבד, סכמה `asset-transport-v1`; הפרוטוקול (`worker-protocol.js`) מאמת; אין נתיבים מקומיים ואין גישה סמויה של ה-Worker למערכת הקבצים.

### 2.2 מדידת תמונות מבתים אמיתיים (`src/engine/assets/image-meta.js`)
- פרסר כותרים בינארי טהור (בלי DOM/`Image()`): PNG (IHDR + acTL/APNG), JPEG (SOF + **EXIF orientation** — הצירים מתחלפים ב-5–8), GIF, BMP, WebP (VP8/VP8L/VP8X), SVG עם מידות קבועות.
- `displayWidth/displayHeight/aspectRatio` אחרי orientation; קלט פגום/לא-נתמך = `{ok:false, code}` מפורש.
- **fit/scale (§3.1-4):** `widthPct` מהרוחב הזמין, יחס-גובה נשמר תמיד; מדיניות ההצבה (inline/block/centered/float-start/float-end) = `IMAGE_PLACEMENT` ב-`kinds.js` — אילוצי אותו מנוע, לא מסלולים נפרדים.

### 2.3 Font Resolver יחיד (`src/engine/typography/font-resolver.js`)
- **הרחבת הקיים** (§3.1-12): הרישום הגולמי נשאר font-metrics (hmtx/cmap/kern/GPOS/OS2); ה-resolver מוסיף זהות `fnt-<sha256[:14]>`, פנים, מטריקות מסוכמות, טביעת אצבע משלימה.
- **רישום יחיד:** הרישום ב-resolver מסנכרן אוטומטית למרשמת של measure-api (`restoreFontRegistration` — בלי פירוק חוזר).
- **fallback מפורש (§3.1-5):** שרשרת מבוקש → stack-fallback → ברירת הגדרות; כל דילוג מתועד ב-diagnostics; אין גופן בכלל = דחייה מפורשת (`font-unavailable`) — לא נפילה שקטה. alias כפול על גופן שונה = דחייה.
- **משפחות באותה מילה (§3.1-6):** המדידה פר-ריצה בגופן שלה (ראה 2.4); kerning/GPOS דרך font-metrics הקיים בתוך ריצה.

### 2.4 Measure API קנוני — הרחבה, לא API שני (`measure-api.js`)
- `measureItem(item, style, ctx)` → **MeasuredItem בלתי-ניתן לשינוי**: `advance/width`, `ascent/descent`, `height`, `baseline`, **`inkBounds` נפרד מ-advance** (מקור מתועד: advance-approximation; עיגול גליפים אמיתי יתווסף בלי שינוי חוזה), `breakOpportunities` (מזינים את שלב 4), `segments` פר-ריצה, `unit:'px'`, חית סביבה.
- כל סוגי הפריטים: text (רב-גופני), image (דרך resolver + fit מאילוצים), noteMarker (אטום, בגודל רישום), atomicToken/anchor/glue/penalty/custom. פריט לא נמדד = `{ok:false, code, message}` — לא נעלם (§3.1-11).
- **מטמון מפתח מלא (§3.1-10):** תוכן/מזהה + זהויות גופן + גודל/סגנון + שפה/כיוון + נכס + גרסת מנוע + חית סביבה. בידוד מוכח: כיוון/גודל/פריט שונים = רשומות נפרדות; אותו קלט = אותו אובייקט.
- `MeasureAPI.forFontId(fontId)` — קשירה לפריט זהות גופן (לא לפי שם).

### 2.5 מדידת מסמך שלם (`src/engine/measure/measure-model.js`)
`measureDocumentModel(model, ctx)` מודד **את כל פריטי המודל** (כולל גופי הערות בגודל רישון) לפני שבירת שורות: טקסט רב-גופני לפי ריצה, תמונות דרך resolver, סמנים אטומים. פלט: מפת itemId→MeasuredItem + רשימת דחיות מפורשת. **גבול השלב נשמר:** אין כאן שום החלטת שבירה/תכנון — שלב 4 יצרוך.

### 2.6 יחידות ו-rounding אחידים (`src/engine/typography/units.js`)
px CSS (96/in) פנימי; pt→px=×4/3; mm; מדיניות עיגול יחידה (`none` קנוני, `render` בגבול ההקרנה בלבד) — נעילת התנהגות הקיימת (S5.1 "בלי Math.round") במקום אחד.

### 2.7 חיבור המודל וה-Worker
- `buildDocumentModel(raw, {assets})`: פריטי תמונה ממולאים במידות טבעיות מבתים אמיתיים בזמן הבנייה (טוהר נשמר — אין שינוי לאחר בנייה); בלי resolver נשאר ה-pending המתועד של שלב 2.
- `typeset-request` בפרוטוקול ה-Worker מקבל `assets` מאומת (סכמה/מזהים/בתים); ה-Worker בונה resolver מההעברה.

## 3. שעת הקבלה (§3.3) — מצב

- [x] **כל סוג פריט במודל מקבל מדידה קנונית** — measureDocumentModel מכסה 100% או דוחה במפורש (בדיקה: measured+rejected=items).
- [x] **תמונות וטווחי גופן נמדדים לפני שבירת שורות** — בזרם הקנוני (measureDocumentModel); הצריכה של מנוע השורות היא שלב 4 (מסלולי הריצה הקיימים לא שונו — החלטת גבול מכוונת).
- [x] **אין קריאת DOM מדידה מחוץ למימוש מאושר** — בדיקת שלילה סטטית (offsetHeight/scrollHeight/getClientRects) על כל src/engine, עם הסרת הערות; 0 פגיעות.
- [x] **אותו קלט ⇒ אותו פלט** — דטרמיניזם מוכח (עצמים מטמון זהים; זהויות זהות בין ריצות; worker parity).
- [x] **אין פריט חסר מדידה ללא diagnostic** — rejected[] מפורש בכל שכבה.
- [x] **ה-Worker וה-UI משתמשים באותם asset/font identities** — content-addressed; transport שומר מזהים ומדידות (מוכח).
- [x] **אין API מדידה מקביל חדש** — הרחבה של MeasureAPI הקיים בלבד (measureItem מעל measureTextWidth/forFontId).

## 4. דוח parity (§3.2)

`tests/artifacts/s3-measure-parity.json`: סטייה מספרית מתועדת בין המימושים table (קירוב מכויל) ↔ font-metrics (טבלאות אמת) על מילים עבריות, כולל ממוצע סטייה מוחלטת. **הכרעת סמכות (קיימת, EXT-13):** כשהגופן רשום — font-metrics הוא מקור הסמכות (resolveMeasureImpl); table הוא קירוב בלבד. החלטת הסבילות המספרית בין סביבות (שאלה 13) נותרת להכרעת המשתמש — התשתית והמספרים מונחים.

## 5. מה לא נעשה כאן (גבולות השלב — בכוונה)

1. **צריכת המדידה במנוע שורות/Planner** — שלבים 4–5 (מסלולי הריצה לא שונו; נעילות זהות).
2. **עיגול גליפים אמיתי ל-ink bounds** (glyf) — החוזה נפרד ומתועד; המקור כיום advance-approximation.
3. **תמונות בכותרות** — ההגדרה (בלתי-תמונות) נותרת כפי שאושר בשלב 2 עד הכרעת שאלה 14(ג).
4. **מיזוג מסלול המורשת** — שלב 9.

## 6. ראיות

| בדיקה | תוצאה |
|---|---|
| `npm test` (מלא; +38 חדשות של שלב 3) | **899/899 — 0 כישלונות** |
| `npm run test:determinism` | `80f9ed6c` — זהה לבסיס |
| `node tools/cross-check.js` | canonical `80f9ed6c` ✓ · very_long DP `77d5d5d3` ✓ · legacy `legacy-7dd45` ✓ — **אפס שינוי פריסה** |
| scan-control-triggers | 0 הפרות |
| באנדלים | נבנו מחדש (D-65) |
| בדיקת שלילה DOM-מדידה | 0 פגיעות ב-src/engine |
