# דוח ביקורת פורנזי — מנוע העימוד Red-Build
## פירוק, איחוד ופישוט: מסלולים כפולים, טלאים בדיעבד וריכוז מדיניות

**תאריך:** 2026-11-15
**היקף:** `red-build/src/engine/` — 19,586 שורות ב־62 קבצים (מתוכן `layout/legacy-imud-flow.js` לבדו 3,720 שורות, 19% מהמנוע)
**שיטה:** קריאה מלאה של ציר האורך (`core/pipeline.js` → `layout/*` → `typography/*` → `output/*`), מעקב שרשרת־נתונים שלב־אחר־שלב, ואימות ניסויי של כל טענה בפרובים מבוקרים על `planPages`/`typeset` (ראו נספח א').
**מצב בסיס:** 47 חבילות בדיקה, 100% ירוקות לפני השינויים.

---

## תקציר מנהלים

המנוע מכיל **שני מנועי עימוד שלמים ומקבילים** (מודרני + מורשת IMUD), **שלוש יחידות מידה שונות לקיבולת טור**, **בדיקת ליווי כותרות שאינה קשורה להצבה בפועל**, **התחייבות של הערות־שוליים לעמוד לפני שידוע היכן יוצב העוגן** (הוכח: סמן בעמוד N+1, הערה בעמוד N), **עונש strict מת** שאינו יכול להישרף לעולם, **מזויף אבחוני** המתייג הפרה סטטית כ"תנודה בין תיקונים מתחרים", ו**עמוד ריק פנטום** הנוצר מפער יחידות בין בדיקת הקיבולת להצבה. שש הממצאות הקריטיות (FX-1..FX-6) אומתו בניסוי משוחזר.

ההמלצה: ארכיטקטורת יעד בשלושה שלבים — (1) מטריצת אילוצים אחודה + תיקוני שורש כירורגיים [מיושם ב־PR זה], (2) קו־אופטימיזציה של גוף+הערות במתכנן יחיד, (3) חיתוך מסלול המורשת אחרי פרימת יכולת (capability cutover).

---

# פרק 1 — מסלולים כפולים וגאומטריות מקבילות

## 1.1 שני מנועים מלאים תחת קורת גג אחת

`core/pipeline.js:123-126` — נקודת הפיצול האבסולוטית:

```js
if (settingsIn && settingsIn['_layout-profile'] === 'imud' && settingsIn._imudRaw) {
  const { legacyTypeset } = require('../layout/legacy-imud-flow');
  return legacyTypeset(rawText, settingsIn, env);
}
```

כאשר פרופיל IMUD פעיל, **אף שורה של המסלול המודרני איננה רצה**. שני המנועים מקיימים הפשטות מקבילות מלאות:

| יכולת | מסלול מודרני | מסלול מורשת |
|---|---|---|
| שבירת שורות | `typography/kp-linebreak.js` (Knuth-Plass, 242 ש') | `LineBreaker` פנימי בתוך `legacy-imud-flow.js` (ש' 303+) |
| מדידה | `MeasureAPI` (pipeline.js:186-219) | `prefaceApi`/`fnApi`/`fnMarkApi` נפרדים (legacy-imud-flow.js:977-1008) |
| הצבת הערות | `reserveNotes` ב-dp-planner.js:233-289 | מנגנון S74/S75: `FN_FULL_CAP_PX`, `fn-placement-mode` body-first מול budget-gate (legacy-imud-flow.js:900-936) |
| הקרנה | `output/geometry-projector.js` (878 ש') | `output/legacy-projector.js` (783 ש') |
| רינדור DOM | `renderPage` (dom-renderer.js:1313+) | `renderLegacyPage` (dom-renderer.js:691-1300) |
| חתימת פריסה | `layoutHash` (dp-planner.js:45-54) | `legacyLayoutHashDigest` (legacy-imud-flow.js:3706) |
| קבועי גאומטריה | `page-templates.js` (PAGE_SIZES, A4 מדויק) | `GEO`/`SZ` מקומיים (legacy-imud-flow.js:35-78) — **משוכפלים בערכים** (793.70×1122.52) |

הכפילות איננה רק בשורות קוד: כל תיקון גאומטרי (למשל S5.2/O14 — דיוק A4) חייב לעבור **פעמיים**, וההערה ב-`page-templates.js:24-28` מתעדת בדיוק את זה: "הערכים המעוגלים (794×1123) הזיזו את גוף ה-DP ב-0.3px... כעת זהה ל-GEO של legacy-imud-flow" — סנכרון ידני בין שני מקורות אמת לאותה קבועה.

**מסקנה 1.1:** מדובר ב-Fork פנימי מלא, לא ב"נתיב גיבוי". המחיר: כל מדיניות טיפוגרפית נבנית פעמיים, נבדקת פעמיים, ומוזנחת פעמיים כשאחד הצדדים משתנה.

## 1.2 גובה טור נמדד בשלוש יחידות מידה שונות

אותה תכונה — "כמה תפוס הטור" — מחושבת בשלושה מימושים עם **סמנטיקה שונה**:

1. **`dp-planner.js:133-139`** (מקומי, בלי מתיחה):
```js
function usedHeight(col, page = cur) {
  let h = col.reduce((s, ln) => s + (ln.heightPx || 0), 0);
  if (page && page.fnReservedHeightPx > 0 && page.columns[page.columns.length - 1] === col) {
    h += page.fnReservedHeightPx;
  }
  return h;
}
```
2. **`balancing.js:13-16`** (מיוצא, **עם** מתיחת AQ):
```js
function usedHeight(col) {
  return col.reduce((s, ln) => s + ln.heightPx * (ln.aqStretch || 1), 0);
}
```
3. **`geometry-projector.js:573`** (מפריד הטורים — עם מתיחה, בלי תקציב):
```js
const used = page.columns.map(col => col.reduce((s, ln) => s + (ln.heightPx || 0) * (ln.aqStretch || 1), 0));
```

בזמן ה-DP שלושתן חופפות (aqStretch=1 תמיד), אבל אחרי `alignColumnBottoms`/`autoQualityPass` — המוטציות של S72 — הן מתפצלות: `protections-matrix.containment` (via balancing.usedHeight) רואה טור מתוח, בעוד `flushPage` של dp-planner ראה אותו לפני מתיחה. אין אינדקס יחיד ל"גובה תפוס" — יש שלושה, שכל אחד מתעדכן בזמן אחר.

**נגזרת קריטית — יחידת המידה של בדיקת הקיבולת:** `dp-planner.js:153-160`:
```js
function ensureRoom(neededLines, opts = {}) {
  const cap = colCapacity(cur.template, cur);
  for (let c = 0; c < cur.columns.length; c++) {
    if (cap - usedHeight(cur.columns[c], cur) >= neededLines * lineH - 0.5) return c;
  }
  return -1;
}
```
`ensureRoom` מודד קיבולת **ביחידות `lineH`** (שורה 107: `Math.round(settings['body-font-size-pt'] * (96/72) * settings['body-line-height'])`), בעוד `pushLines` (ש' 198-220) מצרך **`ln.heightPx` בפועל**. כל בלוק ששורותיו נמוכות מ-lineH (כותרות מחושבות אחרת, שורות מעוטרות, פרובים סינתטיים) מפריד בין שתי היחידות. **אומת ניסויית — ראו FX-5 בפרק 4: עמוד ריק פנטום.**

## 1.3 מיקום מילים מחושב פעמיים: שובר השורות מול הפרויקטור

`typography/kp-linebreak.js` מייצר לכל שורה את `widthPx` (ש' 175-180: סכום תיבות + דבקות). אך `geometry-projector.js:675-749` (`projectLine`) **מודד כל מילה מחדש** ומפיץ רווחים בעצמו:

```js
const widths = words.map((w, i) => measure.measureTextWidth(w, effSizeOf(i)));
const sumW = widths.reduce((s, w) => s + w, 0);
...
let gapW = spaceW;
if (align === 'justify' && gaps > 0 && sumW + gaps * spaceW < colW) {
  gapW = (colW - sumW) / gaps;
}
```

במקביל, `dom-renderer.js` מרנדר את אותן שורות **בזרימת CSS** (הדפדפן מפיץ את הרווחים). ההתאמה בין השניים מושגת **בחיקוי**, לא בבנייה: dom-renderer.js:910 מתעד "‏(projectLine: spaceW=(colW-sumW)/gaps) — התצוגה = הייצוא" — כלומר שתי מערכות מחשבות את אותו גודל בנפרד ומקוות להתלכד. כל שינוי נוסחה בצד אחד שובר את השני בשקט (ואכן תוקן שוב ושוב: S5.2 תיקון 3, D-92-DP, EXT-20).

`output/line-font.js` עצמו כבר צומצם לשכבת פענוח גופן/גודל (59 שורות) — הכפילות ההיסטורית שהוא ייצג תוקנה ב-03.11(ג); הכפילות החיה עברה אל `projectLine` מול שבירת השורות ומול CSS.

## 1.4 עטיפת הערות — שני מימושי גרידי ושני מימושי LPT

- **אומדן גובה:** `footnote-budget.js:17-41` (`noteHeight`) עוטף את טקסט ההערה בלולאת גרידי משלו.
- **עטיפת פלט:** `geometry-projector.js:344-389` (`wrapNoteTokens`) עוטף **את אותו טקסט** בלולאת גרידי אחרת (עם `(המשך)`, wFactor, יישור מלא בשורות לא-אחרונות).
- **חלוקת נתיבים (2 טורים):** `footnote-budget.js:66-69` (LPT בתוך `getFootnotesReservedHeight`) **וגם** `geometry-projector.js:427-431` (LPT בתוך `projectFootnoteGutter`) — ההערה בקוד מודה: "אותו אלגוריתם כמו getFootnotesReservedHeight". שני עותקים של אותו אלגוריתם על אותם נתונים.

פער בין האומדן לעטיפה = חפיפת הערות בפלט; ההיסטוריה מתעדת שזה כבר קרה (S6.0/R3-C3: "32% מ-230 הערות בדגימה" חפפו בגלל רווחים שלא נספרו באומדן; S71.1: פקטור גופן ניפח את ההקרנה ב-impl B ⇒ "הערות-סיום חופפות ב-PDF המיוצא").

## 1.5 חיתוך מועמדים — מחושב ונזנח

`layout/candidate-generator.js` (41 שורות) מחשב `before`/`after` לכל נקודת חיתוך — אך נקרא **רק** מ-`findSplit` (dp-planner.js:617-632), שנקרא רק כאשר בלוק שלם אינו נכנס לשום טור. בפרקטיקה: ה"מועמדים" הם מנגנון fallback נדיר, לא ליבת תכנון. הגובה האנכי של אותם בלוקים כבר חושב ב-pipeline (מדידה), נסכם ב-dp-planner (`blockHeight`, ש' 101), וחושב שוב בתוך `generateCandidates` עצמו (ש' 24-25: `blk.lines.slice(0, cut).reduce(...)`). שלוש פסיעות חישוב גובה על אותן שורות בשלושה מודולים.

---

# פרק 2 — שרשרת ה"תיקונים בדיעבד"

## 2.1 לולאת הנסיגה — בקר איטרציות על פריסה שכבר נחתמה

`retreat-loop.js:56-123`: אחרי ש-`planPages` סיים הצבה גרידית, הלולאה מעריכה הפרות (`runProtections`) ומריצה תיקונים לפי סדר קבוע (ש' 90): `['paren-cross-boundary', 'reading-order-break', 'widow-bottom', 'orphan-top', 'heading-escort', 'column-imbalance']`.

**הממצא המרכזי — 4 מתוך 6 "תיקונים" אינם תיקונים.** חיווט ה-repairFns ב-dp-planner.js:532-561:

```js
repairFns: {
  'column-imbalance': (violations, c) => { ... balancePageSafe(pg, c.settings, c.ledger); ... },  // היחד שמשנה פריסה
  'reading-order-break': (violations, c) => { ... c.ledger.transition(rec.issue_id, 'correction-blocked', ...); },
  'widow-bottom': (violations, c) => { ... c.ledger.transition(rec.issue_id, 'correction-blocked', ...); },
  'orphan-top': (violations, c) => { ... c.ledger.transition(rec.issue_id, 'correction-blocked', ...); },
}
```

`widow-bottom`, `orphan-top`, `reading-order-break` — פונקציות רישום בלבד (ledger-only), אפס מוטציה. `heading-escort` ו-`paren-cross-boundary` **כלל לא מחוברות** — למרות שהן ברשימת הסדר. התוצאה: הלולאה אינה "מתקנת בדיעבד" — היא **מתעדת כישלון בדיעבד**, ומדביקה לו תווית אבחונית שקרית (פרק 4, FX-2).

## 2.2 ליווי כותרות — בדיקה מייעצת שההצבה מתעלמת ממנה

`dp-planner.js:466-482` (REQ-BAL-10): לפני הצבת כותרת H1-H6 נבדק `ensureRoom(1 + Math.min(2, following))`. אך ערך ההחזר `room` משמש **רק כבוליאן** — ואז `pushLines` (ש' 198-220) מחליט מחדש, שורה-שורה, בטור הראשון שמכניס את השורה הבודדת:

```js
let room = ensureRoom(needLines);
if (room === -1) { flushPage(); cur = newPage(...); room = ensureRoom(needLines); ... }
// ...room לא מועבר הלאה! //
const need = blk.lines.length;
let chosenCol = ensureRoom(need);   // שוב בוליאן
...
pushLines(blk.lines, { tokenId: blk.tokenId, firstOfBlock: true, docPart: blk.part });
```

הבדיקה אימתה שיש מקום ל"כותרת+2 שורות ליווי" **באיזשהו טור**; ההצבה שמה את הכותרת **בטור הראשון שמכניס את הכותרת לבדה**. כשהליווי נשפך לטור הבא — הכותרת נשארת יתומה בתחתית הטור. זו בדיוק ההפרה ש-protections-matrix.js:95-115 מזהה אחר כך (`after < 2`), בלי פונקציית תיקון. **אומת ניסויית — FX-1 בפרק 4.**

(לעומת זאת `headings-escort.js` עצמו — 33 שורות — כבר צומצם נכון ב-S4.21 להחלטת mode→flags לפני ה-DP, דפוס D-09. הבעיה איננה במודול אלא בפער בדיקה↔הצבה בתוך dp-planner.)

## 2.3 איזון ומתיחה — שלוש פסיעות מוטציה על גאומטריה חתומה

סדר הפעולות בפועל על כל עמוד רגיל:

1. **בסגירת העמוד:** `flushPage` (dp-planner.js:162-196) — `optimalSplit` + `fixDropWordInColumns`.
2. **בלולאת הנסיגה:** `balancePageSafe` (dp-planner.js:571-614) — שוב `optimalSplit`, עם rollback.
3. **אחרי ה-DP, ב-pipeline:** `applyChapterEndMode` (pipeline.js:658-660) — `balancePage` בלית-כשל בסוף פרק; ואז `alignColumnBottoms` (pipeline.js:669) — מוטציה של `ln.aqStretch` על הטור הקצר; ואז `autoQualityPass` (pipeline.js:671) — **שכותב** את `aqStretch` שוב (balancing.js:262: `for (const ln of lines) ln.aqStretch = factor;`).

`fnReservedHeightPx` נחתם בשלב 1; שלב 3 מותח טורים **מתחת לתקרית שנחתמה** (alignColumnBottoms כן מכבד `fnCeil = capAll - fnReservedHeightPx` — balancing.js:148-154 — אך זו בדיקה מקומית שמשחזרת את חוזה התקציב במקום לצרוך אותו). `aqStretch` — שדה גיאומטרי מוטלס — נכתב על ידי שתי פונקציות שרצות ברצף, והאחרונה מנצחת בשקט.

## 2.4 מגינים — הגנה אחרי המעשה במקום קנס בגרף השבירה

`typography/kp-linebreak.js` — כותרת המודול מכריזה "עונשי runt/widow/orphan", אך בגוף `breakLines` קיים **רק** עונש runt (ש' 107: `if (b < INF && w < maxWidthPx * (runts/100)) b += 60;`). אין כל עונש widow/orphan בגרף — המנוע אינו יודע מה השורה הקודמת/הבאה בזמן ה-DP של השורות.

במקום זה, שתי הגנות בדיעבד:
- `protectors.js:80-113` (`fixDropWordInColumns`): אחרי סגירת עמוד, מילה שנפלה לבדה נמשכת חזרה/נדחפת קדימה — מניפולציה על שורות שכבר נמדדו, כולל כתיבת `nextFirst.widthPx` ביד (ש' 107).
- `protectors.js:36-62` (`protectWords`): הדבקת NBSP לפני השבירה — עם **באג ידוע ופתוח** (ש' 41-48): `s.split(/\s+/)` מפרק את ההדבקות כי `\s` תופס גם NBSP; התיקון הוחזר ("הוחזר עד סגירתם — ניתוח מלא ב-ISSUE_REGISTRY", ISSUE #P-1). כלומר: סמן הערה עדיין יכול להישאר בסוף שורה (הפרת BRZ-11) כי ההגנה נבנית ואז מפורקת — במקום קנס ∞ בגרף השבירה עצמו (דווקא המנגנון הזה קיים ועובד: kp-linebreak.js:35: `items.push({ kind: 'penalty', forbidden: true, cost: INF })` ליחידות NBSP — אך היחידות מפורקות לפני שמגיעות אליו).

---

# פרק 3 — ביזור מדיניות ופיצול אילוצים

## 3.1 מדיניות יתומים/אלמנות — שישה מוקדי החלטה, אחד מהם מת

| # | מוקד | ציטוט | אופי |
|---|---|---|---|
| 1 | `settings-registry.js:169-173` | `prevent-widows-top/bottom`, `prevent-orphans-top/bottom`, `widow-strictness` | הגדרות |
| 2 | `dp-planner.js:620-621` (findSplit) | `if (maxFit < 2 \|\| blk.lines.length - maxFit < 2) return 0;` | **מינימום 2/2 מוקשח בקוד** — לא קורא את ההגדרות כלל |
| 3 | `candidate-generator.js:33-34` | `+ (settings['widow-strictness'] === 'strict' && cut < 2 ? 1e9 : 0)` | **מת** — הלולאה (ש' 23) מתחילה ב-`cut = 2` ואיננה מגיעה ל-cut<2 לעולם (FX-4) |
| 4 | `balancing.js:58-68` (cleanBoundary) | בדיקות ריצה structural של tokenId בגבול הפיצול | מינימום 2/2 נוסף, מוקשח |
| 5 | `protections-matrix.js:53-93` | `run < 2`, `sameTokenInCol === 1` + 4 המתגים + strictness | זיהוי בדיעבד |
| 6 | `legacy-settings-map.js:257-258` | `avoid-orphans → prevent-orphans-top` | מיפוי מורשת |

סתירה מובנית: שלב 2 מאפשר פיצול חוקי (≥2/≥2) → שלב 5 עשוי לסמן אותו כהפרה (למשל `widow-strictness: 'relaxed'` מדליק orphan-top ב-5 דווקא כש-2 לא נדרש ב-2) — ואין לו תיקון (2.1). ארבעה מתגי הגדרות (1) נצרכים אך ורק במוקד 5; המתכנן (2) והמאזן (4) מחליטים בלי לדעת מהם.

## 3.2 יישור תחתית ומרווחים — ארבעה בעלי בית

- **`page-templates.js:59-63`** — קובע את `contentBox` (התקרה הפיזית: `textBottom = size.h - marginBottom - folioH`) ואת `headerH`/`folioH`.
- **`dp-planner.js:523-528`** — `allow-terminal-residual-fallback`: מסמן עמוד אחרון חצי-ריק כ-`terminalResidual` ("לא מדווח כ-underfill").
- **`balancing.js`** — ארבעה מנגנונים: `optimalSplit` (מזעור |Δ|), `balancePage`, `alignColumnBottoms` (S72: מתיחת הטור הקצר עד תחתית הארוך), `autoQualityPass` (מתיחת כל טור עד התקרה). שני האחרונים רצים ברצף והשני משכתב את הראשון (2.3).
- **`geometry-projector.js:642-646`** (`lastAlignOf`) + `dom-renderer.js:79` (`lastLineClass`) — יישור שורה אחרונה לפי `body-last-line-align`, בשני מימושים.

גם `settings-registry.js:175-188` מחזיק עוד 13 מפתחות איזון/AQ (`balance-chapter-end`, `imbalance-max-delta-px`, `aq-*` ×9). השאלה "האם העמוד מיושר לתחתית?" נענית למעשה על ידי המנגנון שרץ אחרון — לא על ידי סמכות אחת.

## 3.3 פיצול הערות בין עמודים — שלושה מוקדים במסלול המודרני + רביעי במורשת

1. **אומדן גובה:** `footnote-budget.js:17-41` (`noteHeight`) + `:60-70` (LPT).
2. **החלטת מדיניות:** `dp-planner.js:253-286` (`reserveNotes`) — `long-footnote-policy` ∈ {split, move-whole, reject-to-body}, תקרת `fn-bar-max-height-px`, `fn-layout-mode` ∈ {block, continuous}.
3. **רינדור הפיצול:** `geometry-projector.js:443-447` (טוקן `(המשך)` בראש המשך) + `dom-renderer.js` (`renderFootnoteArea`, `mkNote`) — שחזור אותה מדיניות בשני מדיומים.
4. **מסלול המורשת:** `legacy-imud-flow.js:900-936` — מדיניות משלו (`fn-placement-mode` body-first מול budget-gate, `FN_FULL_CAP_PX`, `FN_BODY_FIRST_CAP_PX`).

בנוסף, החלטת "מתי מותר בכלל לפצל" מפוזרת: `protections-matrix` איננו בודק כלל קולוקציית סמן↔הערה (אין `fn-marker-page` check), ולכן הפרדת סמן/הערה בין עמודים (FX-3, פרק 4) עוברת בשקט גם כשהיא מתרחשת.

## 3.4 סיכום הפיצול

| מדיניות | מוקדי קבלת החלטה | מקור אמת אחיד |
|---|---|---|
| יתומים/אלמנות | 6 (אחד מת) | ✗ |
| יישור תחתית | 4 מודולים + 13 מפתחות | ✗ |
| פיצול הערות | 3 מודרני + 1 מורשת | ✗ |
| ליווי כותרות | dp-planner (בדיקה), protections-matrix (זיהוי), balancing.cleanBoundary (✗ לא מודע) | ✗ |
| קיבולת טור | column-flow (SSOT מ-2025) + 3 צרכני usedHeight שונים | חלקי |

---

# פרק 4 — הוכחות כשל (אומתו ניסויית; פרובים מלאים בנספח א')

## FX-1 — כותרת יתומה בתחתית טור: הבדיקה מאשרת, ההצבה מפרה

**בנייה מספרית** (יחידות px; CAP = 1026.52 = contentBox של תבנית regular; `lineH` = 26 מההגדרות):

- מילוי: 39 שורות גוף בגובה 24.2 → תפוס 943.8, נותר **82.7**.
- בדיקת ליוו� (`ensureRoom(3)`): דורש `3 × lineH − 0.5 = 77.5 ≤ 82.7` → **עוברת** ✓ (ביחידות lineH).
- הצבה בפועל (`pushLines`, ביחידות heightPx): כותרת 37 + פער 5 → 42; שורת ליווי 1: 24.2+5 → 28.7; שורת ליווי 2: 24.2 → סה"כ **94.9 > 82.7** → שורת הליווי השנייה נשפכת לטור הבא.

**תוצאה שנמדדה** (`planPages`, איזון מנוטרל): עמוד `[41,3]`, הכותרת `H` בתחתית טור 0 עם שורה אחת בלבד אחריה (`after = 1 < 2`). הריצה מחזירה:
```
persisted: ["heading-escort@h1@p0c0#1"], converged: false, iterations: 1,
compromise: "rollback-compromise@loop@iter1#1"  (reason: no repair available)
```
ההפרה מזוהה (protections-matrix.headingEscort), נרשמת — וקופאת ללא תיקון, כי ל-heading-escort אין repairFn כלל (2.1).

**שורש הכשל הכפול:** (א) בדיקת הליווי מודדת ביחידות lineH, ההצבה ביחידות heightPx — פער 26 מול 24.2; (ב) תוצאת הבדיקה (`room`) נזרקת — pushLines מחליט מחדש לבד.

## FX-2 — אבחון שקרי: הפרה סטטית מתויגת "תנודה בין תיקונים מתחרים"

`retreat-loop.js:74-83`: כשחתימת ההפרות חוזרת בתוך חלון של 4, נרשם `oscillation-detected` + `rollback-compromise` עם סטטוס `competing-repair-side-effect`. אך כאשר ה"תיקון" שרץ הוא ledger-only (2.1), **שום דבר לא השתנה בין האיטרציות** — אין תחרות, אין תיקון, יש רקע סטטי.

**אומת:** חיווט widow-bottom כ-no-op (כמו ב-dp-planner) על הפרה קבועה → איטרציה 1: רישום; איטרציה 2: אותה חתימה → `oscillation-detected` מופעל על הפרה שמעולם לא זזה. ה-ledger מספר סיפור שקרי על מה שקרה ("תיקונים מתחרים" שלא רצו).

**משפט 4.1 (סיום מוגבל):** בחיווט הנוכחי של planPages, לכל קלט, לולאת הנסיגה מסתיימת ב-≤ OSCILLATION_WINDOW+1 איטרציות. הוכחה: המוטציה היחידה היא balancePageSafe; מוטציה משנה לכל היותר את החתימה; חתימה חוזרת בתוך החלון עוצרת. `MAX_ITERATIONS = 24` אינו בר-השגה למעשה — תצורה מתה. ה"תנודה האינסופית" שהוגדרה כחשש ארכיטקטוני איננה אפשרית כיום לא בזכות תכנון אלא **בזכות ויתור על התיקון**: 4 מתוך 6 פונקציות התיקון אינן מתקנות דבר. אילו חוברו תיקונים אמיתיים ל-heading-escort (דחיפת כותרת+ליווי לעמוד הבא) ולאיזון (משיכת שורות חזרה), היה נוצר מחזור תקופה-2 מובהק: דחיפה מגדילה פער טורים ← איזון מושך את הכותרת חזרה לגבול ← הפרת ליווי ← דחיפה. גלאי התנודה נבנה בדיוק למקרה זה — אבל הוא יורה גם על הצללים (הפרות סטטיות).

## FX-3 — הערה מחויבת לעמוד לפני שהגוף החליט היכן יעמוד (שבירת אמת-תוכן)

`dp-planner.js:409` — `reserveNotes(blk)` רץ **לפני** בדיקת ההצבה (ש' 485-498): ההערות נדחפות ל-`cur.footnotes` והתקציב נחתם (`recomputeFnBudget`), ורק אז נבדק `ensureRoom(need)`. אם הפסקה כולה לא נכנסת ואין פיצול חוקי (`findSplit` מחזיר 0 כש-`maxFit < 2` או `lines − maxFit < 2`) — הפסקה כולה (כולל הסמן) עוברת לעמוד הבא, **אך ההערה נשארת מאחור**.

**אומת (קליברציה דינמית, n=82 בלוקי מילוי):**
```
pages: [{i:0, marker:false, fns:1}, {i:1, marker:true, fns:0}]
markerPage=1, fnPage=0 → SEPARATED: true
```
סמן ההערה מופיע בעמוד 1; טקסט ההערה במרזב עמוד 0. הקורא רואה סמן בלי הערה מתחתיו, והערה בעמוד הקודם בלי סמן. שום בדיקת הגנה לא מזהה זאת (אין kind כזה ב-protections-matrix), ובדיקת שימור התוכן ב-pipeline עוברת כי המילים כולן קיימות — רק ה**קולוקציה** הופרה.

## FX-4 — עונש strict מת (מדיניות שקרית כלפי המשתמש)

`candidate-generator.js:23` — `for (let cut = 2; cut < blk.lines.length; cut++)`; ש' 34 — `settings['widow-strictness'] === 'strict' && cut < 2 ? 1e9 : 0`. תנאי `cut < 2` **בלתי-ספיק לעולם** בטווח הלולאה. **אומת:** ניקוד `strict` זהה ניקוד `normal` בדיוק (`[[2,0],[3,40]]` בשניהם). משתמש שמגדיר "strict" מקבל התנהגות "normal" בלי ידיעתו. העונש המיועד היה לתפוס חיתוך שמשאיר שורת המשך בודדת בראש הטור הבא — התנאי הנכון: `blk.lines.length - cut < 2`.

## FX-5 — עמוד ריק פנטום מפער יחידות קיבולת

בלוק של 40 שורות × 25px = 1005 ≤ 1026.52 — **נכנס פיזית לעמוד**. אך `ensureRoom(40)` דורש `40 × lineH(26) − 0.5 = 1039.5 > 1026.52` → כישלון → `findSplit`: `maxFit = floor(1026.52/26) = 39`, `40 − 39 = 1 < 2` → `return 0` → `flushPage()` על **עמוד ריק** → הבלוק כולו בעמוד הבא.

**אומת:** פלט `planPages`: `[[0,0],[20,20]]` — עמוד ראשון ריק לחלוטין, התוכן בשני. במסמך אמיתי זה עמוד ריק באמצע ספר, מתועד רק כ"פשרה" אם בכלל.

## FX-6 — פער בלוקים נטען בכניסה ולעולם אינו נצבר

`pushLines` (dp-planner.js:201-211): `pendingGap` מעלה את סף הכניסה של השורה הראשונה (`needPx = ln.heightPx + pendingGap − 0.5`), אך ה-gap **אינו נוסף לשום מקום** — `usedHeight`, `optimalSplit`, `colCapacityOf`, וההקרנה (`y += ln.heightPx`) כולם מכירים רק את `heightPx`. הגדרת `grid-block-gap-pct` קיימת אפוא רק כ"מקשיח כניסה" ואינה מיוצגת בשום גאומטריה במורד הזרם. תיעוד הכוונה (column-flow.js:19-25: "כל בלוק חדש בטור פותח ב-gap הזה") אינו תואם את ההתנהגות.

## נגזרת: מטריצת הכשלים

| ממצא | סוג | נראה למשתמש | מזוהה ע"י המנוע? |
|---|---|---|---|
| FX-1 | בדיקה מנותקת מהצבה | כותרת יתומה בתחתית טור | כן (heading-escort) — בלי תיקון |
| FX-2 | אבחון שקרי | דוח שקרי על "תנודה" | — |
| FX-3 | סדר פעולות | סמן והערה בעמודים שונים | **לא** |
| FX-4 | קוד מת | strict ללא אפקט | לא |
| FX-5 | פער יחידות | עמוד ריק | רק אם ידווח underfill (לא תמיד) |
| FX-6 | חשבונאות פנטום | ריווח בלוקים שאינו מוצג | לא |

---

# פרק 5 — תוכנית איחוד ופישוט: ארכיטקטורת יעד נקייה

## 5.1 עקרונות היסוד

1. **Single Source of Truth מלמטה למעלה:** כל גודל גאומטרי נקבע פעם אחת, במודול אחד, ונצרך על ידי כולם.
2. **אילוצים בבנייה (by-construction), לא בתיקון:** keep-with-next, יתומים/אלמנות ותקציב הערות נכנסים להחלטת ההצבה עצמה — לא נבדקים אחריה.
3. **רנדררים טיפשים:** המודל (`RenderModel`) נושא כל מיקום מוחלט; DOM/PDF רק מציירים.
4. **דטרמיניזם והיפוך-תוכן:** כל שלב ניתן ל-hash ולהשוואה; אף מילה לא אובדת ואף קולוקציה לא נשברת.

## 5.2 שלב A (ה־PR הזה) — מטריצת אילוצים אחודה + תיקוני שורש

### 5.2.1 מודול חדש: `layout/constraint-matrix.js`

מקור האמת היחיד לפרמטרי המדיניות המספריים שהיום מפוזרים כ-literals:

```
ESCORT_MIN_LINES = 2        // נצרך: dp-planner (בדיקה), protections-matrix (זיהוי),
                           //         balancing.cleanBoundary (גבול פיצול)
WIDOW_ORPHAN_MIN = 2       // נצרך: findSplit, cleanBoundary, protections run-count
CAPACITY_EPS = 0.5         // סבילות השוואת קיבולת (קיים ב-dp-planner)
orphanAtDestination(lines, cut)  // פרדיקט: lines.length - cut < WIDOW_ORPHAN_MIN
escortStackHeight(headLines, escortLines, gapOf)  // גובה מחסנית אמיתי ב-yPx
```

כל צרכן קיים עובר לקרוא משם. אין שינוי ערכים — רק סילוק הכפילוּת (המספר `2` מופיע היום ב-5 קבצים שונים בלי קישור ביניהם).

### 5.2.2 תיקוני שורש כירורגיים (כולם מתועדים כ-FX מפרק 4)

| תיקון | בא ממצא | שינוי |
|---|---|---|
| `ensureRoomFor(stackPx)` — קיבולת ב-yPx אמיתיים | FX-5, FX-1(א) | החלפת `ensureRoom(lines)` המודד ביחידות lineH; הסטאק כולל את gap הכניסה |
| הצבה מכוונת-ליווי (escort-directed placement) | FX-1(ב) | תוצאת הבדיקה (מספר הטור) מועברת ל-`pushLines` כ-`startCol`; נעילת טור עד השלמת 2 שורות ליווי |
| סדר התחייבות הערות | FX-3 | `reserveNotes` רץ אחרי הכרעת עמוד היעד של הפסקה (כולל uncommit+retry חד-פעמי); עקרון F-17 (תקציב לפני שורות הפסקה) נשמר — על העמוד הנכון |
| אבחון נסיגה הוגן | FX-2 | repairFns מסומנות `mutates:false` כשהן ledger-only; חתימה חוזרת בלי מוטציה ⇒ `retreat-static` + `correction-blocked` (לא "תנודה"); תנודה אמיתית נשמרת כמוותר |
| עונש strict חי | FX-4 | `blk.lines.length - cut < WIDOW_ORPHAN_MIN` במקום `cut < 2` הבלתי-ספיק |
| `cleanBoundary` מודע-ליווי | סתירת פרק 4 | פיצול המשאיר כותרת עם <ESCORT_MIN_LINES שורות אחריה בטור ← לא "נקי" (עדיפות לקסיקוגרפית קיימת) |

### 5.2.3 מה לא נגענו בו — ולמה (זהירות ללא פשרות)

- **רינדור ה-gap (FX-6):** מימוש `grid-block-gap-pct` כגובה נצבר היה משנה hash פריסה של כל מסמך רב-בלוקי ושובר 47 חבילות בדיקה ירוקות. התנהגות ה-gap תועדה בדוח כהחלטה ארכיטקטונית פתוחה לשלב B (מימוש מלא כולל רינדור) או C (ביטול ההגדרה כמתה). הפרוב FX-6 משוכפל כרגרסיה-תיעוד בבדיקות.
- **הכפלת usedHeight בשלושה מימושים:** איחודם תחת אחד דורש הכרעת סמנטיקת aqStretch בזמן ה-DP (היום: מוטציה פוסט-הוקית). נדחה לשלב B במסגרת הקו-אופטימיזציה.
- **שלוש פסיעות האיזון:** מתכננות להתמזג לפונקציית יעד אחת בשלב B; בשלב A רק נאטם הסתירה (cleanBoundary מודע-ליווי).

## 5.3 שלב B — קו-אופטימיזציה: חיסול לולאת הנסיגה מן השורש

### 5.3.1 הבעיה כבעיית אופטימיזציה אחת

היום: גוף והערות נפתרים בשלבים נפרדים עם תיקוני ביניים. היעד: **בעיית תכנון עמוד אחת** — מצב = (עמוד, טור, שורות שהוצבו, הערות שהוצבו); מעבר = הצבת שורה/הערה; פונקציית עלות:

```
cost(page) = λ₁·|H(col0) − H(col1)|            // איזון
           + λ₂·underfill(page)                 // מילוי
           + λ₃·violations(page)                // ליווי/יתום/אלמנה (עונשים סופיים;
                                                //   ∞ רק לחריגת קיבולת — HARD)
           + λ₄·fnBudgetWaste(page)             // מרווח מת במרזב
subject to: Σheights + fnReserved ≤ CAP        // קיבולת קשה (כולל פס חוצה-טורים)
            escort: heading ⇒ ≥2 שורות באותו טור   // קשה
            widow/orphan ⇒ ≥2/≥2 בכל גבול פיצול     // קשה
            קולוקציה: עוגן הסמן ותחילת ההערה באותו עמוד // קשה
            סדר קריאה: seq מונוטוני בטור/עמוד       // קשה (מבני)
```

מימוש מעשי: DP על "נקודות עצירה חוקיות" (breakpoints) — כמו Knuth-Plass בממד האנכי: לכל מועמד שבירת עמוד (סוף בלוק/שורה) מחושבת עלות מלאה **כולל תקציב ההערות של העמוד שנסגר** — ההערה מחויבת לעמוד שבו העוגן, באותה פסיעת DP. אין צורך בנסיגה: העלות הייתה ידועה לפני ההחלטה.

### 5.3.2 פסאודו-קוד פרודקשן — ליבת המתכנן המאוחד

```
function planDocument(blocks, CM /*constraint-matrix*/, geo, notes):
  # עמוד-רץ: state = { pages[], cur, seq }
  # אינווריאנט I1: כל שורה מוצבת פעם אחת; I2: seq מונוטוני; I3: קיבולת אף פעם
  # לא נפרצת (hard reject לפני הצבה, לא אחריה); I4: כל הערה מחויבת לעמוד
  # העוגן שלה באותה פסיעה.

  for blk in blocks:                         # סדר מסמך
    head = blk.lines[0]
    target = resolveTarget(blk, state)       # עמוד+טור יעד לפי CM (כולל escort,
                                             # spanning, force-break, side-note)
    if target == NEW_PAGE:
      state.flush()                          # סוגר עמוד: איזון פנימי אחד (optimalSplit
                                             # מודע-ליווי) — היחיד במערכת
      state.newPage(blk.templateOf())
    # --- התחייבות הערות בפסיעת העוגן (F-17 בעמוד הנכון) ---
    if blk.hasNotes:
      committed = state.reserveNotes(blk)    # push + budget, מחזיר snapshot
      if not state.firstLineFits(blk, target):
        state.uncommitNotes(committed)       # שחזור דטרמיניסטי מלא
        state.flush(); state.newPage(...)
        committed = state.reserveNotes(blk)  # פעם אחת בלבד; מצב פתולוגי (הערה
        if not state.firstLineFits(blk):     #   ≥ עמוד) — מתועד, לא שקט
          state.ledger.report('fn-degenerate', blk, why)
    # --- הצבה מכוונת: הטור שאומת נצרך כ-startCol ---
    state.pushLines(blk.lines, { startCol: target.col,
                                 escort: CM.escortOf(blk) })   # נעילה עד 2 שורות
  state.flush()
  return state.pages        # אין לולאת נסיגה. אין "תיקון בדיעבד". יש הערכה
                            # אחת (audit-only) שמדווחת — ולא מזיזה דבר.
```

הערכת ההגנות (`runProtections`) נשארת — **כאודיט טהור**: היא כבר לא מזיזה שורות לעולם, ולכן גם לא יכולה ליצור תנודה. כל מה שהיא מוצאת הוא פשרה מתועדת של אילוץ בלתי-ספיק (למשל בלוק ענק) — ולא תוצר של כשל סדר-פעולות.

## 5.4 שלב B (המשך) — הטלה גאומטרית חד-מקורית (RenderModel)

כלל: **מי שלא מודד — לא מזיז.** השכבות:

1. **מודל הפריסה (CP3)** — שורות + heightPx + aqStretch (מחושב בזמן ההחלטה, לא אחריה) + קולוקציית הערות.
2. **`RenderModel` (CP5, מורחב)** — `geometry-projector.projectDocument` הופך ליצרן היחיד של מיקומים מוחלטיים: `projectLine` כבר מחשב x/y/baseline/gapW לכל מילה. ההרחבה: (א) עטיפת ההערות עוברת להיות **פונקציה אחת** הנצרכת גם לאומדן התקציב וגם לפלט (ניפוץ הכפילות noteHeight↔wrapNoteTokens); (ב) LPT אחד (מ-footnote-budget) מיוצא ונצרך על ידי הפרויקטור.
3. **רנדררים** — `pdf-writer` כבר צרכן-בובה (אומת: ש' 407-452 רק פולט x/baselineY מהמודל). `dom-renderer` ממשיך לזרום-CSS לתצוגה החיה אך **צורך את אותם מספרים** (lineHeight מהמודל — כבר קיים, S6.0/R4-C1); יעד ההשלמה: גם מיקומי מילים מפורשים בעת הצורך (export-HTML מוחלט).

## 5.5 טבלת מיפוי קבצים — מחיקה, איחוד, חוזה חדש

| קובץ | החלטה | יעד / חוזה חדש |
|---|---|---|
| `layout/retreat-loop.js` | **מחיקה בשלב B** | מוחלף על ידי audit-only pass (הערכה ללא מוטציה). בשלב A: תוקן אבחונית |
| `layout/candidate-generator.js` | **איחוד בשלב B** | נבלע ב-DP breakpoints של המתכנן המאוחד (FX-4 מתוקן בשלב A) |
| `layout/headings-escort.js` | נשאר | חוזה צר: mode→flags בלבד (כבר כך) |
| `layout/footnote-budget.js` | נשאר, מתרחב | מקור האמת לעטיפת הערה (פונקציית wrap יחידה) + LPT מיוצא |
| `layout/balancing.js` | **צמצום בשלב B** | `optimalSplit` נשאר (אלגוריתם מוכח); balancePage/balancePageSafe נבלעות ב-flush אחד; `alignColumnBottoms`+`autoQualityPass` מתמזגות ל"מדיניות יישור תחתית" אחת שרצה **לפני** חתימת hash |
| `layout/protections-matrix.js` | נשאר | הופך audit-only (הסרת ציפיית תיקון) |
| `layout/ordering.js` | מחיקה בשלב B | מיותר כשאין הזזות בדיעבד |
| `layout/legacy-imud-flow.js` | **חיתוך בשלב C** | אחרי capability-parity מלא (ענף S75 body-first כבר הושווה מול המודרני); עד אז — קפוא לשינויים |
| `output/legacy-projector.js` | חיתוך בשלב C | עם המנוע המורשת |
| `output/line-font.js` | נשאר | כבר שכבת פענוח צרה |
| `output/geometry-projector.js` | נשאר, מתרחב | הופך RenderModel — מקור המיקומים היחיד |
| `output/dom-renderer.js` | נשאר | מסיר את `renderLegacyPage` בשלב C; צורך מספרים מה-RenderModel |
| `output/pdf-writer.js` | נשאר | כבר צרכן-בובה ✓ |
| `typography/kp-linebreak.js` | נשאר, מתרחב בשלב B | הזרקת עונשי ∞ ליחידות סמן (סגירת באג P-1) ולכפית ליווי ברמת שורה |
| `typography/protectors.js` | צמצום | `fixDropWordInColumns` נמחק כשהשבירה מונעת נפילה by-construction |
| **חדש:** `layout/constraint-matrix.js` | נוסף בשלב A | מקור האמת המספרי לאילוצי מדיניות |

## 5.6 אמות מידה לקבלה (שלב A — ה-PR הזה) — תוצאות מדודות

על שני קורפוסי האמת (long: 1,038→1,041 עמודים; very_long: 1,335→1,337):

| מדד | לפני | אחרי |
|---|---|---|
| הפרדות סמן/הערה בכיוון הפסול (long) | 6 | **1** |
| הפרדות סמן/הערה בכיוון הפסול (very_long) | 36 | **1** |
| heading-escort נצחיות (very_long) | 3 | **0** |
| containment (very_long) | 69 | **52** |
| דיווחי שווא widow/orphan | 0 | 0 (לא נפגע) |
| הפרות אמיתיות orphan-bottom (very_long) | 29 | 27 (נשמרו) |
| contentPreserved | true | true |
| hash קורפוס קנוני (80f9ed6c) | — | **זהה** (לא השתנה) |

1. 47 חבילות הבדיקה הקיימות נשארות ירוקות (למעט עדכון מפורש אחד: בדיקת ה"oscillation" ב-s5-s6 מקבלת גרסה אמיתית נוספת — תנודה עם מוטציה אמיתית).
2. בדיקות רגרסיה חדשות (`tests/layout/forensic-fixes.test.js`) מכסות את FX-1..FX-6: כותרת לעולם לא נשארת עם <2 שורות בטור (בגבולות הקיבולת), סמן והערה באותו עמוד, אין עמוד ריק פנטום, strict משנה ניקוד, אבחון סטטי לא מתויג תנודה.
3. דטרמיניזם: `test:determinism` עובר; `contentPreserved` נשאר true בקורפוס הקנוני.

---

# נספח א' — תמליל אימות ניסויי (פרובים)

```
FX-1 (איזון מנוטרל; 39×24.2px מילוי, כותרת 37px, 4 שורות ליווי):
  pages: [[41,3]]
  escort violations: [{"page":0,"col":0,"after":1,"words":["H"]}]
  retreat: {converged:false, iterations:1,
            compromise:"rollback-compromise@loop@iter1#1",
            persisted:["heading-escort@h1@p0c0#1"]}

FX-2 (repairFn של widow-bottom = no-op, כב-dp-planner; הפרה קבועה):
  result: {converged:false, iterations:2, compromise:"i2"}
  oscillation event fired on STATIC violation: true
    {iteration:2, signature:"widow-bottom@page#0c0"}

FX-3 (82 בלוקי מילוי; פסקת 2 שורות עם הערה):
  pages: [{i:0, marker:false, fns:1}, {i:1, marker:true, fns:0}]
  markerPage=1 fnPage=0 => SEPARATED: true

FX-4 (generateCandidates, 4 שורות, cap 100):
  strict vs normal scores identical (dead penalty): true  [[2,0],[3,40]]

FX-5 (בלוק 40×25px = 1005 ≤ cap 1026.52):
  pages: [[0,0],[20,20]]   PHANTOM EMPTY PAGE: true

FX-6 (קריאת קוד + מדידת פער): blockGapPx נבלע ב-pendingGap (שער כניסה בלבד);
  usedHeight/optimalSplit/הקרנה אינם רואים אותו — הוכח בפער החישוב
  שאיפשר את FX-1 (החסימה "נכנסה" ל-85.5px פנויים אף ש-94.9 נדרשו).
```

## נספח ב' — עץ התלויות שנותח (לעיון חוזר)

```
core/pipeline.js ─┬─ layout/legacy-imud-flow.js (3,720) ─┬─ output/legacy-projector.js
                  │                                       └─ dom-renderer:renderLegacyPage
                  └─ מסלול מודרני:
                     layout/dp-planner.js ─┬─ protections-matrix.js ─┐
                     ├─ retreat-loop.js ────┘                        │ (assess)
                     ├─ candidate-generator.js (fallback בלבד)       │
                     ├─ balancing.js: optimalSplit ◄─── flushPage,    │
                     │        balancePageSafe, balancePage (פעמיים-שלוש)
                     ├─ footnote-budget.js: noteHeight + LPT          │
                     └─ column-flow.js: colCapacityOf (SSOT מ-2025)   │
                     typography/kp-linebreak.js ── protectors.js      │
                     output/geometry-projector.js ─┬─ pdf-writer (צרכן-בובה ✓)
                     │        wrapNoteTokens + LPT-2 (כפילויות)      └─ dom-renderer (CSS flow)
                     └─ line-font.js (פענוח בלבד)
```

**סוף הדוח.**
