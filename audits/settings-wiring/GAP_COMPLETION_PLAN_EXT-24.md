# תוכנית השלמת החסרים — מה נפל בבניית RED מחדש (EXT-24, 25.11.2026)

> **הגדרה:** "בניית RED מחדש" = המנוע המאוחד במרכזי `Tora_Book_Typesetter_Red_Work_2`
> (‏`red-build/src/engine/core/settings-registry.js`,‏ main ‏`79b4de1`,‏ 256 מפתחות).
> **מקום התיקון היחיד:** `Tora_Book_Typesetter_Red_Old` (המנוע הישן) — **הוספות בלבד,
> אפס הורדות** (הוראת משתמש, EXT-22). המרכזי והירוק — **קריאה בלבד**; פערים
> שנמצאו במרכזי מתועדים כאן לעריכת PR עתידית על ידי המשתמש בלבד.

## 1. מקורות ואימות (מה נבדק בפועל)

**דוחות והשוואות שנקראו במלואן** (ב-`audits/settings-wiring/` של Red_Old):
`settings-wiring-report.md` (EXT-20/21/22/23) · 6 קטלוגים (Yellow, Imud_Torani, Gold,
React, Orange, Green) · `tora-settings-comparison.html` (398 שורות).

**ריפואים שנבדקו חי** (שכפול + checkout לקומיטים הנעולים בקטלוגים):

| ריפו | קומיט | מקור ההגדרות | מפתחות (אומת) |
|---|---|---|---|
| Yellow | 64f64a5 ✓ | default_settings.json | 246 ✓ |
| IMUD_TORANI | da31142 ✓ | default_settings.json | 264 ✓ |
| Gold | a444d34 ✓ | default_settings.json | 264 ✓ |
| React | a2fa18e ✓ | packages/settings-schema/registry.json | 257 ✓ |
| Orange | d9f08b9 ✓ | default_settings.json | 259 ✓ |
| Green | 69aac0b ✓ | default_settings.json | 248 ✓ |
| **Red_Work_2 (main)** | 79b4de1 | settings-registry.js + legacy-settings-map.js | 256 רישום / 161 מיפויים |
| **Red_Old (main)** | b77e306 | settings-registry.js + legacy-settings-map.js | 341 רישום / 210 מיפויים |

בנוסף: תוצאות סוויפ v4 (758 מקרים; 191 wired + 24 partial + 126 no-effect),
פסקי הדין פר-מפתח של EXT-23, ו-`work/settings-gap/*.json` (חילוץ מבני מלא של כל
הטבלאות — קבצי הביניים נשמרים בסנדבוקס וזמינים לשחזור).

## 2. תמונת המצב הכמותית

**המשפחה הקלאסית (6 ריפואים):** 278 מפתחות איחוד; 243 מהם (87%) זהים בכולם.
**מה קרה ל-278 בבניית RED מחדש (לפי ההשוואה + מפת main הנוכחית):**

| מיקום ב-RED החדש | כמות | פירוש |
|---|---|---|
| ממופה להגדרת מנוע | 123 | קיים כהגדרת מנוע (90 בטרנספורם מתועד) |
| ממוזג למפתח RED | 16 | קיים, באיחוד מפתחות |
| **מצב UI בלבד — אין הגדרת מנוע** | **133** | **נפל: אין אפקט מנועתי ב-RED החדש** |
| הוסר | 2 | note-header-orn-l/r |
| לא במפת ההעברה | 4 | heading-divider-width/ratio, balance-chapter-end, allow-terminal-residual-fallback |

**מצב Red_Old (המנוע הישן) כרגע:** 341 מפתחות רשומים; סוויפ v4: 191 wired +
24 partial + 126 no-effect. מפתחות RED-בלבד (המצאות הבנייה המחדשית): 120, מתוכם
119 ב-Red_Old ו-61 חוברו.

**הצלבת שלושת הצדדים (משפחה × RED חדש × Red_Old) על 278 המפתחות הקלאסיים:**

| קטגוריה | כמות | הגדרה |
|---|---|---|
| OK_BOTH | 92 | עובד בשני הצדדים |
| G3 — נשתמר ע"י המנוע הישן | 28 | נפל ב-RED החדש (UI-state), אבל Red_Old ממשיך להפעיל אותו |
| G1 — חסר בשני הצדדים | 94 | נפל ב-RED החדש **וגם** אין לו מקבילה רשומה ב-Red_Old |
| G2 — נפל + רשום-מת ב-Red_Old | 17 | נפל ב-RED החדש; רשום ב-Red_Old אך no-effect בסוויפ |
| G5 — רשום בשניים, מת ב-Red_Old | 44 | RED החדש מיפה; ב-Red_Old no-effect (רובם תלויי-מסמך/קומבינציה — מתועד ב-EXT-23) |
| G4 — קיים ב-RED החדש, חסר ב-Red_Old | 3 | heading-divider-h4/h5/h6 (גרעון פיצול רמות) |

