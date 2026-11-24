# audits/ — בריפו המנוע הישן

מה שנשמר כאן (בלבד):

- **`layout-reference.json`** — החילוץ המתמטי של פלט הגרסה הישנה מקובצי
  ה-PDF שהעלה המשתמש, כולל הסימון הגיאומטרי הבלתי-נראה. **מקור אמת מס'
  1 של המנוע הישן** (מקור 2 = התנהגות המקור עצמה).
- **קורפוסי בדיקה** — `very_long_test_text.txt` (הספר המלא; נעילת
  `legacy-28f52`), `no_long/long/mid_long/long_no_parentheses` —
  משמשים את `tools/layout-parity/run-ours.js`, `tools/cross-check.js`
  ו-workflow ה-CI `corpus-invariants`.
- **PDF-י ייחוס מהגרסה הישנה** — `דוגמא מגרסא ישנה*.pdf` (4 קבצים,
  עם/בלי סימון בלוקים/פסקאות/שורות).
- **`crosscheck/`** — דוחות cross-check מתחדשים (נכתבים בכל הרצה).
- **`full-math-baseline.json`** — בסיס ייחוס נעול לאודיט המתמטי המלא
  (full-math-audit): 24 ממצאי MARKER_NOTE_MATCH קיימים שנלכדו מהרצת ייחוס
  על המנוע הישן המקורי בשלמותו (ללא כל שינוי קוד). האודיט נכשל על סטייה
  מהבסיס — ממצא חדש או נעלם — ועובר כשהמצב זהה בדיוק. חקירת שורש
  הממצאים עצמם פתוחה בריפו המרכזי (ISSUE_REGISTRY).

שאר תיקיות האודיט (איטרציות legacy-parity, baseline-ים, shadow,
preview-evidence, חתימות parity) הוסרו עם המנוע החדש ונשמרות בריפו
המרכזי `Tora_Book_Typesetter_Red_Work_2`.
