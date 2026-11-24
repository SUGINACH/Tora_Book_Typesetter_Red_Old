# בדיקת חיווט לוח ההגדרות בדפדפן — EXT-20 (24.11.2026) + EXT-21/22 (25.11.2026)

**מטרה:** ודא שכל אפשרויות הבחירה בלוח ההגדרות (259 הגדרות + 9 בוררי ספרייה)
מחוברות ומשפיעות על המסמך בפועל, ותקן כל מה שנדרש תיקון.
**עדכון EXT-21 (25.11):** תיקון דיווח המשתמש "השערים אחורי/משנה לא נמתחים על
כל העמוד" — עיצובי השערים לא צוירו כלל בייצוא PDF (svg-ב-data-URI נחשב
"תמונת רסטר"); כעת מפוענחים וקטורית (stretch מלא, גרדיאנט→צבע ממוצע,
מסגרות stroke) ונצבעים מאחורי הטקסט (behind) — כמו ה-DOM והמקור הירוק.
**עדכון EXT-22 (25.11):** השוואה מלאה מול המקור הירוק (Tora_Book_Typesetter_
Green) — **הוספה בלבד, אפס הורדות**: 78 הגדרות חדשות (259→341), ביחוד
תוכן-העניינים — גופן/גודל/הצגה/קיבוץ פר-רמה ופר-סוג (f/s-gtoc-N, f/s-dtoc-N,
gtoc/dtoc-show, gtoc/dtoc-grp), סימן (f/s-siman), פתיחות אי-זוגי (odd-h0/1/2),
סמני הערות, גיליון על שערים (main/back/sub-shaar-show-number) ותיבות שער
(builder-{main,sub,back}-{top,bottom,right,left} — 0=אוטומטי). תיקון שור:
שדה ה-font של שורות ה-TOC אבד במיפוי המודל — הגופן לא הגיע מעולם לרינדור.
בדיקות: 26/26 סוויטות; cross-check PASSED (legacy-28f52 נשמר); דפדפן —
14/16 מקרים משנים מסמך (קיבוץ-TOC וגודל-סמן הוכחו ב-Node/PDF).

**מתודולוגיה:** סוויפ אוטומטי בדפדפן החי (harness: `tools/browser-settings-sweep.js`) —
מזריק מסמך בדיקה דטרמיניסטי, ולכל ערך-בחירה של כל בקרה בפאנל: משנה דרך
ה-DOM האמיתי (dispatch change) → מפעיל ⚡ (הנתיב המיידי) → ממתין להשלמת
העימוד (מונה דור) → מצלם את ה-HTML המיוצא המלא + layoutHash + מספר עמודים
→ משווה לבסיס → משחזר את הערך. 599 מקרי בדיקה בכל ריצה. בנוסף: מסמך עשיר
(H0/H1/מטא-נתונים מלאים), מסמך עם כותרת-1 מפורקת (למפריד שער-המשנה),
בדיקות ידניות ל-7 המפתחות הקלים (רינדור-בלבד), בוררי ספריית IMUD
(8 בוררי עיצוב + ערכות סגנון), וצילומי אימות hash.

## תוצאות לפני התיקון (סוויפ v2, מנוע לפני EXT-20)

