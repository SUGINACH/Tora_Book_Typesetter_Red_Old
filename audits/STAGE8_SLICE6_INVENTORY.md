# שלב 8 פרוסה 6 — מלאי קוד, parity ופישוט (17.11)

**ענף:** `stage8e/pagemodel-html` (בהמשך לפרוסאות 4–5) · **מקור:** הוראת ההמשך §5.
**ארטיפקטים:** `audits/perf_slice6/perf-slice6.json` · בדיקות `s8g-parity-simplify` (8).

## 1. מלאי קוד — סיווג לכל מודול יעד (§5)

### `output/pagemodel-dom-renderer.js` (חדש — פרוסה 3)
| פונקציה | סיווג |
|---|---|
| `renderModelPage` | **ציור בלבד** — קורא x/y/w/h/baseline/זהויות מהמודל; אריזת-תצוגה (מחלקות CSS, כרום) בלבד |
| `renderModelLine` | **ציור בלבד** — תיבת שורה + מילים ממוקמות-מוחלט מהתכנון |
| `renderModelDecoration` | **ציור בלבד** — דיו (svg/rule/rect/image) מהמודל; פתרון נכס = טעינה לציור |
| מדידה/עימוד/materialization | **אפס** — מוכח: patch-שזורק על MeasureAPI (s8d) + סטטית (s8g): אין require ל-measure-api, אין breakLines/wrapText |
| צרכנים | preview-tab (unified), exportHtmlFromModel |

### `output/html-export.js`
| פונקציה | סיווג |
|---|---|
| `buildStandaloneHtml` | **אריזה** — עטיפת HTML עצמאי (CSS/עמוד/@page) |
| `assertOfflineSafe` | **אריזה** — guard עצמאות (אין http) |
| מדידה/עימוד | **אפס** (מוכח סטטית ב-s8g) |

### `output/pdf-writer.js`
| פונקציה | סיווג |
|---|---|
| `writePdf`/`PdfBuilder` | **הפקה ואריזה** — אובייקטי PDF, הטמעה, מצווץ, ToUnicode, outlines |
| `emitWord`/`emitLines` | **ציור** — מיקומי מילים מהקלט (כעת: מהמודל דרך exportPdfFromModel) |
| `visualOrderRtl`/`cidHex`/`buildToUnicode` | **אריזה** — קידוד גליפים |
| מדידה/עימוד | **אפס** (מוכח סטטית; היה נתיב עם MeasureAPI ב-renderFolio של ה-DOM — לא בכותב) |

### `output/geometry-projector.js`
**Facade מעבר מתועד** (שלב 8 §4.1): מעביר ל-materialize היחיד; מטביע חותמות רק לקלט סינתטי בלי חותמות (compat מתועד). צרכנים: נתיב ה-PDF הישן (legacy בלבד, עד שלב 9) + בדיקות. **אין מנוע שני** — כל החישוב ב-core/materialize.

### `output/legacy-projector.js`
**מורשת מפורשת** — הקרנת עמודי IMUD (תצוגה=ייצוא לפרופיל legacy). צרכן: exportPdf נתיב legacy בלבד. **יוסר בשלב 9** לאחר parity.

### `output/export-api.js`
| פונקציה | סיווג |
|---|---|
| `exportHtmlFromModel` (חדש) | **אריזה** — הקרנת המודל דרך אותו מקרין DOM + עטיפה; אפס עימוד (מוכח שלילית) |
| `exportPdfFromModel` (חדש) | **אריזה** — רישום גופן, מלאי תווים מהטקסט המצויר, מצווץ, כתיבה; התאמת עמודי מודל→כותב = טהורה |
| `exportHtml` | legacy — רינדור מתוצאה (עד שלב 9) |
| `exportPdf` | legacy — **עימוד שני + פרויקציה** (עד שלב 9; בפרופיל המאוחד אינו נקרא — ה-Worker מפנה ל-FromModel) |
| `exportProjectZip`/`importProjectZip` | אריזה |