## 3. הטריאז' המלא של 94 מפתחות G1 (כל מפתח מסווג — אין יוצא מן הכלל)

סיווג: **T1** (48) שקיל קיים ב-Red_Old (חסר רק מיפוי ייבוא) · **T3** (39)
פער אמיתי להשלמה · **T4** (7) מת גם במשפחה (תיעוד בלבד).

### 3.1 T1 — שקילים קיימים: להוסיף disposition ב-`legacy-settings-map.js` בלבד

| מפתח מקור | מקבילה ב-Red_Old | הערה |
|---|---|---|
| `active-theme-select` | `theme-set-id` | UI/הפניות — מתועד בדוח EXT-20 |
| `builder-back-bottom` | `shaar-back-box-bottom` | EXT-22 (במקור) |
| `builder-back-left` | `shaar-back-box-left` | EXT-22 (במקור) |
| `builder-back-right` | `shaar-back-box-right` | EXT-22 (במקור) |
| `builder-back-top` | `shaar-back-box-top` | EXT-22 (במקור) |
| `builder-main-bottom` | `shaar-main-box-bottom` | EXT-22 (במקור) |
| `builder-main-left` | `shaar-main-box-left` | EXT-22 (במקור) |
| `builder-main-right` | `shaar-main-box-right` | EXT-22 (במקור) |
| `builder-main-top` | `shaar-main-box-top` | EXT-22 (במקור) |
| `builder-sub-bottom` | `shaar-sub-box-bottom` | EXT-22 (במקור) |
| `builder-sub-left` | `shaar-sub-box-left` | EXT-22 (במקור) |
| `builder-sub-right` | `shaar-sub-box-right` | EXT-22 (במקור) |
| `builder-sub-top` | `shaar-sub-box-top` | EXT-22 (במקור) |
| `cbg-regular-color` | `background-color` | רקע גלובלי; חסר פר-מחלקה — ראה WP-1 |
| `cbg-regular-opacity` | `background-opacity` | רקע גלובלי; חסר פר-מחלקה — ראה WP-1 |
| `data-cbg-regular-img` | `background-image` | עם background-page-type=regular |
| `dim-h3-side-h` | `h3-side-orn-height-em` | EXT-23 — גובה קיים; רק רוחב חסר (dim-h3-side-w) |
| `dim-secdiv-h` | `chapter-end-ornament-h-em` | נוסף ב-EXT-23 |
| `dim-secdiv-w` | `chapter-end-ornament-w-em` | נוסף ב-EXT-23 |
| `f-dh` | `dh-font` | נוסף ב-EXT-23 |
| `f-siman` | `siman-font` | EXT-22 (במקור) |
| `file-cbg-regular-img` | `background-image` | צד ההעלאה של המקבילה |
| `hdr-alternating` | `header-verso-same-as-recto` | סמנטיקה הפוכה — לתעד במיפוי |
| `hdr-c-align` | `header-recto-center-align` |  |
| `hdr-distinct-even-odd` | `header-verso-same-as-recto` | סמנטיקה הפוכה — לתעד במיפוי |
| `hdr-l-align` | `header-recto-left-align` |  |
| `hdr-r-align` | `header-recto-right-align` |  |
| `hdr-title-split` | `split-book-title` | חובר ב-EXT-20 |
| `hdr-verso-c-align` | `header-verso-center-align` |  |
| `hdr-verso-c-type` | `header-verso-center-source` |  |
| `hdr-verso-l-align` | `header-verso-left-align` |  |
| `hdr-verso-r-align` | `header-verso-right-align` |  |
| `hdr-w-c` | `header-recto-center-width-pct` |  |
| `hdr-w-l` | `header-recto-left-width-pct` |  |
| `hdr-w-r` | `header-recto-right-width-pct` |  |
| `note-marker-type` | `footnote-marker-style` | חובר ב-EXT-20 |
| `prop-col` | `grid-col-width-pct` |  |
| `prop-gap` | `grid-block-gap-pct` | רווח ביניים |
| `prop-gutter` | `grid-gutter-pct` | מרזב מרכזי |
| `prop-margin` | `grid-margin-side-pct` |  |
| `prop-mb` | `margin-bottom-px` | כנ"ל |
| `prop-mt` | `margin-top-px` | חוזה A4 מכויל — קיים ברישום; חסר רק מיפוי ייבוא |
| `prop-mt-h2` | `h2-top-offset` | חוזה A4 מכויל |
| `s-note-title` | `endnote-title-size-pt` | קיים! (endnote-title-font כבר ממופה f-note-title) |
| `select-shaar-back` | `imud-shaar-back` |  |
| `select-shaar-main` | `imud-shaar-main` | בוררי ספריית IMUD — EXT-20 |
| `select-shaar-sub` | `imud-shaar-sub` |  |
| `style-set-select` | `theme-set-id (UI) + setting_sets` | ערכות הסגנון קיימות בנכסים; ההפעלה UI |