- 273/599 מקרים השפיעו; **150 מפתחות מתים לחלוטין** + 7 חלקיים (אפשרות אחת מתה).
- 8 בוררי הספרייה + ערכות הסגנון: הבוררים לא השפיעו כלל (רק ערכות הסגנון עבדו).
- באג הנתקעות: `fn-bar-max-height-px=1` נעל את המנוע (90 שנ' + ביטול).

## התיקונים (EXT-20) — כולם בריפו זה בלבד

| קבוצה | מפתחות שחוברו | מנגנון |
| --- | --- | --- |
| גשר S77 מורחב | heading-2..6-size-pt, body-font-size-pt, body-line-height, first-word-size-em, imud-book-back-* (4), header-separator-line, heading-0-body-size/font | `RED_SETTING_BRIDGE_S77` + קריאות cfg/SZ חיות; ברירות המחדל = הקבועים המכוילים (מגן digest) |
| מצבי כותרות | heading-0..7-mode | `refreshHeadingModes` — דריסה מההגדרה החיה רק כששונה מהמיובא (עגול-סגור מלא; h1-new-page⇒sub_shaar) |
| גוף וסולם | body-font-size-pt, body-line-height, paren-style-scale | `GEO.LINE_H = body×(96/72)×lh` (12/1.34 ⇒ 21.44 בדיוק), `SZ.parenDelta=(scale−1)×body` (0.8333×12 ⇒ −2) |
| מילת-חלון | first-word-size-em, first-word-font | מדידה (`breakPara` ×em) + רינדור (em מההגדרה; גופן מוזרק רק כש≠FrankReal) |
| מספור עמודים | page-num-format/frame/position/initial-value/start-idx, count-shaar/sub/toc/endnote-pages, general/detailed-toc-count-numbering | `folioOf` (hebrew=toBareGematria/decimal/דף-…), רשימות counted לפי count-*, עיגול/מסגרות/מיקומים ב-renderLegacyPage |
| הערות | footnote-marker-style (5 סגנונות), footnote-reset-policy (continuous; page/part≈siman), fn-bar=1 (תיקון נעילה: רצפת שורה) | `markerStyleFn` (ברירת מחדל = toGematria ההיסטורית), כינוי-רישום, `Math.max(1, floor(cap/pitch))` |
| שערים | show-shaar-sub, shaar-sub-enabled, shaar-sections-* (3), heading-0/1-* (8), heading-0-body-* | שערי-משנה מגודרים ב-cfg.showSubShaar + כינוי; גדלים/צבעים/גופנים כבר נקראו — אומתו במסמך עשיר |
| רינדור-מורשת | background-color/opacity/image/texture/page-type, footnote-separator-rule, column-divider-style | renderLegacyPage: אותם חוזקים כמו הנתיב הכללי (bgRgba, planBackground, fn-rule, קו מפריד טורים) |
| כותרות עליונות | header-verso-same-as-recto, split-book-title (combo), מקורות custom (combo) | ירושת recto במעבר ה- S77; דריסת book-name→split |
| ספריית IMUD | 8 בוררי עיצוב: שער ראשי/משנה/אחורי, עיטור עליון/תחתון/צדדי, מפריד | הפניות imud: נפתרות לעיצוב מלא (shaar-design ברקע) או לדיו אמיתי; **תוקן בורר הצדדי (חסר imageMode ב-PICKS)** |
| ערכת נושא | הפעלה אמיתית של ערכת 40 | שערי הספר מרונדרים מהעיצוב האמיתי (כפי ש-README הבטיח) במקום השלד המוקשח — **שינוי ברירת-מחדל מכוון בדפדפן בלבד** (נתיב Node/מנעולים לא זז) |

## אימותים

- **Node: 26/26 סוויטות ירוקות**, `test:determinism` OK, `cross-check` PASSED
  (very_long: 695 עמודים, hash `legacy-28f52` — המנעול נשמר; run-ours ללא שינוי).
- **דפדפן:** בסיס נקי יציב לפני/אחרי כל ריצה (`finalCheck.ok=true`); כל שינוי
  משוחזר; layoutHash ברירת המחדל זהה (`legacy-1c281fbd…`) — הגיאומטריה לא זזה.
- **סוויפ סופי:** 599 מקרים; 351 השפיעו; אפס notApplied; אפס חריגות מנוע
  (ה-light-7 אומתו ידנית — הם נחסמים ב-guard ה-dirty בזמן הסוויפ, לא באג).

## שאריות מתועדות (by-design — לא ניתנות לתיקון במנוע הישן)

- **לא מומשו במנוע הישן וגם לא במקור:** aq-* (12), prevent-widows/orphans (4),
  widow-strictness, runt-min-width-pct, balance-chapter-end,
  allow-terminal-residual-fallback, imbalance-max-delta-px.
- **הוספות-RED בלבד (אין מקור):** note-placement-mode, endnotes-enabled,
  endnote-columns, footnote-columns, s-note-body-*, shaar-back-text, dh-*,
  h3-side-orn*, chapter-end-ornament* (הבורר כותב — אין צרכן), heading-dividers-h3-h6.
- **חוזה A4 מכויל:** grid-* (4), margin-top/bottom-px, binding-offset-px (בזרימה
  עצמה; ב-page-templates נצרך), h2-top-offset; אפשרות page-size=custom (זהה ל-A4).
- **צימוד-פס:** heading-7-size-pt (ייבוא נחתם 6→8; מפתח הערות-הצד מכויל), אפשרות
  side-note ל-h4..h6 (הערות-צד ברמה 7 בלבד), first-word-align-cap-top (בסיס −2px מכויל).
- **אוצר-מילים:** shaar-*-divider (ערכי CSS מול מזהי עיצוב), toc-level-7 (רמות 2–6),
  hdr-h1-title-mode (ctx.h1 לא מסופק במעבר המורשת), measure-impl (זהה כשהגופנים רשומים).
- **מקור האמת = המסמך:** imud-book-title/subtitle/desc/sections/author/year
  (מטא-נתוני העורך גוברים; ערכי ערכת-הנושא רדומים), shaar-year-* (השנה אינה
  מוצגת בשער המכויל — כמו במקור), shaar-main/sub-image.
- **תלויי-קומבינציה/מסמך:** header-*-custom-text (דורש מקור custom), split-book-title
  (פועל על מקורות book-name), background-inset-mm (עם תמונה), long-footnote-policy
  (הערות חורגות), header-opening-* (עם opening-dedicated), h2-orn-*/imud-* במצב
  image (עם הפניה מהבורר — כעת עובד), 'page'/'part' של footnote-reset-policy (≈siman).
- **ממשק/ייצוא בלבד:** trace-verbosity, diagnostics-enabled, audit-stage-snapshots,
  offline-guard, debounce-light-change-ms, theme-set-id (הערכה פעילה דרך ההפניות),
  pdf-crop-marks + export-bleed-mm (נתיב PDF), page-num-format='hebrew' (=ברירת המחדל),
  page-num-initial-value=0 (נחתם ל-1), page-num-start-idx=2 (עמ' 0 לא נספר ממילא),
  fn-bar=1000 (נדרס ע"י תקרת 50% של body-first), header book-name-split/rest
  (זהים לחצאים ב-recto).

## שימוש חוזר

ה-harness נשמר ב-`tools/browser-settings-sweep.js` — לטעינה בקונסולת הדפדפן
(`window.__sweepRunAll()`) ולסריקה חוזרת אחרי כל שינוי מנוע.