### `output/dom-renderer.js`
| אזור | סיווג |
|---|---|
| `renderLegacyPage` + מסלולי legacy | **מורשת מפורשת** (עד שלב 9) |
| `renderPage` (DP) | **ציור** — אך עם מדידה אחת שנותרה: `renderFolio` בונה MeasureAPI לגיליון (מקור מתועד) — **פער לסגירה בשלב 9** (המודל כבר נושא את גיאומטריית הגיליון; המקרין הטהור קורא אותה) |
| `renderSpanningBand`/`renderDecorations`/... | ציור |
| צרכנים | preview-tab (legacy), exportHtml (legacy), בדיקות רבות |

## 2. הוכחות (§5)

1. **PageModel מקור הגיאומטריה היחיד (unified):** DOM (renderModelPage) + HTML (אותו מקרין) + PDF (אותו מודל; `info.geometryHash == model.geometryHash` — מוכח ב-Worker אמיתי בדפדפן).
2. **המקרינים אינם מודדים/מעמדים:** סטטית (s8g: אפס תלות ב-measure-api/pipeline בשלושת מודולי היעד) + שלילית (patch-שזורק; s8d ל-DOM, s8e/s8f/s8g לייצוא).
3. **אין עימוד נוסף בייצוא (unified):** HTML+PDF מהמודל — 0 קריאות typeset (מוכח). ה-Worker מפנה אוטומטית לנתיב המודל לפי result.legacyProfile.
4. **אין חישוב גיאומטרי כפול ללא הצדקה:** הפרויקציה אחת (materialize) → מודל → שלושה יעדים. החריג האחד המתועד: renderFolio הישן (legacy בלבד; המקרין הטהור אינו מודד).
5. **כל סוג פריט בכל היעדים:** parity תלת-יעדי (s8g): עמודים DOM==HTML==PDF==מודל; שורות DOM==HTML; מילים HTML==מודל (כולל מרזב); חלוץ טקסט PDF מכסה >85–90% ממילות המודל (RTL-visual).
6. **דטרמיניזם:** HTML ו-PDF ביט-לביט בין הרצות (s8g); determinism המנוע OK; cross-check PASS.
7. **ביצועים (ראה §3) — ללא השמטת תוכן:** parity המילים מלא (359,584=359,584 ב-very_long).

## 3. ביצועים — לפני/אחרי (audits/perf_slice6/perf-slice6.json)

| מדד | short (5 עמ') | medium/קנוני (36 עמ') | **very_long (1,110 עמ')** |
|---|---|---|---|
| typeset | 46ms | 260ms | 15.7s |
| **גודל PageModel** | 11.4KB (2.3KB/ע') | 551KB (15.7KB/ע') | **61.2MB (56.5KB/ע')** |
| DOM render (כל העמודים) | 2.1ms | 6.1ms | **481ms** |
| HTML מהמודל | 1.8ms | 22.8ms | 2.0s |
| **PDF מהמודל** | 8.8ms | 26.1ms | **2.19s** |
| PDF נתיב ישן (עימוד שני) | 12.9ms | 234.8ms | **43.2s** |
| **חיסכון PDF** | 31% | 89% | **94.9%** |
| parity מילים מודל==HTML | 30=30 ✓ | 3,267=3,267 ✓ | **359,584=359,584 ✓** |

**מסקנות:** הסרת העימוד השני חסכה ~95% מזמן ייצוא ה-PDF בספר שלם (43s→2.2s) — מהשמטת עבודה בלבד, לא תוכן (parity מלא). גודל המודל (56KB/ע') וזמן ה-HTML ב-very_long מתועדים כמדדים לאופטימיזציה עתידית (דחיסת מילים/שדות נדירים) — לא נפתח בשלב 8 (אין דרישת ביצועים שנכשלה; ההעברה ל-Worker עובדת ומאומתת).

## 4. נותר לשלב 9
- הסרת legacy: legacyTypeset, legacy-projector, renderLegacyPage, נתיבי exportHtml/exportPdf הישנים, renderFolio המודד.
- Shadow comparison מלא legacy↔unified לפני ההסרה (§6.2 בהוראה).
- החלפת ברירת המחדל רק לאחר סגירת כל שערי ה-parity.