### 3.2 T3 — פערים אמיתיים (39 מפתחות, מקובצים ל-7 חבילות עבודה)

| מפתח מקור | חבילה | ערך משפחה (רוב) | פער |
|---|---|---|---|
| `builder-theme-name` | WP-7 | "" | שמירת ערכה בשם — הבונה האינטראקטיבי חסר |
| `cbg-h0Open-color` | WP-1 | "#f4f1e8" |  |
| `cbg-h0Open-mode` | WP-1 | "none" | רקע לעמודי פתיחת H0 — חסר לגמרי |
| `cbg-h0Open-opacity` | WP-1 | "15" |  |
| `cbg-h2Open-color` | WP-1 | "#f4f1e8" |  |
| `cbg-h2Open-mode` | WP-1 | "none" | רקע לעמודי פתיחת H2 — חסר לגמרי |
| `cbg-h2Open-opacity` | WP-1 | "15" |  |
| `cbg-regular-mode` | WP-1 | "none" | מצב רקע (תמונה/צבע) — אין מושג mode ברד-אולד |
| `data-builder-back-svg` | WP-7 | "" |  |
| `data-builder-main-svg` | WP-7 | "" | SVG מותאם לשער ראשי — ייבוא תוספים קיים; בונה חסר |
| `data-builder-sub-svg` | WP-7 | "" |  |
| `data-cbg-h0Open-img` | WP-1 | "" |  |
| `data-cbg-h2Open-img` | WP-1 | "" |  |
| `data-hdr-c-img` | WP-6 | "" | תמונת עיטור מרכזית בכותרת עליונה — חסרה |
| `data-sec-div-img` | WP-6 | "" | תמונת אישית לעיטור סיום פרק — חסרה |
| `dim-h2-btm-h` | WP-2 | "1.25em" |  |
| `dim-h2-btm-w` | WP-2 | "65%" | מימדי עיטור תחתון ל-H2 — חסר |
| `dim-h2-title-side-h` | WP-2 | "1.1em" |  |
| `dim-h2-title-side-w` | WP-2 | "20px" | עיטורי צד לכותרת H2 — חסר |
| `dim-h2-top-h` | WP-2 | "1.25em" |  |
| `dim-h2-top-w` | WP-2 | "65%" | מימדי עיטור עליון ל-H2 — חסר |
| `dim-h3-side-w` | WP-2 | "50px" | h3-side-orn-height-em קיים; רוחב חסר |
| `dim-note-side-h` | WP-2 | "0.9em" |  |
| `dim-note-side-w` | WP-2 | "40px" | עיטורי צד לכותרת הערות — חסר |
| `enable-shaar-box-editor` | WP-7 | true | עורך תיבות-שער בעכבר — UI; מספרים קיימים (EXT-22), עכבר חסר |
| `f-paren` | WP-4 | "" | גופן טקסט בסוגריים — חסר (רק paren-style-scale קיים) |
| `file-builder-back-svg` | WP-7 | "" |  |
| `file-builder-main-svg` | WP-7 | "" |  |
| `file-builder-sub-svg` | WP-7 | "" |  |
| `file-cbg-h0Open-img` | WP-1 | "" |  |
| `file-cbg-h2Open-img` | WP-1 | "" |  |
| `file-hdr-c-img` | WP-6 | "" | צד העלאה |
| `file-sec-div-img` | WP-6 | "" | צד העלאה |
| `heading-divider-ratio` | WP-5 | "auto" | יחס מפריד כותרות (Orange) — חסר |
| `heading-divider-width` | WP-5 | "40" | רוחב מפריד כותרות (Orange) — חסר |
| `note-header-orn-l` | WP-3 | "none" | עיטור כותרת הערות — הוסר ב-RED החדש; חי במשפחה (Green reads=1) |
| `note-header-orn-r` | WP-3 | "none" |  |
| `s-note-body` | WP-3 | "9" | גודל גוף הערת-צד (pt) — font/color קיימים, גודל חסר |
| `s-paren-mode` | WP-4 | "relative" | אופן גודל סוגריים (relative/…) — חסר |

