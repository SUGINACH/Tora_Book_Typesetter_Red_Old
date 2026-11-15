# Baseline שלב 1 — תמונת בסיס ניתנת לשחזור

> **מסמך:** תוצר "Baseline מלא" של שלב 1 בתוכנית `spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md`.
> **Commit שממנו נמדד הכול:** `95e829d44e88f436c9397d82473cd9e2f4a698aa` (main, "docs: canonical 10-stage engine completion plan", מיזוג PR #18).
> **ענף המדידה:** `audit/stage1-engine-state-20261115` (זהה ל־main בעת המדידה — ללא שינויי קוד).
> **סביבה:** Node v24.22.2 · npm 11.19.1 · Linux x64 · poppler-utils (pdfinfo/pdftotext/pdftoppm) · PyMuPDF 1.26.7 · agent-browser 0.42.0 + Chrome 157.0.8103.50.
> **תאריך מדידה:** 15.11.2026.

## קלטים וזהויות (hashes)

| קלט | SHA-256 |
|---|---|
| `audits/very_long_test_text.txt` (3,403,990 בתים; 363,232 מילים — מסמך הבדיקה הראשי לפי D-98) | `f6c6b3aa0422fc621fb5827533770fc6fe7b170234382670690483e89cc6a1fc` |
| `red-build/ui/app.bundle.js` | `0a452307f0e341af20a006f8b4a5fc9ae74248e6d0470e474531e9a0ad7634b5` |
| `red-build/ui/engine-worker.bundle.js` | `3092907387fa7701c552128e825a726dc53cb22a4fcf1675542c863b50528631` |

הגדרות: ברירות מחדל מיובאות של המקור (`_layout-profile='imud'` + `_imudRaw`) בנתיב המוצר/הדפדפן; `getDefaultSettings()` בנתיב Node/DP. מפת המסלולים המלאה: `audits/ENGINE_RUNTIME_PATHS.md`.

## תוצאות — לפי פקודת הרצה מדויקת

| # | בדיקה | פקודה מדויקת | תוצאה | פירוט |
|---|---|---|---|---|
| 1 | בדיקות יחידה+אינטגרציה+E2E מלאות | `cd red-build && npm test` | **PASS — 849/849, 0 כישלונות, 0 דילוגים** (44 קבצי בדיקה + scan-control-triggers: 0 הפרות) | `npm-test-full.txt`; זהה ל־CI (jobs test 18/20/22 — success) |
| 2 | דטרמיניזם (קנוני) | `cd red-build && npm run test:determinism` | **PASS** — `deterministic OK 80f9ed6c82ea3855 pages: 36` | `determinism.txt` |
| 3 | דטרמיניזם + נעילות קורפוסים | `node tools/cross-check.js` | **PASS** — canonical (DP) 36 עמ' hash `80f9ed6c`; very_long (DP) **1335 עמ'** hash `77d5d5d3`; very_long (legacy) **695 עמ'** hash `legacy-287c1`; שני הבאנדלים תואמים sha256 | `cross-check-report.json` |
| 4 | אינווריאנטים C1–C12 על הקורפוס הראשי | `node tools/layout-parity/run-ours.js audits/very_long_test_text.txt audits/very-long-artifacts --determinism --html` ואח"כ `python3 tools/layout-parity/verify-corpus.py <input> <model> <pdf> <report> <html>` | **PASS — 12/12 (100%)** | דטרמיניזם כפול בתוך run-ours (hash `legacy-287c1` זהה); PDF 20,275KB; HTML 27,005KB; `corpus-report-verylong.json` |
| 5 | אודיט מתמטי מלא (דפדפן, דיו-בפועל) | `node tools/layout-audit/run-full-math.js --tag local --fixture audits/very_long_test_text.txt` | **FAIL (משוחזר)** — "רצפת הנפח נכשלה — הספר התקצר בשקט": מילים מרונדרות 353,687 < 355,967 (=0.98×363,232) | `full-math-local.txt`; זהה ל־CI run 43729705419 (job local — failure) |
| 6 | אודיט עימוד בדפדפן אמיתי (קורפוס גדול) | `LAYOUT_AUDIT_FIXTURE=... bash tools/layout-audit/run.sh` | **FAIL (משוחזר)** — 2 ממצאי high: `SIDE_NOTE_OVERLAP` בעמ' 107 (8px) ו־(2px); 699/699 עמ' נבדקו; 43,117 שורות; 25 הערות-צד בעמ' 107 | `layout-audit-report-verylong-local.json`; זהה ל־CI run 43729705321 (job layout-audit — failure) |
| 7 | אודיט עימוד — עשן (fixture קטן) | `bash tools/layout-audit/run.sh` (ברירת מחדל) | **PASS** — 10/10 עמ', 0 בעיות | בתוך הרצה של CI; לא הועתק בנפרד |
| 8 | CI GitHub Actions על `95e829d` | (push ל־main) | test(18/20/22)=**success** · corpus-invariants=**success** · layout-audit=**failure** · full-math-audit(local)=**failure** | קישורי ריצות: 43729705321, 43729705304, 43729705419 |

הערות ייחוס: ריצות ה־CI מצוינות לפי מזהה ריצה (run id) ב־GitHub Actions על אותו commit; הלוגים נבדקו דרך ה־API (ממצאי הכשל צוטטו מילה במילה בדוחות שלהלן). אין בדיקות P6/P7 במדידה זו ואין להחזירן (D-100).

## ממצאי כשל פתוחים על ה־baseline (מאומתים מחדש — לא היסטוריה בלבד)

1. **F-BL1 · full-math-audit — רצפת נפח:** 353,687 מילים מרונדרות בדפדפן מול 355,967 נדרשות (פער ~2,280 מילים, ~0.63% מתחת לרצפה; ~2.6% מתחת ל־363,232 מילות המקור). הנתיב הנבדק הוא החי (legacy בדפדפן, 699 עמ'). לעומת זאת C1 (שימור תוכן, מולטיסט מילים גוף+מרזב) עובר באותו קלט בנתיב Node — כלומר הפער ממוקד במה שמונה אודיט הדפדפן (כולל שערים/כותרות/גיליון/טקסטים נגזרים) או בפער Node↔דפדפן, ולא באובדן תוכן גוף מוכח. מחייב חקירת שורש לפני שלב 9. חומרה: גבוהה (כשל שעת CI).
2. **F-BL2 · SIDE_NOTE_OVERLAP עמ' 107:** שתי חפיפות של הערות-צד (8px ו־2px) בעמוד עם 25 הערות-צד. השערת שורש מבוססת-קוד ב־`audits/ENGINE_DUPLICATION_REGISTER.md` (סעיף הערות) — הקצאה אנכית ללא טיפול התנגשות בנתיב המורשת. חומרה: גבוהה (כשל שעת CI).
3. **F-BL3 · פער נתיבים Node↔דפדפן:** אותו קלט, אותן הגדרות מיובאות — Node/legacy מייצר 695 עמ' (hash `legacy-287c1`) והדפדפן מייצר 699 עמ'. פער מבני בין סביבות על אותו מסלול לוגי (הבדלי מדידה/גופנים זמינים). מתועד; אינו כשל שעת, אך מחייב הבלטה בשלב 3 (מדידה אחידה).
4. **F-BL4 · אנומליה תיעודית D-106/D-101:** שתי שורות כמעט-זהות ב־DECISIONS.md לאותה החלטה (יישור תחתיות טורים, 4 שיפורים). תיעודי בלבד; נרשם לצורך תיקון עתידי של הפנקס.

## חפצים (artifacts) בתיקייה זו

- `npm-test-full.txt` — הפלט המלא של `npm test` (849/849).
- `determinism.txt` — הפלט של `npm run test:determinism`.
- `cross-check-report.json` — דוח cross-check (קורפוסים מול נעילות + באנדלים).
- `corpus-report-verylong.json` — דוח C1–C12 על the very long corpus.
- `full-math-local.txt` — שחזור מקומי של כשל רצפת הנפח.
- `layout-audit-report-verylong-local.json` — דוח אודיט הדפדפן המלא (699 עמ', כולל פרטי עמ' 107).
- `input-hashes.txt` — hash-ים של הקלטים והבאנדלים.

## הגבלות כיסוי

- אודיט ה־live (מול האתר הפרוס ב־gh-pages) לא הורץ במדידה זו — ה־workflow שלו מופעל לילית/יזום; מצב הפריסה החיה מתועד ב־CI האחרון של gh-pages-audit.
- בדיקות matrix של Node 18/20 רצו ב־CI בלבד (הסביבה המקומית: Node 24).
- גרסת agent-browser מקומית 0.42.0 מול 0.41.2 ב־CI — הממצאים זהים בין שתי הסביבות (משוחזר), לכן אין השפעה על מסקנות.
