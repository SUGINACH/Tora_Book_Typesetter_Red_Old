# ENGINE_RUNTIME_PATHS — מפת מסלולי runtime ותרשים הצינור הפעיל (שלב 1)

> **Commit:** `95e829d44e88f436c9397d82473cd9e2f4a698aa`. כל ההפניות ל־`red-build/src/` אלא אם צוין אחרת. מסמך נלווה ל־`ENGINE_CURRENT_STATE.md`.

---

## 1. תרשים הצינור הפעיל (כפי שאומת בקוד)

```
┌─────────────────────────── המוצר (דפדפן) ───────────────────────────────┐
│ editor-tab.js (הקלדה ← מסומן dirty בלבד — F-06)                        │
│   │ ⚡ עימוד יזום / הדבקה / ייבוא txt / פתיחה / מסמך-בדיקה / המלצה     │
│   ▼                                                                     │
│ app-shell.js:409 onExplicitRetypeset                                   │
│   → worker-client.js requestTypeset {type:'typeset-request'}           │
│   ▼                                                                     │
│ [Worker] engine-worker-main.js:92 → typeset(text, settings, {onProgress})│
│   ▼                                                                     │
│ core/pipeline.js:113 typeset()                                          │
│   ├── _layout-profile==='imud' && _imudRaw  (pipeline.js:123-126)       │
│   │        ▼                                                            │
│   │   legacy-imud-flow.js:871 legacyTimeset()  ◄── ברירת מחדל חיה       │
│   │     tokenizeDoc:303 → LineBreaker(גרידי):407 → flowSection:1319    │
│   │     → fnReserveFor/placeFootnoteArea:2497-2813 → TOC/שערים/גיליון  │
│   │     → חשבונאות ≥-coverage:3494-3589 → result.legacyProfile:3698    │
│   └── אחרת — נתיב DP המודרני                                           │
│       lexDocument:164 → tokenize:165 → scanBrackets:179                │
│       → MeasureAPI:186 (table → font-metrics בשדרוג שקט:237)           │
│       → לולאת בלוקים: protectWords+breakLines(KP)+dropword:285-583      │
│       → planPages (dp-planner.js:89; probe==reservation:148;           │
│         optimalSplit:170; rejectToBody:295-321)                        │
│       → runProtections+runRetreatLoop:531-561                           │
│       → insertShaarPages:635 → alignColumnBottoms/AQ:659-671            │
│       → עמודי TOC:676-727 → placeSideNotes:742 + planPageOrnaments:748 │
│       → buildEndnotePages:765 (endnotes-mode) → assignNumbers:814      │
│       → buildHeader:867 → הוכחות שלמות:894-1107 → layoutHash:1183      │
│   ▼                                                                     │
│ pages[] (מודל עמוד — שני פורמטים: legacy/DP)                            │
│   ├── תצוגה חיה: preview-tab.js:10 → dom-renderer.renderPage           │
│   │     (מתעלם מהמקרינים; מסלע פי page.legacy — dom-renderer.js:1318)  │
│   ├── ייצוא HTML: export-api.js:55-78 → אותו renderPage (חוט UI)      │
│   └── ייצוא PDF: [Worker] export-request → export-api.js:117-122       │
│         ‎(typeset שני! עם font-metrics) → :135-137                      │
│         projectLegacyDocument | projectDocument → pdf-writer.writePdf  │
└─────────────────────────────────────────────────────────────────────────┘
┌───────── יבוא ─────────┐  ┌────────── Node/בדיקות ──────────────────────┐
│ docx-import.js (חוט UI) │  │ tests/* → typeset() ישירות (DP כברירת      │
│ zip-reader+xml-lite     │  │ מחדל; מורשת דרך פיקסטורות _imudRaw);        │
│ → טקסט שטוח → עימוד     │  │ inline-transport.js — אותו פרוטוקול        │
└─────────────────────────┘  │ בתהליך (בדיקות UI)                          │
                             └──────────────────────────────────────────────┘
```

## 2. נקודות כניסה (אומתו)