### 3.3 T4 — מתים גם במשפחה (תיעוד בלבד, אין מימוש)

| מפתח | סיבה |
|---|---|
| `aq-line-height` | מת במשפחה (רק IMUD+GOLD, 0 קריאות) — שרידי v21 |
| `aq-line-height-max` | מת במשפחה |
| `aq-para-spacing` | מת במשפחה |
| `aq-para-spacing-max` | מת במשפחה |
| `aq-word-spacing-max-diff` | מת במשפחה |
| `aq-word-spacing-threshold` | מת במשפחה |
| `assets-folder-input` | REACT בלבד, UI — בורר תיקיית נכסים (מניפסט ריק בכל המשפחה) |

### 3.4 G2 — נפלו ב-RED החדש ורשומים-מתים ב-Red_Old (17)

רובם תלויי-מסמך (ה-fixed חסר H0/H1/רמות 1 ו-7) ואומתו LIVE במסמך עשיר
(ext23-richdoc-check 25/29). פעולה: וריפיקציה בסוויפ v5 עם מסמך עשיר + חיבור שאריות.

| מפתח מקור | מקבילה ב-Red_Old | מצב סוויפ v4 |
|---|---|---|
| `allow-terminal-residual-fallback` | `allow-terminal-residual-fallback` | NO_EFFECT |
| `balance-chapter-end` | `balance-chapter-end` | NO_EFFECT |
| `f-dtoc-1` | `toc-dfont-1` | NO_EFFECT |
| `f-dtoc-7` | `toc-dfont-7` | NO_EFFECT |
| `f-gtoc-1` | `toc-gfont-1` | NO_EFFECT |
| `f-gtoc-7` | `toc-gfont-7` | NO_EFFECT |
| `h2-reset-siman` | `h2-reset-siman` | NO_EFFECT |
| `hdr-h1-title-mode` | `hdr-h1-title-mode` | NO_EFFECT |
| `odd-h0` | `odd-h0` | NO_EFFECT |
| `odd-h1` | `odd-h1` | NO_EFFECT |
| `s-dtoc-1` | `toc-dsize-1` | NO_EFFECT |
| `s-dtoc-7` | `toc-dsize-7` | NO_EFFECT |
| `s-gtoc-1` | `toc-gsize-1` | NO_EFFECT |
| `s-gtoc-7` | `toc-gsize-7` | NO_EFFECT |
| `s-h0-body` | `heading-0-body-size-pt` | NO_EFFECT |
| `shaar-main-divider` | `shaar-main-divider` | NO_EFFECT |
| `shaar-sub-divider` | `shaar-sub-divider` | NO_EFFECT |

### 3.5 G5 — רשומים בשני הצדדים, no-effect בסוויפ של Red_Old (44)

מסווגים ב-EXT-23 §ה: תלויי-מסמך (אומתו חיים), תלויי-קומבינציה, מקור-האמת-מסמך
(imud-book-*), חוזה-A4-מכויל (grid/margins), ממשק/ייצוא בלבד, ומתים-בשני העולמות
(aq-*/widows/orphans). החריג האמיתי היחיד: **`balance-chapter-end` — חי ב-IMUD
(typesetter.js:2451) אך לא ממומש בשום מנוע פעיל → WP-8.**

