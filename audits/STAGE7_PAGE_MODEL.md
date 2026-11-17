# STAGE7_PAGE_MODEL — PageModel יחיד, סופי ו-immutable (שלב 7)

> **תוכנית:** `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md` §§7.1–7.3 · **הוראת ביצוע:** חלק ד׳ (§§18–24).
> **ענף:** `stage7/page-model` מעל main `259e5e8` (שלב 6 פרוסה 2 — PR #28).
> **מימוש:** `core/page-model.js` (חדש — סכמה + בונה + אימות + הקפאה + hashes) · `core/pipeline.js` (בנייה בסוף הזרימה + חשיפה בתוצאה + ledger) · `assets/asset-resolver.js` (‏`resolvedAssetIds` — API קריאה לאינטגריטי נכסים) · `core/events.js` (שלב `page-model` בסדר השלבים החוקיים).
> **בדיקות:** `s7-page-model` (16 — חדש).

---

## 1. העיקרון

**DocumentModel → Measured Items → LineModel → Planner → PagePlan → PageModel → מקרינים טהורים.**

עד שלב 6 ההחלטות התקבלו ב-Planner אך המקרינים חישבו את הגיאומטריה הסופית בעצמם (הקרנת שורות/מילים בזמן ייצוא). בשלב זה נבנה **מודל עמוד סופי יחיד** — כל ההחלטות הסמנטיות והגיאומטריות של העימוד, מוקרנות פעם אחת, מאומתות וקפואות. מכאן ואילך אין החלטות עימוד חדשות: המקרינים (שלב 8) יקראו בלבד.

## 2. מה נבנה

### 2.1 הסכמה — `pagemodel-v1` (§19)

```
PageModel = {
  schema, document { contentHashIn, tokensCount, plannedPages },
  pages: [PageModelPage], meta { resources { referenced, unresolved } },
  geometryHash, contentHash                       // §7.1-8/9 — דטרמיניסטיים, נפרדים
}
PageModelPage = {
  index, type, isRecto, pageNumber, folioDisplay,
  geometry { width, height, contentBox, columns[], gutter, spanOffset },
  lines: [LinePlacement],                         // פס (spanning) → טורים בסדר קריאה → מבני
  footnotes: [NotePlacement],                     // מרזב + עמודי-סיון (עם חותמות)
  sideNotes: [AnchorPlacement],                   // הערות-צד + תיבות מידע (boxChrome)
  decorations[], header, folio, reservations[],
}
LinePlacement = {
  id (ייחודי), sourceTokenId, part, seq,          // זהות מקור (§21-2)
  kind, level, isLast, align, sizePt,
  x, y, w, h, baselineY, ascentPx, descentPx,     // גיאומטריה סופית
  gapBeforePx, aqStretch,                          // מהחותמות של התוכנית (FX-6/EXT-20)
  words: [{text, x, w, sizePt?, fontKey?, baselineY?, color?}],  // fragments ממוקמים — פעם אחת (§7.1-5)
  area: spanning|column|endnotes|structural, projected
}
NotePlacement = { noteId, kind, sourceId, anchorId, marker, text, continuationOf,
  wordRange, lineH, heightPx, linesCount, stampValid, x, y, w, words[] }
```

הבחנת השדות (§19): מידע סמנטי (זהות/עוגן/סוג) · מדדים (חותמות) · החלטות placement (מיקומים סופיים) · הוראות projection (words ממוקמים). אין שכפול: כל עובדה חיה במקום אחד; ההפניות בזהות מקור.

### 2.2 הבונה — `buildPageModel` (§20)

- **מקבל את תוצר התכנון** (העמודים הסופיים של ה-pipeline — אחרי DP, נסיגות, שערים/TOC, איזון, AQ, הערות, עיטורים, ריהוט ומספור) ומפיק את המודל.
- **מקרין fragments פעם אחת** (§7.1-5) דרך מנוע ההקרנה הקיים (`projectDocument` — מקור אחד ל-PDF ולמודל): מיקומי המילים נקבעים כאן ואינם מחושבים שוב. **אין החלטות עימוד חדשות** — מיקומים/גבהים/פערים/מתיחה נצרכים מהחותמות של התוכנית כמו שהן (מוכח: השוואת PagePlan⟷PageModel מדויקת, וה-layoutHash של התוכנית אינו מושפע).
- **מאמת, מדווח ומקפיא:** כיסוי מלא, אפס כפילויות, שימור עוגנים, גבולות, סדר קריאה, הזמנות, נכסים — ואז `deepFreeze` (המודל כולו, בכל עומק).
- **חשיפה:** `result.pageModel` + `result.pageModelValidation`; אירוע `page-model-built` (שלב חוקי חדש ב-EventLog); הפרות → ledger (`page-model-invalid`). המודל **אינו עובר בסריאליזציית ה-Worker** (ui-result-v1) — ה-UI אינו צריך אותו עד שלב 8; הייצוא והבדיקות צורכים ישירות.

### 2.3 האימות — `validatePageModel` (§21)

| # | אינווריאנט | קוד הפרה |
|---|---|---|
| 1 | כל שורת תוכנית מיוצגת (token+part); כמות שורות תואמת (טורים+פסים) | `planned-line-missing`, `line-count-mismatch` |
| 2 | מזהה שורה ייחודי | `duplicate-line-id` |
| 3 | זהות מקור לכל fragment; מקור מוכר (שורות מבניות — שערים/TOC/כותרת-עמוד-הערות — מסומנות ופטורות מטוקן-גוף) | `line-without-source`, `line-unknown-token` |
| 4 | אין placement מחוץ לתיבת התוכן (סובלנות דיו 1.5px) | `line-outside-content-box` |
| 5 | סדר קריאה: y מונוטוני בכל טור | `reading-order-break` |
| 6 | פערים: gapBeforePx ≥ 0 (חוזה FX-6) | `negative-gap` |
| 7 | כל הערה מקושרת לעוגן מוכר; חותמה תקינה; אין marker יתום | `note-anchor-orphan`, `note-stamp-invalid` |
| 8 | פריטי עוגן (הערות-צד/תיבות): זהות+עוגן+חותמה | `anchor-item-orphan`, `anchor-item-stamp-invalid` |
| 9 | הזמנות: המודל 1:1 מול התוכנית | `reservations-mismatch` |
| 10 | נכסים: כל הפניה נפתרה או מדווחת (`resolvedAssetIds` של ה-resolver) | `resources-unresolved` |
| 11 | סכמה מגורסת; hashes קיימים | `bad-schema` |

הדוח (`checks`/`violations`/`summary`) **בר-השוואה בין ריצות** — חלק מהוכחת הדטרמיניזם.

### 2.4 immutability ודטרמיניזם (§7.1-8/9/12)

- `deepFreeze` רקורסיבי — מוטציה בכל עומק (שורה/מילה/הערה/עמוד/מערך/hash) זורקת TypeError; מוכח בבדיקה לכל רמה.
- `geometryHash` (מיקומים וגדלים בלבד) נפרד מ-`contentHash` (טקסט השורות בסדר הקריאה + הערות) — גיאומטריה אינה תחליף לתוכן (§7.1-9). שניהם יציבים ביט-לביט בין ריצות זהות (מוכח).

## 3. ראיות

| שער | תוצאה |
|---|---|
| `npm test` | **1146/1146 · 0 נכשלו** (exit 0; 67 קבצי סוויטה) — כולל **s7-page-model (16 חדשות)** |
| מסמך עשיר (כל סוגי הפריטים) | מודל נבנה; אפס הפרות; כל סוגי העמודים (שערים/TOC/פתיחה/פרק/רגיל) וכל פריטי העמוד (מרזב/עוגן/סיום/תיבות/גיליון/כותרת) מיוצגים |
| **very_long (1050 עמודים)** | מודל מלא: **68,844 שורות · 342,284 מילים ממוקמות · 131 הערות · 427 פריטי עוגן — 344,639 בדיקות, אפס הפרות** (16.1s לכל העימוד כולל המודל — תקורת ~6%) |
| immutability עמוק | מוטציה בכל רמה זורקת (7 רמות נבדקו) |
| דטרמיניזם | geometryHash/contentHash/דוח-אימות זהים ביט-לביט בין ריצות; `test:determinism` OK |
| PagePlan⟷PageModel | כל החלטה נשמרת מדויק: רוחב/טורים/הזמנות/הצבות עוגן/גבהים-פערים-מתיחה — ערכים גולמיים, אפס עיגול |
| שחזור גיאומטריה | מיקומי המודל = פלט ההקרנה (x/y/w/מילים) — אפס סטייה (מקור אחד) |
| שימור תוכן | מילות השורות במודל = מילות התוכנית בסדר הקריאה (מלא); RTL — המילה הראשונה בקריאה ימנית ביותר |
| שלילה (הזרקת פגמים) | שכפול/יתום/גבולות/מקור-לא-מוכר/עוגן-יתום/הזמנה — כל פגם מדווח בקודו |
| נייטרליות פריסה | הבונה קורא בלבד: layoutHash התוכנית נשמר; cross-check PASS (canonical `f6f32c40` · very_long `a36b3637` · legacy `legacy-a8bdd`) |

## 4. גבולות (מפורשים — מה נותר)

| נושא | מצב |
|---|---|
| המקרינים צורכים את ה-PageModel | **שלב 8** — כרגע המודל נבנה ומאומת בכל ריצה, וה-DOM/PDF ממשיכים להקרין מהתוכנית דרך אותם מנועים (אותן תוצאות, כמוכח בפאריטי); ההחלפה לקריאה-בלבד היא תוכן שלב 8 |
| תמונות במודל | הפניות נכסים נבדקות (אינטגריטי §21-10); ייצוג גיאומטרי מלא של תמונות float/block — עם ההחלפה של שלב 8 |
| legacy (imud) | מחוץ לתחום המודל עד שלב 9 (כמתוכנן) — ה-PageModel נבנה במסלוב ה-DP |
| מנגנון ההזמנות הגנרי | מחובר (column-flow צורה, page-items מזרים); אף פריט מוצר נוכחי לא משתמש בו עדיין — תקציב המרזב זורם דרך fnReservedHeightPx; המודל משקף נאמנה את שניהם |

**שער §7.3:** כל פריטי המסמך והעמוד מיוצגים במודל הסופי (מוכח על very_long — 344,639 בדיקות, אפס הפרות), וכל צרכן עתידי יכול להסתמך עליו ללא גישה להחלטות העימוד — המימוש המלא של השער ייסגר סופית עם החלפת המקרינים בשלב 8.