| כניסה | שרשרת | הערות |
|---|---|---|
| הקלדה בעורך | `editor-tab.js:114-117` — סימון dirty בלבד; **אינה מפעילה את המנוע** | נאכף ע"י `callgraph-scan.js` (F-06 allowlist; 0 הפרות ב־scan-control-triggers) |
| עימוד יזום | `app-shell.js:409` → `worker-client` → `engine-worker-main.js:92` → `typeset` | פרוטוקול הודעות סכמתי (D-65) |
| ייבוא DOCX | `app-shell.js:22` (require בחוט ה־UI) → `docx-import`+`zip-reader`+`xml-lite` → טקסט | **רץ מחוץ ל־Worker**; משמיט תמונות בשקט (ראה §9) |
| פתיחת txt | `app-shell` → decode → אותו נתיב עימוד | ב־Red קיים `text-decode.js` לקידודים — חסר כאן |
| מסמך בדיקה | `test-doc-generator.js` (seed קבוע D-93) | |
| Node/בדיקות | קריאה ישירה ל־`typeset`; UI בדיקות דרך `inline-transport.js` | |

## 3. טבלת שלבים — נתיב DP (כל שורה: סמכות/מתאם, חלופה, פעיל במוצר)

| שלב | נקודת כניסה+פונקציות | קלט → פלט | צרכנים | סמכות | חלופה | פעיל במוצר |
|---|---|---|---|---|---|---|
| פרשנות | `dfa-lexer.lexDocument` `pipeline.js:164`; `block-tokenizer.tokenize` `:165` | raw → `metadata`+`bodyLines`+tokens `{parts,notes}` | scanBrackets, לולאת הבלוקים | סמכות (DP) | `legacy-imud-flow.tokenizeDoc:303` (מורשת) | רק כשלא-legacy — **כן** (נתיב DP זמין למוצר בנפילת נכסים/הגדרות RED) |
| סוגריים | `bracket-scanner.scanBrackets` `:179` | tokens → `scope` map | מדידה/שבירה | סמכות | — | כן (DP) |
| מדידה | `MeasureAPI` `:186` (`measure-api.js`; ברירת מחדל `measure-impl:'table'` `settings-registry.js:307`; שדרוג שקט `measure-api.js:237-242`) | פריט+סגנון → advance/height/baseline | KP, dp-planner | **סמכות משותפת עם 3 מקורות נוספים** (ראה רגיסטר D1) | `font-metrics.js` (sfnt) | כן |
| שבירת שורות | `kp-linebreak.breakLines` + `dropword` `:285-583` | words[]+מדדים → `lines {words,widthPx,heightPx,isLast}` | planPages | סמכות (DP) | `LineBreaker` גרידי `legacy-imud-flow.js:407` | כן (DP) |
| תכנון עמודים | `dp-planner.planPages:89` (+`candidate-generator`, `footnote-budget`, `balancing.optimalSplit`) | lines → `pages[]` + cut-points | כל מה שאחריו | סמכות (DP) | `flowSection:1319` | כן (DP) |
| הגנות+נסיגה | `runProtections`+`runRetreatLoop` `dp-planner.js:531-561` | pages → pages (תיקון column-imbalance בלבד; השאר ledger) | ledger | מתקן | — | כן (DP) |
| שערים | `insertShaarPages:635` | pages → pages+שערים | מקרינים | סמכות | מובנה במורשת | כן |
| איזון תחתיות | `alignColumnBottoms` `pipeline.js:661-670` (D-101) | pages → pages | מקרינים | סמכות | מנגנון מקביל במורשת (`alignBlockBottoms`) | כן |
| TOC | `toc-builder` `pipeline.js:676-727` | כותרות → עמודי TOC | מקרינים | סמכות | TOC מובנה במורשת | כן |
| הערות-צד | `placeSideNotes:742` (`side-notes.js:106-114`) | anchors → `page.sideNotes[]` | dom-renderer, מקרין | **כותב יחיד** למיקום | — | כן (DP) |
| עיטורים | `planPageOrnaments:748` (`ornament-plan`+`ornament-fit`) | עמודים → עיטורים מתוכננים | מקרינים | סמכות | `legacy-ornaments` | כן |
| הערות-סיום | `buildEndnotePages:765` | notes → עמודי הערות | מקרינים | סמכות | — | דלוק (`endnotes-mode` בלבד) |
| מספור | `assignNumbers:814`+`numbering-audit` | pages → folio/gematria | מקרינים | סמכות | מובנה במורשת | כן |
| כותרות עליונות | `buildHeader:867` (`headers-builder`) | הקשר → סלוטים | מקרינים | סמכות (D-61/D-81 חלקי) | — | כן |
| הוכחות | שלמות תוכן/מבנה `pipeline.js:894-1107`; `layoutHash:1183` | result | UI/בדיקות | סמכות | חשבונאות מורשת `:3494-3589` | כן |