| מפתח מקור | מקבילה ב-Red_Old | מפתח מקור | מקבילה ב-Red_Old |
|---|---|---|---|
| `aq-enabled` | `aq-enabled` | `hdr-r-custom` | `header-recto-right-custom-text` |
| `aq-shared-load` | `aq-shared-load` | `hdr-verso-c-custom` | `header-verso-center-custom-text` |
| `aq-word-spacing` | `aq-enabled` | `hdr-verso-l-custom` | `header-verso-left-custom-text` |
| `aq-word-spacing-max` | `aq-word-spacing-max` | `hdr-verso-r-custom` | `header-verso-right-custom-text` |
| `aq-word-spacing-min` | `aq-word-spacing-min` | `heading-divider-h3` | `heading-dividers-h3-h6` |
| `auto-dh` | `dh-auto-detect` | `inp-book-author` | `imud-book-author` |
| `avoid-orphans` | `prevent-orphans-top` | `inp-book-desc` | `imud-book-desc` |
| `avoid-runt-word` | `runt-min-width-pct` | `inp-book-sections` | `imud-book-sections` |
| `avoid-widows` | `prevent-widows-top` | `inp-book-subtitle` | `imud-book-subtitle` |
| `f-h0` | `heading-0-font` | `inp-book-title` | `imud-book-title` |
| `f-h0-body` | `heading-0-body-font` | `inp-book-year` | `imud-book-year` |
| `f-h1` | `heading-1-font` | `mode-h0` | `heading-0-mode` |
| `f-h7` | `heading-7-font` | `mode-h1` | `heading-1-mode` |
| `f-sh-sec` | `shaar-sections-font` | `s-h0` | `heading-0-size-pt` |
| `f-sh-year` | `shaar-year-font` | `s-h1` | `heading-1-size-pt` |
| `fn-columns` | `footnote-columns` | `s-h7` | `heading-7-size-pt` |
| `h2-orn-fit-text` | `h2-orn-fit-to-text` | `s-sh-sec` | `shaar-sections-size-pt` |
| `h2-orn-scope` | `h2-orn-scope` | `s-sh-year` | `shaar-year-size-pt` |
| `h2-title-orn-mode` | `h2-orn-scope` | `section-divider-style` | `imud-divider` |
| `h2-top-distance` | `h2-top-offset` | `show-sub-shaar` | `shaar-sub-enabled` |
| `hdr-c-custom` | `header-recto-center-custom-text` | `sub-shaar-count-numbering` | `count-shaar-sub-pages` |
| `hdr-l-custom` | `header-recto-left-custom-text` | `sub-shaar-show-number` | `sub-shaar-show-number` |

### 3.6 חריגות ערכים (החלטות בנייה מתועדות — לא נופלו, אך דורשות תיעוד בקטלוג)

**s1 (3):** `s-h0` 26→20, `s-h1` 50→18 (סולם כותרות RED; Orange חרגה ל-17/36 בעצמה),
`prop-mt-h2` 20→0 (החלטת Orange; לא נמדע).

**s3 (18):** עיקריים — fn-layout-mode block→continuous; page-num-format gematria→hebrew;
note-rule-style star→regular; h2-orn-fit-text false→true; fn-title-text ""→"הערות";
inp-book-* (11) — איפוס תוכן הדמו. כל ה-18 מתועדים כהחלטות RED בטבלת ההשוואה.

## 4. ממצאי איכות מהקטלוגים — פיצ'רים ש"נפלו" אך גם במשפחה היו שבורים

לפני מימוש כל פער — הפיצ'ר נבדק מול המקור. ממצאים מכריעים:

1. **קיבוץ TOC (gtoc-grps/groups):** שבור בגשר בכל המשפחה (ממצא A ב-Green/Gold/Orange);
   Red_Old כבר תיקן והוכיח (EXT-22/23) — **Red_Old מקדים את המשפחה**.
2. **סמני מספור תוכן/שערים (4 תיבות):** מתות במשפחה (ממצא H ב-Green); חוברו ב-EXT-23.
3. **page-num-initial-value:** ללא צרכן במשפחה (ממצא F); חובר ב-EXT-20.
4. **s-note-body/f-note-body:** במשפחה מוקשח 8.5pt ב-CSS (ממצא D); ב-Red_Old חוברו
   font/color ב-EXT-23 — **הגודל (pt) עדיין חסר → WP-3**.
5. **json_theme_40 / active-theme-select:** לא אפקטיבי באתחול בכל המשפחה; ב-Red_Old
   ההפעלה עובדת (EXT-20, "הפעלה אמיתית של ערכת 40").
6. **בוררי עיצוב (select-shaar-*):** במשפחה טעינת ערכות חיצוניות שבורה בחלקה;
   ב-Red_Old — ספריית IMUD מלאה (EXT-20/21).
7. **REACT:** רק 50 מפתחות מ-257 נקראים בפועל; 66 מפתחות גופנים ללא אפקט —
   גרסה מפגרת; אין להשלים ממנה פיצ'רים "חיים".

## 5. חבילות העבודה (WP) — התוכנית המפורטת

לכל WP: מקור (משפחה+עדות) · מימוש ב-Red_Old (רישום→פאנל→מנוע) · בדיקות ·
סיכונים/מנעולים · היקף מוערך · עדיפות (P0=ראשון, P1, P2).

### WP-1 — רקעים פר-מחלקת-עמוד (11 מפתחות; P1)

