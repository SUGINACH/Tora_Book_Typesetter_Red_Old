# STAGE3_MEASUREMENT — נכסים, סגנונות ומדידה אחידה (שלב 3)

> **תוכנית:** `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md` §§3.1–3.3.
> **ענף:** `stage3/assets-styles-measurement` (סונכרן מול main `329cc40` — כולל PR #21/R-03; בסיס שלב 2: `db3ff53`).
> **מימוש:** `src/engine/assets/` · `src/engine/typography/font-resolver.js` · `src/engine/typography/units.js` · הרחבת `measure-api.js` · `src/engine/measure/measure-model.js` · הרחבת `model/document-model.js` + `model/kinds.js` · הרחבת `ui/worker-protocol.js` + `ui/engine-worker-main.js` + `ui/worker-client.js` + `engine/core/pipeline.js` (קליטת נכסים נצפית בלבד).
> **בדיקות:** `s3-assets` (17) · `s3-measure` (21) · `s3-cache-collision` (13) · `s3-immutability` (9) · `s3-font-sync` (10) · `s3-transport-integrity` (10) · `s3-worker-e2e` (6 — Worker אמיתי).

---

## 1. תמצית

שלב 3 מספק **תשתית מדידה קנונית אחידה** מעל המודל הקנוני של שלב 2, כולל תיקוני החסמים שעלו בביקורת PR #22 (מפתח מטמון, immutability, אימות transport, איחוד רישום גופנים). מסלולי הריצה הקיימים (DP/מורשת) לא שונו: **אפס שינוי פריסה** (canonical `80f9ed6c`, very_long DP `77d5d5d3` — זהים לבסיס; legacy `legacy-a8bdd` — נעילת הבסיס שאחרי R-03/PR #21).

**גבול מדויק (להבדיל מהדוח הקודם):** המדידה הקנונית (`measureDocumentModel`) היא תשתית מוכחה בבדיקות ומחוברת ל-Worker וללקוח החי — אך **עדיין אינה נצרכת על ידי מנוע הפעיל**: בנתיב הפעיל המדידה ממשיכה להתבצע מילה-מילה בתוך שבירת השורות (`widthFor`), כפי שהיה. שער הצריכה נסגר בשלב 4 — שם מנוע השורות המאוחד יקבל את ה-MeasuredItem-ים כקלט. לא הוכנס מנגנון מדידה כפול לנתיב הפעיל (החלטת גבול מכוונת לפי הוראת הביצוע §6).

## 2. סולם מצבי החיבור — מה מוכח ומה ממתין

| שכבה | מצב | הוכחה |
|---|---|---|
| **תשתית קיימת ונבדקת** (unit) — `measureItem`, `measureDocumentModel`, מפתח מטמון קנוני, immutability עמוק, AssetResolver, FontResolver | ✒ נבדק | `s3-measure` (21), `s3-cache-collision` (13), `s3-immutability` (9) |
| **תשתית המחוברת ל-Worker** — `register-font` דרך ה-FontResolver הקנוני (fontId זהה בשני הצדדים), הובלת נכסים `serializeForTransport`→`fromTransport` עם אימות זהות מהבתים, מטמון deserialization | ✒ נבדק ב-Worker אמיתי (worker_threads, structured clone בפועל) | `s3-worker-e2e` (6), `s3-transport-integrity` (10), `s3-font-sync` (10) |
| **תשתית המחוברת לזרימת המוצר** — `WorkerEngineClient.requestTypeset({…, assets})` (הלקוח החי של app-shell) מקבל AssetResolver/transport, מעביר בהודעת `typeset-request`; הצינור מקליט את קבלת הנכסים בעקבות (`doc-assets-received`) ואינו בולע אותם בשקט | ✒ נבדק (E2E דרך לקוח המוצר) | `s3-worker-e2e` — בקשת `requestTypeset` עם `assets` מחזירה תוצאה תקינה + אירוע עקבות |
| **תשתית שהמנוע כבר צורך** | ✗ **עדיין לא** — `typeset()` אינו קורא ל-`measureDocumentModel`; המדידה בנתיב הפעיל נשארת מילה-מילה בתוך השבירה (`widthFor`→`measureTextWidth`) | הוכחת שלילה: הנעילות (`80f9ed6c`/`77d5d5d3`) זהות לבסיס — אין מדידה חדשה בנתיב |
| **יכולות שממתינות לשלב 4** — צריכת MeasuredItem-ים במנוע השורות המאוחד; הזדמנויות שבירה מהמדידה; אילוצי wrap-around לתמונות; סמנטיקת D-S2H3 כפריט סמנטי | ⏳ שלב 4 | — |

**ליקוט הוגנות מהדוח הקודם:** הכרזת "ה-Worker וה-UI משתמשים באותם asset/font identities — מוכח" לא הייתה מדויקת לפני התיקונים (הלקוח החי לא שלח assets; רישום הגופן ב-Worker עקף את ה-resolver). כעת היא מוכחת בפועל: בדיקות `s3-worker-e2e` עוברות גבול Worker אמיתי ומאמתות זהות fontId וזהות assetId + מדידות זהות בשני הצדדים.

## 3. מה נבנה

### 3.1 Asset Resolver יחיד (`src/engine/assets/asset-resolver.js`)
- **מקורות:** בתים ישירות, ZIP (zip-reader הקיים), provider סביבתי (ה-resolver טהור — אין fs/DOM בתוכו), רשימת הפניות.
- **זהות content-addressed:** `ast-<kind>-<sha256(bytes)[:14]>`; זהות המסמך (שלב 2) נשמרת; הזהות מהתוכן נקשרת ב-`contentAssetId` בזמן הבנייה עם resolver.
- **בטיחות נתיבים:** נורמליזציה; דחיית `..`/absolute/כונן/NUL; סיומות נתמכות בלבד. כל דחייה = אבחון מפורש.
- **Worker transport (§3.1-2):** `serializeForTransport()` (תקרה מפורשת, ברירת מחדל 64MB) / `fromTransport()` — **אימות שלמות (תיקון ביקורת):** המזהה המוצהר חייב להתאים לזהות המחושבת מחדש מהבתים; מזהה לא-תואם, בתים חסרים/ריקים, מזהה כפול סותר או חריגת תקרה — נדחים עם `transportReport` מפורש ואבחונים; כפילות מושלמת idempotent. בתים + מזהים בלבד — אין נתיבים מקומיים (נבדק).

### 3.2 מדידת תמונות מבתים אמיתיים (`src/engine/assets/image-meta.js`)
פרסר כותרים בינארי טהור: PNG (כולל APNG), JPEG (SOF + EXIF orientation), GIF, BMP, WebP, SVG במידות קבועות. `displayWidth/displayHeight/aspectRatio` אחרי orientation; קלט פגום = `{ok:false, code}`. **fit/scale (§3.1-4):** `widthPct` מהרוחב הזמין, יחס-גובה תמיד נשמר; מדיניות הצבה = `IMAGE_PLACEMENT` ב-`kinds.js`.

### 3.3 Font Resolver יחיד (`src/engine/typography/font-resolver.js`)
- **הרחבת הקיים (§3.1-12):** הפרנסר הגולמי נשאר font-metrics; ה-resolver מוסיף זהות `fnt-<sha256[:14]>`, מטריקות מסוכמות, שרשרת fallback עם סיבה.
- **רישום יחיד:** רישום ב-resolver מסונכרן למרשמי measure-api (כולל העברת הבתים — זהות התוכן נשמרת בשני הצדדים).
- **סנכרון ניקוי דו-כיווני (תיקון ביקורת):** `clearFontResolver` ⇄ `clearRegisteredFonts` ⇄ `unregisterFont`/`unregisterAlias` — אין מצב שבו צד אחד אומר "לא רשום" והצד השני ממשיך למדוד דרך רישום ישן (מוכח ב-`s3-font-sync`).
- **fallback מפורש (§3.1-5):** מבוקש → stack-fallback → ברירת הגדרות; כל דילוג ב-diagnostics; alias כפול על בתים שונים = דחייה מפורשת (`alias-conflict`) — גם דרך ה-Worker.

### 3.4 Measure API קנוני — הרחבה, לא API שני (`measure-api.js`)
- `measureItem(item, style, ctx)` → **MeasuredItem בלתי-ניתן לשינוי בעומק מלא (תיקון ביקורת):** `_deepFreeze` על כל המבנים — `inkBounds`, `segments` וכל segment, `breakOpportunities` וכל הזדמנות, `diagnostics`, `natural`, `fit`, `placement`; גם תוצאות דחייה קפואות. אין דליפת mutable מהמטמון (נבדק בסריקת השגה).
- **מפתח מטמון קנוני (תיקון שורש של הביקורת):** `item.id` אינו מחליף תוכן. המפתח כולל: מזהה פריט, טביעת payload מלאה (טקסט/ריצות/widthPct/מזהי נכסים), סוג, טביעת סגנון מלאה, אילוצי פריט, זהויות גופן קנוניות + **חית סביבה מזהויות-תוכן** (`fnt-<sha256[:14]>` — לא שם+מספר גליפים), זהות נכס content-addressed מה-resolver (שרשרת המועמדים), שפה/כיוון, אילוצי מדידה מלאים, גרסת מנוע, וחית סביבה **חיה** שמחושבת בזמן המדידה. סריאליזציה קנונית (`_canonicalStringify`): מפתחות ממוינים, בתים נטחנים לזהות תוכן — יציבה בין סביבות. **בדיקות התנגשות מכוונות:** אותו מזהה עם טקסט/תמונה/רוחב זמין/widthPct/גופן/ריצות שונים ⇒ miss; אותו resourcePath עם תוכן נכס שונה ⇒ אין שיתוף; שתי סביבות עם זהות גופן שונה ⇒ בידוד; interleaving מסמכים; אותו קלט ⇒ hit.
- `MeasureAPI.forFontId(fontId)` — קשירה לפי זהות, לא לפי שם.
- **חריג תיעודי:** `measure-api.registerFont` נותר הרישום הגולמי ברמת המנוע (בליווי מעקב זהות-תוכן) — בשימוש החוקי היחיד של החלפה זמנית בייצוא PDF (`export-api`, שחזור בסוף). רישום הגופן של המוצר (UI→Worker) עובר כולו דרך ה-resolver הקנוני.

### 3.5 מדידת מסמך שלם (`src/engine/measure/measure-model.js`)
`measureDocumentModel(model, ctx)` מודד את כל פריטי המודל (כולל גופי הערות בגודל רישון). פלט: **מפת itemId→MeasuredItem קריאה-בלבד** (`ReadOnlyMeasuredMap` — `set/delete/clear` זורקים; תיקון ביקורת: `Object.freeze` על Map אינו חוסם) + דחיות וסטטיסטיקה קפואים. **גבול השלב:** אין כאן החלטת שבירה/תכנון — שלב 4 יצרוך.

### 3.6 יחידות ו-rounding אחידים (`units.js`)
px CSS פנימי; pt→px=×4/3; mm; מדיניות עיגול יחידה (`none` קנוני, `render` בגבול ההקרנה). נעילת S5.1 במקום אחד.

### 3.7 חיבור המודל, ה-Worker וזרימת המוצר
- `buildDocumentModel(raw, {assets})`: פריטי תמונה ממולאים במידות טבעיות + `contentAssetId` בזמן הבנייה; בלי resolver — pending מתועד (שלב 2).
- `worker-protocol.js`: `typeset-request` מקבל `assets` מאומת (סכמה/מזהים/בתים).
- **`engine-worker-main.js`:** `register-font` עובר דרך ה-FontResolver הקנוני ומחזיר `fontId` ל-UI (זהות זהה בשני הצדדים — מוכח); נכסי ההודעה נבנים ל-resolver עם אימות שלמות, במטמון לפי זהות ה-transport (בלי פענוח חוזר של אותם בתים; בלי מקור אמת נוסף).
- **`worker-client.js` (הלקוח החי):** `requestTypeset({text, settings, onProgress, assets})` — מקבל AssetResolver או transport מוכן; כישלון סריאליזציה/תקרה = דחייה מפורשת לפני המשלוח. ניגון חוזר של רישומי גופנים אחרי respawn ממשיך לעבוד (S70) — כעת דרך ה-resolver, והזהות נשמרת (מוכח).
- **`pipeline.js`:** `env.assets` שהגיעו נקלטים ונרשמים בעקבות (`doc-assets-received`, עם סימון `consumptionGate: stage4-line-engine`) — קליטה נצפית, לא שקטה; **אין צריכה בשלב זה** (ראה סולם מצבים).
- **מה עדיין אין בזרימת המוצר:** משטח UI שמעלה נכסי מסמך (תמונות inline) עדיין לא קיים במוצר — ה-AssetResolver נבנה ומחובר עד נקודת הלקוח; כשהמשטח ייווצר הוא יקרא ל-`requestTypeset({assets})` הקיים. לא נבנה כאן משטר מדומה.

## 4. שעת הקבלה (§3.3) — מצב מדויק

- [x] **כל סוג פריט במודל מקבל מדידה קנונית** — בזרם הקנוני (measureDocumentModel): measured+rejected=items (מוכח).
- [x] **תמונות וטווחי גופן נמדדים לפני שבירת שורות** — בזרם הקנוני. **בנתיב הפעיל זה עדיין לא מיושם** — הצריכה היא שער שלב 4 (הנעילות הזהות מוכיחות שלא נוסף מנגנון כפול).
- [x] **אין קריאת DOM מדידה מחוץ למימוש מאושר** — בדיקת שלילה סטטית; 0 פגיעות.
- [x] **אותו קלט ⇒ אותו פלט** — דטרמיניזם מוכח; זהויות content-addressed זהות בין ריצות ובין צדדים (כולל גבול Worker אמיתי).
- [x] **אין פריט חסר מדידה ללא diagnostic** — rejected[] מפורש בכל שכבה.
- [x] **ה-Worker וה-UI משתמשים באותם asset/font identities** — מוכח כעת ב-Worker אמיתי (`s3-worker-e2e`: fontId זהה, assetId זהה, מדידות זהות, respawn שומר זהות).
- [x] **אין API מדידה מקביל חדש** — הרחבה של MeasureAPI הקיים; החריג המתועד היחיד הוא החלפה זמנית בייצוא (סעיף 3.4).
- [ ] **צריכת המדידה על ידי המנוע** — **שער פתוח במפורש; נסגר בשלב 4.** שלב 3 אינו מוכרז "מוזג לתוך הצינור" אלא "תשתית מוכחת + מחוברת עד שער הצריכה".

## 5. דוח parity (§3.2)

`tests/artifacts/s3-measure-parity.json`: סטייה מספרית מתועדת בין table (קירוב מכויל) ↔ font-metrics (טבלאות אמת) על מילים עבריות. **הכרעת סמכות (EXT-13, קיימת):** גופן רשום ⇒ font-metrics. החלטת הסבילות המספרית בין סביבות (שאלה 13) נותרת להכרעת המשתמש — התשתית והמספרים מונחים; לא נקבעה סבילות חדשה.

## 6. מה לא נעשה כאן (גבולות — בכוונה)

1. **צריכת המדידה במנוע שורות/Planner** — שלבים 4–5 (שער הצריכה; ראה סולם מצבים).
2. **עיגול גליפים אמיתי ל-ink bounds** (glyf) — המקור כיום advance-approximation, מתועד בחוזה.
3. **תמונות בכותרות** — נותר כפי שאושר בשלב 2 עד הכרעת שאלה 14(ג).
4. **מיזוג מסלול המורשת** — שלב 9.
5. **משטח העלאת נכסים ב-UI** — אינו חלק משלב 3; נקודת החיבור (`requestTypeset({assets})`) קיימת ונבדקת.
6. **שאלות פתוחות 12–14** — ללא שינוי ערכי ברירת מחדל/מזהים/הגדרות משתמש; ללא קביעת סבילות חדשה; הצעת חוזה הפריט אינה מוכרזת כמאושרת.

## 7. ראיות

| בדיקה | תוצאה |
|---|---|
| `npm test` (מלא; 56 חבילות) | **1008 עברו / 0 נכשלו / 0 דולגו** (exit 0) |
| `npm run test:determinism` | `80f9ed6c` — זהה לבסיס |
| `node tools/cross-check.js` | canonical `80f9ed6c` ✓ · very_long DP `77d5d5d3` ✓ · legacy `legacy-a8bdd` ✓ (= נעילת main אחרי R-03) — **אפס שינוי פריסה מהתיקונים** |
| scan-control-triggers | 0 הפרות |
| באנדלים | נבנו מחדש (app `68772a11`, worker `506481d0`) |
| בדיקות התנגשות מטמון (חדש) | 13/13 — אותו ID + payload שונה ⇒ miss, בכל הווריאציות שנדרשו |
| בדיקות immutability (חדש) | 9/9 — עומק מלא, מפה קריאה-בלבד, אין דליפת mutable |
| בדיקות סנכרון גופנים (חדש) | 10/10 — ניקוי דו-כיווני, unregister, respawn, alias-conflict |
| בדיקות אינטגרציית transport (חדש) | 10/10 — אימות זהות מהבתים, תקרות, כפילויות, round-trip |
| בדיקות Worker E2E אמיתי (חדש) | 6/6 — worker_threads + structured clone: fontId/assetId זהים בין הצדדים, עימוד עם assets, respawn |
| בדיקת שלילה DOM-מדידה | 0 פגיעות ב-src/engine |

**הערת baseline:** כשלי ה-audit הפתוחים F-BL1 (layout-audit ב-very-large) ו-F-BL2 (full-math-audit) קיימים כבר מבסיס שלב 2 ואינם חלק משלב 3; נמשיך לעקוב אחריהם כמתועד — לא הוספו כשלים חדשים.
