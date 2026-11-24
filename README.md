# Tora Book Typesetter — RED Old (ריפו גיבוי המנוע הישן)

**מנוע עימוד תורני (RTL, עברית) — המנוע הישן בלבד: הפורט הנאמן של מנוע העימוד המקורי (פרופיל IMUD).**

ריפו זה הוא **גיבוי שימור** של המנוע הישן, שנחתך מתוך הריפו המרכזי
[Tora_Book_Typesetter_Red_Work_2](https://github.com/SUGINACH/Tora_Book_Typesetter_Red_Work_2)
בנקודת ה-HEAD של ענף העבודה מיום 24.11.2026 — לאחר מחיקת כל חלקי
המנוע החדש (המאוחד/DP) ועריכת החלקים המשותפים לשניהם.

**מה יש כאן:**
- המנוע הישן המלא — `red-build/src/engine/layout/legacy-imud-flow.js` —
  הפורט הנאמן של מנוע המקור (`audit/IMUD_TORANI/typesetter.js` של התוכנה
  המקורית), הפועל עם הגדרות המקור (`default_settings.json`) דרך
  `importImudSettings` → `layout-profile='imud'`.
- ה-UI המלא (עורך/הגדרות/בדיקה/תצוגה) עם המנוע ב-Web Worker —
  מריץ אך ורק את המנוע הישן.
- נכסי המקור המלאים: 452 גופני TTF, עיצובי שערים/עיטורים/מפרידים,
  ברירות המחדל המקוריות (264 מפתחות) — `red-build/ui/assets/imud/`.
- אמת מידה לגיאומטריה: `audits/layout-reference.json` — החילוץ
  המתמטי של פלט הגרסה הישנה מקובצי ה-PDF שהעלה המשתמש, וארבע דוגמאות
  PDF מקוריות מהגרסה הישנה (`audits/דוגמא מגרסא ישנה*.pdf`).
- מנעול השוואה: `npm test` (27 סוויטות) + `node tools/cross-check.js`
  (נעילת very_long: `legacy-28f52` — 695 עמודים) + workflow
  `corpus-invariants` ב-CI.

**מה אין כאן:** המנוע החדש (המאוחד — dp-planner, PageModel,
materialize, המקרינים המאוחדים), בדיקותיו, כלי ה-parity שלו, ותיעוד
המעבר (CUTOVER/MIGRATION). כל אלה ממשיכים להתפתח בריפו המרכזי.

## הרצה
```bash
cd red-build
npm test              # 27 סוויטות של המנוע הישן (אפס תלויות ריצה)
npm run test:determinism

# מהשורש:
node tools/build-worker-bundle.js   # בניית חבילות הדפדפן (worker + app)
node tools/cross-check.js           # הצלבה: קורפוס very_long מול נעילת legacy-28f52
node tools/layout-parity/run-ours.js # הרצת המנוע הישן + מודל + PDF
```

האפליקציה החיה: פתחו את `red-build/ui/index.html` בדפדפן (מקומי
לחלוטין, אין בקשות רשת). ייצוא PDF/ZIP ב-Worker; ייצוא HTML עצמאי.

## נקודת הכרעה יחידה
`red-build/src/engine/core/pipeline.js` — `typeset()` מפנה ל-`legacyTypeset`
כאשר ההגדרות מסומנות פרופיל IMUD; כל קלט אחר מקבל **שגיאה מפורשת**
(אין נפילה שקטה ואין מנוע חלופי בריפו זה).

## מבנה
```
red-build/src/engine/   — המנוע הישן + המודולים המשותפים שנותרו
                           (typography/measure, decoration, output, import, notes)
red-build/src/ui/       — מעטפת ה-UI (Worker, פאנלים, תצוגה)
red-build/ui/           — האפליקציה הבנויה (bundles + נכסי IMUD)
red-build/tests/        — 27 סוויטות: מורשת, ייבוא הגדרות, ייצוא, רגרסיות משתמש
tools/                  — בניית חבילות, cross-check, layout-parity (נתיב מורשת), כלי גופנים
audits/                 — layout-reference.json + קורפוסי בדיקה + PDF-י ייחוס
spec/                   — מפרט האם ומסמכי הדרישות
DECISIONS.md            — יומן ההחלטות (מפתח לאזכורי D-*/S* בקוד; היסטוריה משותפת)
WORKLOG.md              — יומן העבודה (היסטוריה)
```

## היסטוריה ופרובננס
- מקור החיתוך: `Tora_Book_Typesetter_Red_Work_2` @ ענף
  `engine/legacy-parity-preview-20261119` (HEAD 933e6c5, 24.11.2026).
- ההיסטוריה המלאה (כולל פיתוח המנוע החדש ואיטרציות ה-parity) נשמרת
  בריפו המרכזי; כאן נשמר רק המצב הסופי של המנוע הישן.
- זהות הפלט הוכחה בזמן החיתוך: `cross-check` — very_long 695 עמודים,
  hash `legacy-28f52` — זהה ביט-לביט לנעילה בריפו המרכזי.