**מקור:** cbg-{regular,h0Open,h2Open}-{mode,color,opacity} + data/file-*-img בכל
ששת (ערכי ברירת מחדל: regular-color="#f5f0e6" וכדומה — נשלפו בטבלת T3).
**פער:** ב-Red_Old יש רקע יחיד (background-color/opacity/image/texture) + בורר
מחלקה (background-page-type: regular/preface-open/sign-open). אין שלוש קבוצות
רקע מקבילות ואין מושג mode.
**מימוש:**
1. רישום: `background-{regular,h0-open,h2-open}-{mode,color,opacity,image}`
   (12 מפתחות; ערכי ברירת מחדל משמרים את הפלט הנוכחי — הגדרות חדשות "ריקות"
   עם fallback ל-background-color/opacity/image הקיימים כדי לא להזיז דיפולט).
2. מנוע: הרחבת `page-decorations.planBackground` למפה של 3 מחלקות; התאמת
   `backgroundClassForPage` — סינכרון מחלקות (h0Open≡preface-open, h2Open≡sign-open);
   `renderLegacyPage` (EXT-20) קורא את הקבוצה לפי מחלקת העמוד.
3. פאנל: שלוש שורות רקע בלוח "רשת העמוד" או "ערכות נושא" (הוספה בלבד).
4. מיפוי ייבוא: disposition ל-12 המפתחות הקלאסיים.
**בדיקות:** סוויפ v5 (שינוי צבע/תמונה/opacity לכל מחלקה ⇒ CHANGED בעמודים
המתאימים בלבד); נעילת digest מחודשת בתיעוד (S4.24 — שימור התנהגות ברירת מחדל).
**סיכון:** בינוני — נוגע ברינדור רקע; מנעולים ישנים של רקע יחיד לא יישברו אם
ה-fallback משומר. היקף: ~1.5 ימי עבודה.

### WP-2 — מימדי עיטורים (11 מפתחות; P0)

**מקור:** dim-h2-top-{w,h}, dim-h2-btm-{w,h}, dim-h2-title-side-{w,h}, dim-h3-side-w,
dim-note-side-{w,h} (Green/IMUD ברירות: למשל dim-note-side-w="40px", h="0.9em").
**פער:** ל-Red_Old יש enums לבחירת העיטור (h2-orn-{top,bottom,side}, h3-side-orn,
chapter-end-ornament + chapter-end-ornament-{w,h}-em מ-EXT-23) אך חסרים מימדי
h2 ועיטורי-צד ומימדי כותרת-הערות.
**מימוש:** מפתחות `h2-orn-{top,bottom,side}-{w,h}-em` (ערכי משפחה כברירת
מחדל), `h3-side-orn-width-em`, `note-side-orn-{w,h}`; צרכנים: ornament-fit.js /
legacy-ornaments.js + הקרנה ב-legacy-projector/dom-renderer (בדיוק כמו
chapter-end-ornament-w/h-em הקיים — דפוס מוכח).
**בדיקות:** סוויפ v5 — שינוי מימד ⇒ CHANGED; העלאת em ⇒ שינוי גיאומטריה בלבד
בפס העיטור. היקף: ~1 יום. סיכון: נמוך (אותו דפוס קיים).

### WP-3 — הערות: גודל גוף + עיטורי כותרת (4 מפתחות; P0)

**מקור:** s-note-body=9 (גודל; במשפחה מוקשח 8.5pt בפועל — ממצא D),
note-header-orn-l/r (Green reads=1; **הוסרו מפורשות ב-RED החדש**).
**פער:** s-note-body-font/color קיימים (EXT-23) אך הגודל חסר; עיטורי כותרת
ההערות חסרים לחלוטין (גם הוסרו ב-RED החדש — יש להחזיר ב-Red_Old בלבד).
**מימוש:** `s-note-body-size-pt` (9) + `note-header-orn-{l,r}` (enum עיצובים כולל
imud:) ; צרכן: legacy-imud-flow (מרזב/כותרת הערות) + הקרנה.
**בדיקות:** Node (מסמך עם הערות-צד: שינוי גודל ⇒ שינוי גובה שורות הערה); סוויפ v5.
היקף: ~0.5 יום. סיכון: נמוך.

### WP-4 — סוגריים: גופן ואופן גודל (2 מפתחות; P0)

**מקור:** f-paren='' (ריק=גוף), s-paren=-2, s-paren-mode=relative (Green).
**פער:** ב-Red_Old קיים paren-style-scale בלבד (EXT-20: scale×body).
**מימוש:** `paren-font` (font; ריק=גוף — כמו first-word-font) ו-`paren-size-mode`
(enum: relative/absolute; relative שומר את paren-style-scale כהיסט). צרכן:
pipeline.js SZ.parenDelta + מדידה ב-measure-api + רינדור.
**בדיקות:** מסמך עם סוגריים — שינוי גופן/אופן ⇒ CHANGED ב-hash; ברירת מחדל
לא מזיזה דיפולט (scale=1 ⇒ 0). היקף: ~0.5 יום. סיכון: נמוך-בינוני (מדידה).