## 4. טבלת שלבים — נתיב מורשת (ברירת המחדל החיה)

| שלב | פונקציות (`legacy-imud-flow.js` אלא אם צוין) | קלט → פלט | הערות סמכות |
|---|---|---|---|
| פרשנות | `parseMetadata:132-144`, `tokenizeDoc:303-386` | raw → tokens `{type:'h0..h7'|'p', sideNote, endNote}` | טוקניזר עצמאי — **מתחרה** ל־parser/* |
| קונפיגורציה | `readConfig:169+` (+גשר S77 `RED_SETTING_BRIDGE`) | `_imudRaw`+הגדרות חיות → cfg | גשר חי מהרישום (S77) — מתאם |
| שבירה | `LineBreaker:407-620` (גרידי; `breakPara:536`; FIT_EPS `:406`) | מילים → שורות `{words,markerIdx,paren*,y,paraId,lineIdx}` `:3007-3023` | מתחרה ל־KP |
| זרימת עמוד | `flowSection:1319+` (בלוקים/טורים/bands) | שורות → `blankPageObj+bands` `:1136-1156` | מתחרה ל־dp-planner |
| הערות שוליים | `fnReserveFor`/`fnQueue {text,num,key}` `:1446-1474`; `placeFootnoteArea:2497-2813` | tokens → מרזב | מתחרה ל־footnote-budget/side-notes |
| הערות-צד | `emitUnit` marginNotes `:3028-3042` (מקובע 9.6px pitch, **ללא טיפול התנגשות**) | → `marginNotes[]` | שורש משוער ל־SIDE_NOTE_OVERLAP |
| שערים/TOC/גיליון | מובנים (gateLines, עמודונים, כותרות) | — | מתחרה ל־decoration/* |
| איזון תחתיות | `alignBlockBottoms` + `stretchLastBlockToBottom:786-788,2409-2410` (D-101) | — | מנגנון מקביל ל־DP |
| חשבונאות | `≥-coverage` `:3494-3589` | — | חלש מהמולטיסט המדויק של DP |
| תוצאה | `legacyTimeset` result `:3685-3699` (+`legacyProfile`) | — | חוזה תוצאה נפרד |

## 5. מפת צרכני המודלים (מי אוכל מה)

| מודל | יצרן | צרכנים |
|---|---|---|
| `words[]` (מחרוזות+PUA) | DP: `pipeline.js:465-507` · מורשת: `LineBreaker` | KP, dp-planner, מקרינים, חשבונאות, markers.js (regex) |
| `lines` | KP `kp-linebreak.js:181` · מורשת `:3007-3023` | planPages/flowSection, מקרינים, dom-renderer |
| `pages[]` | DP `newPage` `dp-planner.js:110-114` · מורשת `blankPageObj:1136` | dom-renderer (תצוגה), export-api (PDF), אודיטים |
| `scope` (סוגריים) | `bracket-scanner.js:51-154` | מדידה, שבירה, parenSpans |
| `fnQueue`/`notes` | מורשת `:1446` · DP `pipeline.js:503` | מרזב/עמודי הערות, חשבונאות |
| `page.sideNotes[]` | `side-notes.js:106-114` (כותב יחיד) | dom-renderer, geometry-projector |
| CP5 (גאומטריה מוקרנת) | `geometry-projector.js:55-322` | **pdf-writer בלבד** |
| `page.footnotes {text,marker,mode,heightPx}` | `dp-planner.js:269-286` | geometry-projector, dom-renderer, חשבונאות |

## 6. זרימת תמונות ונכסים (משימה ה׳)

| שלב | מיקום | ממצא |
|---|---|---|
| בחירת קובץ | אין (אין UI לתמונות משתמש) | תמונות = נכסי ספרייה בלבד |
| ייבוא ZIP/תיקייה | `assets-import.js` (`importAssetFolder`, `wrapShaarMedia`) | **מת** — אין קריאה במוצר (בדיקות בלבד) |
| מזהה נכס | `asset-registry.js` | רישום בזמן בניית עיטורים |
| מידות טבעיות | **אין פרסור בינארי** (PNG IHDR/JPEG SOF) | מידות מוצהרות mm/היוריסטיקה; `background-size:100% 100%` |
| פורמט/SVG | `svg-sanitize.js` (עיטורים) | sniff לפי סיומת/קידומת data-URI בלבד |
| Worker transport | עיטורים מסונתזים ב־Worker; רקעי שערים ב־render-time (`page-decorations.js:52-104`) | אין העברת bytes תמונה ל־Worker |
| שילוב בטקסט/הערה | **בלתי-אפשרי** — אין token תמונה (`block-tokenizer.js:41-129`) | תמונה = ערוץ צד בלבד |
| DOM | `dom-renderer` (רקעי CSS, עיטורי SVG) | רסטר: DOM/HTML בלבד |
| PDF | `pdf-writer.js:458-465` — **"raster images not drawn — documented"**; SVG דרך ops משותפים (`ornament-ink.js`) | **רסטר לא מיוצא ל-PDF**; תוכן עמודים מותאמים לא מוקרן כלל |

**נקודות אובדן תמונה (דירוג):** (1) ייבוא DOCX משמיט `word/media/*` בשקט (`docx-import.js`); (2) רסטר ועמודים מותאמים חסרים ב־PDF בעודם מוצגים ב־DOM/HTML; (3) `images[]` בחבילת הרחבות מאומת (כולל alt) אך **לא מחובר** להגדרות/עימוד (`app-shell.js:225-243`); (4) `assets-import`/`theme-sets.activateThemeSet` מתים; (5) אין מדידת מידות אמיתית; (6) `media:null` blob-attachment בלי צרכן; (7) רישומי UI/Worker עלולים להתפצל בשקט בכשל רישום (`imud-library.js:245-247`).

## 7. טווחי גופן (משימה ו׳)

| נושא | מיקום | מצב |
|---|---|---|
| תחביר | `[...טקסט...ם]` — `bracket-scanner.js` + סוגריים מרובעים עם סוגר `]ם` | מקוטע למילים בפרשנות |
| ירושה | `resolveStack` (`measure-api`) — המשפחה המוטמעת הראשונה במחסנית (D-86) | נפילה מתועדת לטבלה כשאין גופן |
| Fallback | קטלוג מורחב 1,315 משפחות — מוצג אך לא מוטמע (D-87) | ב־PDF מושטח ל־/F1; מדידת קירוב 0.6em/תו (`pipeline.js:217-218`) |
| כותרות/הערות | `heading-0-size-pt`, `first-word-font` (חלון — /F2), גוף הערה /F5, הערות-צד /F6 | לפי תפקיד, לא לפי מקטע בתוך מילה |
| **מילה עם כמה מקטעי גופן** | — | **בלתי-אפשרית**: מילה = מחרוזת אחת; family ברמת שורה/בלוק. מה שכן קיים תוך-מילה: **גודל** בלבד (סוגריים/סגנון מותאם/חלון 1.5×) דרך סנטינל PUA (`pipeline.js:478-480,533-547`). ערוץ fontKey לפי-מילה מוכיח שהיכולת ההנדסית קיימת (`geometry-projector.js:730-736` → `pdf-writer.js:348-376`) |
| שימור family אחרי מדידה/שבירה/תכנון/הקרנה | `fontKey` בפרויקציה; תת-קבוצות פר-fontKey בייצוא (`export-api.js:206-420`) | **נשמר לפי-מילה; לא לפי-מקטע** |
| `block.firstWord` | `dropword.js:69` | **מת** בנתיב DP — אפס צרכני רינדור (רק המורשת מיישם מילות-חלון) |

## 8. הערות ועוגנים (משימה ז׳)

- **סוגים:** שוליים (מרזב — שני הנתיבים), צד (`side-notes.js` ב־DP; `marginNotes` במורשת), סיום (`endnote-pages.js`, תחביר `הערת סיום-N -` — D-40).
- **קישור סמן→גוף:** מבני במקור (`note-ref{noteIndex}` — `block-tokenizer.js:118-126`; הקצאה `pipeline.js:483-505`) → **מומר ל-placeholder מחרוזתי** (`${E102}${marker}\uE000${text}` — `pipeline.js:492`, גם `dp-planner.rejectToBody:304-312`) → מפוצח מחדש ב־6+ אתרים (`pipeline.js:908-917/1044-1058`, `markers.js:150-151`, `footnote-budget.js:20`, `geometry-projector.js:448/457/510`, `dom-renderer.js:49`). במורשת: קישור פוזיציונלי `tok#ordinal` (`legacy-imud-flow.js:1631-1673`) — מקור הפסדים מתועד של מיזוגי הערות.
- **נקודות שבירה אפשריות:** NBSP מומס ע"י protectWords (סמן בסוף שורה — מזוהה, לא מתוקן — `protections-matrix.js:163-180`); דילוג-מלא שקט בהתנגשות מספור (`markers.js:126-131`); `MARKER_NOTE_MATCH` פתוח על very_long (י״ז/כ״ג — האודיט עצמו מתאים מחרוזות).
- **גיאומטריה:** כותב יחיד למיקום הערות-צד (`side-notes.js:106-114`) ולעמודי הערות-סיום; pdf-writer צורך מקרין בלבד. **כפול:** פיצול LPT דו-נתיבי ×3 (`footnote-budget.js:66-69`, `dom-renderer.js:277-282`, `geometry-projector.js:427-431`); אומדני גובה הערות ×4; עטיפת דיו של הערות-צד — DOM (דפדפן) ו־PDF (`wrapNoteTokens`) בנפרד; להערות DP **אין y לפי-שורה במודל** (בניגוד למורשת).
- **SIDE_NOTE_OVERLAP עמ' 107 (פתוח ב־baseline):** הבדיקה — `tools/layout-audit/audit-in-page.js:351-357` (DOM) ו־`full-math-audit.js:324-333` (מודל). השערה ראשית (H1): `emitUnit` marginNotes במורשת (`legacy-imud-flow.js:3028-3042`) — עוגנים לראש פסקה, מוערמים בפיץ' 9.6px, **אפס טיפול התנגשות**; 8px/2px = שאריות תת-פיץ'; עמ' 107 נושא 25 הערות-צד. השערה משנית (H2, נתיב DP): `estimateSideNoteHeight` (`side-notes.js:16-36`) מתעלם מ־`counterMark` המוקדם ברינדור ומתעלף ממדדי impl-B. הכרעה דורשת אינסטרומנטציה של עמ' 107 — נרשם כממצא פתוח.
- **ריטריט-לולאה:** נקראת רק מ־`dp-planner.js:532-561`; מתקנת רק column-imbalance (דרך `balancePageSafe` דטרמיניסטי); מקסימום 24 איטרציות; חלון זיהוי תנודה OSCILLATION_WINDOW=4. פינג-פונג אמיתי כמעט בלתי-אפשרי (תיקון אידמפוטנטי); דליפה קטנה: רישומי rollback-compromise פנימיים עוקפים דה-דופ. **אינה רצה במורשת כלל.**

## 9. נקודות אובדן מידע (משימה 1.1-5 — הרשימה המלאה)

> רקע לממצאי האודיט: רצפת הנפח של full-math (353,687<355,967) מתועדת ב־`baseline_stage1/summary.md`; הרגיסטר המלא של החישובים הכפולים הקשורים לנקודות אלה — ב־`ENGINE_DUPLICATION_REGISTER.md` (D1-D15).

1. פסקה → מחרוזות מילים שטוחות; note-refs הופכים למחרוזות סמן (`pipeline.js:465-507`).
2. גוף הערה inline מוטמע בתוך מילה (placeholder E000) ומנותח מחדש כמחרוזת (`pipeline.js:492,908-917,1041-1058`).
3. `rejectToBody` מפרק את ההערה המבנית ומחזיר אותה למילה (`dp-planner.js:295-321`).
4. family גופן ברמת שורה בלבד; סגנון פר-מילה = סנטינל+מקדם אחד; מילה מרובת-גופנים בלתי-ניתנת לייצוג (`pipeline.js:475-480`; `geometry-projector.js:690-701`).
5. ספאני סוגריים בגרנולריות מילה לפי offset התחלה בלבד — מילה חוצת גבול מקבלת סקייל שגוי (`pipeline.js:104-108`).
6. זהות סמן שורדת כטקסט; מספור-מחדש = regex על words (`markers.js:147-167`).
7. `scrubPUAText` ברינדור — בלתי-הפיך (`dom-renderer.js:47`; `geometry-projector.js:702`).
8. שדות מתים: `blk.dh` (`pipeline.js:387`), `block.firstWord` (`dropword.js:69`).
9. קישור מורשת משוחזר ממפתחות מחרוזת `tok#ordinal` (`legacy-imud-flow.js:1446-1474`).
10. טקסט כותרות TOC נגזר מחדש ממילות הפריסה (`pipeline.js:700,888`).
11. ייבוא DOCX משמיט תמונות ועיצוב (`docx-import.js`).
12. קטלוג מורחב לא-מוטמע: family נבחרת מדווחת אך מושטחת בפועל (D-87).
13. טקסט עמודים מותאמים לא מגיע ל־PDF בכלל.
14. alt-טקסט של תמונות הרחבות — מטא-נתונים מתים (`style-schema.js:253-290`).
15. כיווץ v21 של מרווח בסיס — סוגריים מקבלים דגלים גם כשהמילה נושאת סמן מודבק (באג R-03 — `legacy-imud-flow.js:574-577`).
16. מספור עמודי הערות: טוקנים ממוספרים שומרים מספר מקור כעוגן (D-51) — המרה חד-כיוונית.
17. גיליון/כותרות: טקסטים נגזרים מומרים למחרוזות תצוגה בלבד (ללא עוגן מקור).
18. המשכי הערות '(המשך)' — סימון טקסטואלי, לא מזהה מבני.

## 10. מסלולים מתים/מנותקים (ראיות; אין למחוק לפני הוכחה — רשום לשלב 9)

| נתיב | ראיה | סיכון |
|---|---|---|
| מקריני הגאומטריה מחוץ ל־PDF | קריאה יחידה: `export-api.js:98,136,137` | נמשך בכוונה עד שלב 7-8 |
| `kp-linebreak`+שרשרת DP תחת פרופיל imud | הפיצול `pipeline.js:123` | נתיב DP אינו רץ במוצר כברירת מחדל |
| `decoration/assets-import.js` | אין קריאה מחוץ לבדיקות | מועמד למחיקה בשלב 9 או חיבור בשלב 3 |
| `balancing.balancePage` (הישן) | הוחלף ב־optimalSplit/balancePageSafe | מועמד למחיקה |
| `geometry-projector.attachBasases` (attachBaselines) | אפס צרכנים | מועמד למחיקה |
| `shaar-pages.buildPickerModel` + פונקציות theme-sets | בדיקות בלבד | להכרעה בשלב 6 |
| מספור-מחדש עמודי של סמנים | `pipeline.js:605` נבלם ע"י ברירת מחדל 'section' (`settings-registry.js:145`) | נשאר כיכולת |
| `importProjectZip` | Buffer-gated; אין חיבור UI (AMBIGUOUS — נדרש אימות נוסף לפני מחיקה) | לאימות |
| הזרקת `env.*FontBytes` מורשת | חלופה לרישום worker; בדיקות/ייצוא בלבד | נשאר |
| `endnote-pages`/`toc-detail`/`autoQualityPass` | מחוברים אך דלוקים כברירת מחדל | יכולות לגיטימיות |


---

## עדכון שלב 8 פרוסה 1-ביקורת (17.11) — מצבי materialization

| מסלול | מנגנון | מתי פעיל | מדידה? |
|---|---|---|---|
| **production** | `core/materialize.js` דרך `buildPageModel` ({measure, mode:'production'}) | ה-pipeline — כל typeset | **אפס** (probe prototype ב-s8b; פרופיל גופן לבסיסים בלבד — נתוני טבלה) |
| **compat** | אותו מנגנון, קריאה ישירה (API או ברירת מחדל) | בדיקות ותיקות; facade (geometry-projector) לנתיב ה-PDF הוותיק | fallback מודד — **כל נפילה נספרת** (materializeFallbacks) |
| הטבעות | `layout/structural-stamps.js` (TOC/שערים/סלוטים/גיליון/נתיבים/**כותרת endnotes**) | ה-pipeline אחרי ההחלטות, לפני המודל | מדידה אחת לתוכן מבני — לפני ההחלטות הסופיות |

חשבונאות: `model.diagnostics` + `model.meta.materializeFallbacks` + violations (code: materialize-fallback) — כל נפילה בייצור נראית ב-ledger ובבדיקות.