### WP-5 — מפרידי כותרות: width/ratio + פיצול רמות (5 מפתחות; P1)

**מקור:** heading-divider-width/ratio (Orange f15fd7f) + heading-divider-h4/h5/h6
(IMUD/Gold/Orange; **ה-4 של G4**: ב-Red_Old מיזוג יחיד heading-dividers-h3-h6).
**מימוש:** `heading-divider-width-px`, `heading-divider-ratio` ופיצול
`heading-dividers-h4/h5/h6` (הסט ברירת מחדל = המפתח הממוזג כדי לשמר פלט);
עדכון ענף הדיו שנוסף ב-EXT-23 לקרוא מימדים.
**בדיקות:** סוויפ v5; מסמך עם H3..H6. היקף: ~0.5 יום. סיכון: נמוך.

### WP-6 — תמונות אישיות: כותרת-מרכז + סיום-פרק (4 מפתחות; P1)

**מקור:** data/file-hdr-c-img (Green reads=3), data/file-sec-div-img (reads=3).
**מימוש:** הרחבת מקורות הכותרת העליונה במצב image (כמו שערים ב-EXT-21:
פענוח SVG וקטורי ב-data-URI, אחרת רסטר) — `header-center-image` והרחבת
`chapter-end-ornament` לקבל data-URL. צרכן: headers-builder/legacy-ornaments.
**בדיקות:** מסמך עם SVG ב-data-URI ⇒ ציור בייצוא PDF (אותה פריצה של EXT-21).
היקף: ~1 יום. סיכון: בינוני (PDF).

### WP-7 — בונה ה-SVG ועורך תיבות-שער בעכבר (10 מפתחות; P2)

**מקור:** enable-shaar-box-editor, builder-theme-name, data/file-builder-{main,sub,back}-svg.
**מצב:** המספרים (builder-*→shaar-*-box-*) כבר קיימים וחוברו (EXT-22);
ייבוא תוספים/SVG קיים (extensions + svg-sanitize). החסר: ה-**UI האינטראקטיבי** —
עריכת תיבות בעכבר ושמירת ערכה בשם.
**מימוש:** מודול UI קטן ב-settings-panel שכותב למפתחות הקיימים (גרירה ⇒
shaar-*-box-*); "שמירת ערכה" כותבת JSON ל-setting_sets מקומי (דרך
settings-persistence) — ללא שינוי מנוע.
**בדיקות:** UI ידני + סוויפ (המפתחות כבר wired). היקף: ~1.5 ימים. סיכון: נמוך
(UI בלבד, המנוע לא נוגע).

### WP-8 — איזון סוף-פרק (1 מפתח + 2 מושגים; P2)

**מקור:** balance-chapter-end — **היחיד מ-UNMAPPED שחי במשפחה** (IMUD
typesetter.js:2451 קורא אותו; גם פקד-HTML מחוץ לרישום שם). ב-Red_Old רשום
אך no-effect; ב-RED החדש לא במפה.
**מימוש:** מפתח קיים; לחבר צרכן ב-retreat-loop/balancing.js — איזון עומק
טורים בעמוד האחרון של פרק (H2) במצב הישן. ברירת מחדל שקופה (false/ריק).
**בדיקות:** מסמך פרק-קצר — הפעלה ⇒ שינוי חלוקת טורים בעמוד אחרון בלבד.
היקף: ~1 יום. סיכון: בינוני (פוגע בעימוד — נעול לברירת מחדל כבויה).
בנוסף: לתעד allow-terminal-residual-fallback (מת בגם ב-Green) ולא לממש.

### WP-9 — מיפויי ייבוא (T1): 48 disposition חדשים (P0)

הוספת 48 ערכים ל-DISPOSITIONS של `legacy-settings-map.js` ב-Red_Old לפי טבלת
3.1 (mapped עם טרנספורם הופך-סמנטיקה כשנדרש: hdr-alternating/hdr-distinct-even-odd
⇒ header-verso-same-as-recto **מנוכש**). כתוצאה: ייבוא default_settings.json מכל
המשפחה (Yellow/IMUD/Gold/Orange/Green + React legacy) מקבל 100% disposition.
**בדיקות:** יחידת ייבוא — כל מפתח קלאסי ⇒ מפתח Red_Old נכון; מסמכי המשפחה
(הפריסטים של IMUD) מיובאים ללא נפילות. היקף: ~0.5 יום. סיכון: נמוך.

### WP-10 — וריפיקציה ותיעוד (P0, ליווי כל ה- WP)

1. **סוויפ v5 על מסמך עשיר** (H0/H1/H7/shaar-sub/מטא מלא/הערות-צד/סוגריים/פרק
   קצר): הופכת את פסקי הדין "no-effect" התלויים-מסמך של G2/G5 ל-LIVE.
2. מטריצת יעד: 341+מפתחות חדשים; **אפס notApplied; שחזור מלא (notRestoredKeys=[]);
   בסיס יציב (finalCheck.ok) — כמתודולוגיית EXT-23.**
3. Node: npm test מלא + דטרמיניזם + cross-check (מנעול legacy קיים; כל שינוי
   ברירת-מחדל מחדש מנעול עם סיווג, כמו legacy-8b344→legacy-ff891 ב-EXT-23).
4. עדכון מסמכים: settings-wiring-report.md (EXT-24), טבלת ההשוואה (עמודת
   Red_Old), ו-README ההשוואה.

## 6. סדר ביצוע ותלויות

1. **WP-9 (מיפויים)** — עצמאי, מיידי, אפס סיכון.
2. **WP-2 + WP-3 + WP-4** — פערים טיפוגרפיים קטנים (P0), מקביליים.
3. **WP-5, WP-1** — P1; WP-1 אחרי WP-2 (אותו תחום רינדור רקע/עיטור).
4. **WP-6, WP-8, WP-7** — P2; WP-7 אחרון (UI על מפתחות קיימים).
5. **WP-10** — רץ לאורך כל הדרך; סוויפ v5 עולה אחרי WP-2/3/4.

## 7. כללי עבודה (קשיחים)

1. **הוספות בלבד ב-Red_Old** — שום מפתח/אפשרות/פקד קיים לא יורד ("לגבי
   הוספה! לא הורדה!!"). ברירות מחדל חדשות משמרות פלט ("ריקות" עם fallback).
2. **Red_Work_2 קריאה בלבד** — הפערים שנמצאו שם (133 UI-state, 2 הוסרות,
   4 לא-במפה, 18 ערכים) מתועדים במסמך זה להחלטת המשתמש בלבד.
3. **Green ושאר המשפחה** — אסמכתאות קריאה בלבד; קומיטים נעולים (לא לעדכן).
4. **שימור תוכן גובר על נעילת digest** (עיקרון S4.24) — כל חידוש מנעול
   מתועד: ישן→חדש, סיבה, קבוצה.
5. כל שינוי עובר: npm test מלא + דטרמיניזם + cross-check + סוויפ v5 + בדיקת
   דפדפן ידנית למפתחות ה-UI.
6. הריפו Tora_Book_Typesetter_Red (החדש ביותר, 24.11) **לא כוסה בדוחות** —
   מומלץ להוסיפו לקטלוג בסבב הבא (פוטנציאל לפערים נוספים).

## 8. קריטריוני קבלה (סוף התוכנית)

- [ ] 94 מפתחות G1: 48 ממופים בייבוא (WP-9) · 39 מומשו/חוברו (WP-1..8) · 7
      מתועדים-מתים (T4) — **אפס לא-מסווג**.
- [ ] G2/G5: פסקי דין סופיים בסוויפ v5 על מסמך עשיר (מטרה: אפס "no-effect"
      שאינו מתועד כמת-במקור או UI/ייצוא בלבד).
- [ ] ייבוא default_settings.json מכל 6 המשפחות ⇒ 100% disposition ב-Red_Old.
- [ ] סוויפ v5: אפס notApplied, אפס notRestoredKeys, בסיס יציב.
- [ ] Node: כל הסוויטות ירוקות; דטרמיניזם; cross-check PASS.
- [ ] דוח EXT-24 + טבלת ההשוואה מעודכנים ודחופים ל-Red_Old.

## 9. נספח — קבצי ביניים לשחזור

כל הטבלאות נבנו מ-`work/settings-gap/` בסנדבוקס: comparison.json (398 שורות),
redold-registry.json (341), newred-main-registry.json (256), redold-dispositions.json
(210), newred-main-dispositions.json (161), redold-sweep-verdicts.json (341),
g1-triage.json (94), gap-analysis.json, catalog-findings.json. הסקריפטים:
`scripts/parse-settings-comparison.py`, `scripts/extract-registries.py`,
`scripts/gap-analysis.py`, `scripts/g1-triage.py`.
