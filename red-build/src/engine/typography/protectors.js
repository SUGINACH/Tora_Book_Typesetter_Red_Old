// src/engine/typography/protectors.js — NBSP gluing rules (REQ-LB-03) + fixDropWordInColumns port (Gold)
'use strict';

/**
 * הגנות מילים: צמדי NBSP. אם זוג קשור רחב מרוחב הטור — מבטלים את הקשירה (לא גלישה).
 */

// סמן הערה = אות עברית **עם גרש** (א׳) או זוג־אותיות עם גרשיים (אב״) — נדרש סימן מפורש.
// לקח false-positive: לולא דרישת הגרש כל מילה בת אות הייתה נצמדת לשכנתה (הרס טוקניזציה).
const NOTE_MARKER_RE = /([\u05D0-\u05EA]\u05F3|[\u05D0-\u05EA]{1,2}\u05F4)[ \u00A0]+/g;
// **שלב 4 (§4.1-4 — מקור אחד):** רשימת הקיצורים גררה ל-breaks.js של מנוע השורות המאוחד;
// הנתיב המורשת קורא משם — לא עוד העתקים. ערכים זהות ביט.
const { ABBREVIATIONS } = require('../line/breaks');

function glueNoteMarkers(text) {
  // BRZ-11: סמן הערה אינו נשבר מסוף שורה — סמן + המילה שאחריו הופכים יחידת NBSP.
  // דפדוף על NOTE_MARKER_RE (גרש חובה) + look-ahead למילת תוכן; גרשיים→גרש (one-way Z.ai fix).
  return text.replace(NOTE_MARKER_RE, (m, marker) => marker.replace('\u05F4', '\u05F3') + '\u00A0');
}

function glueGershayim(text) {
  // מילה עם גרשיים נשארת שלמה: אין שבירה בתוכה — כבר box אחד (אין רווחים בתוך מילה)
  return text;
}

const ABBREV = ABBREVIATIONS; // מקור יחיד (breaks.js) — ערכים זהות ביט
function glueAbbreviations(text) {
  let out = text;
  for (const a of ABBREV) out = out.split(a + ' ').join(a + '\u00A0');
  return out;
}

/**
 * החלת כל ההגנות על מילות פסקה.
 * @param {string[]} words
 * @param {(t:string)=>number} measure
 * @param {number} colWidthPx
 */
function protectWords(words, measure, colWidthPx) {
  const joined = words.join(' ');
  let s = glueNoteMarkers(joined);
  s = glueGershayim(s);
  s = glueAbbreviations(s);
  // **S5.1 (נפתח והוחזר — ראה ISSUE_REGISTRY #P-1):** \s תופס גם NBSP ולכן
  // פירק את הדבקות glueNoteMarkers/glueGershayim/glueAbbreviations (הפרת
  // BRZ-11 — סמן עלול להישאר בסוף השורה). התיקון — פיצול על /[\t\n ]+/
  // בלבד — אומת בסקירה אך חשף פערי חשבונאות בנתיב ה-DP (marker-mismatch
  // body/assigned בבדיקות הספר-האמת); הוחזר עד סגירתם (ניתוח מלא
  // ב-ISSUE_REGISTRY). החשבונאות ב-pipeline (countKnown, נורמות NBSP)
  // תוקנה בנפרד ונשארת.
  let out = s.split(/\s+/).filter(Boolean);
  // ביטול קשירה אם unit חורג מהטור (Claude §6.2(5))
  out = out.map(w => {
    if (w.includes('\u00A0') && measure(w.replace(/\u00A0/g, ' ')) > colWidthPx) {
      return w.replace(/\u00A0/g, ' ');
    }
    return w;
  });
  // שוב לפצל יחידות שהתבטלו
  const finalWords = [];
  for (const w of out) {
    if (!w.includes('\u00A0')) { finalWords.push(...w.split(' ')); } else finalWords.push(w);
  }
  return finalWords.filter(Boolean);
}

/**
 * fixDropWordInColumns (פורטר מ‑Gold): אם המילה האחרונה בטור "נופלת" לבדה
 * לשורה הבאה באורך <3 אותיות — מושכים אותה חזרה או דוחפים שורה.
 * כאן: החזר true אם בוצע תיקון (הקורא יריץ rerun הגנות).
 *
 * **S5.2 (תיקון 2 — מיזוג ללא בדיקת רוחב):** בעבר המילה נדחפה לשורה הראשונה
 * של הטור הבא (`unshift` + `pop`) ללא מדידה מחדש — השורה המקבלת יכלה לגלוש
 * מהטור (נמדד +1.95..25px בביקורת) ⇒ הדפדפן עוטף מחדש ⇒ טקסט-על-טקסט
 * (מחלקת D-92). כעת: המיזוג נשמר רק אם הרוחב הטבעי הממוזג נכנס ב‑colW−FIT_EPS.
 *
 * **פרוסה 2 (ביטול מדידה חוזרת — §2.3 בביקורת):** הרוחב הממוזג נגזר מה
 * **מדדים שכבר נקבעו** במנוע השורות — שום קריאת מדידה חדשה בשלב התכנון:
 *  - רוחב המילה הנופלת = `last.lineModel.naturalWidthPx` (שורת מילה בודדת —
 *    הרוחב הטבעי שלה הוא רוחב המילה כולל תג הסמן שבה, בדיוק כפי שתוצג);
 *  - רוחב הרווח המפריד = ה-glue הטבעי הראשון של השורה המקבלת
 *    (`nextFirst.lineModel.glue[0].naturalPx` — אותו רווח שהמנוע מדד);
 *  - רוחב השורה המקבלת = `nextFirst.widthPx` (נמדד בשבירה).
 * נתיב המורשת (ללא lineModel) — נפילה חזרה ל-`opts.measure` אם סופק;
 * בלי שניהם אין מיזוג (שמרנות: מי שלא מודד/לא קיבל מדדים לא מוכיח התאמה).
 * @param {Array<Array<object>>} columnLines
 * @param {number} minLen - אורך מינימלי של מילה "נופלת"
 * @param {{measure?:(t:string)=>number, colW?:number, fitEps?:number}} [opts]
 */
function fixDropWordInColumns(columnLines, minLen = 3, opts = {}) {
  const measure = typeof opts.measure === 'function' ? opts.measure : null;
  const colW = Number(opts.colW) || 0;
  // FIT_EPS שמרני — כמו במנוע המורשת ובשבירת השורות (kp-linebreak, D-92-DP)
  const fitEps = Number.isFinite(opts.fitEps) ? opts.fitEps : 0.75;
  let fixed = false;
  for (let c = 0; c < columnLines.length - 1; c++) {
    const lines = columnLines[c];
    const nextFirst = columnLines[c + 1][0];
    if (!lines.length || !nextFirst) continue;
    const last = lines[lines.length - 1];
    // לא ממזגים לתוך כותרת או שורה אחרונה של פסקה (יישור/סופית נשברים),
    // ולא מוציאים מילה משורת כותרת (הכותרת מאבדת את מילתה).
    if (nextFirst.kind === 'heading' || nextFirst.isLast === true) continue;
    if (last.kind === 'heading') continue;
    if (last.words.length === 1 && last.words[0].length < minLen && nextFirst.words.length > 1) {
      // רוחב טבעי ממוזג מהמדדים הקיימים (LineModel) — ורק בהיעדרם, מדידה
      // (נתיב מורשת). התג (MARK_TAG, D-53) כלול ברוחב הטבעי כפי שיוצג.
      let mergedW = null;
      const srcLM = last.lineModel;
      const dstLM = nextFirst.lineModel;
      if (srcLM && dstLM && dstLM.glue && dstLM.glue.length) {
        mergedW = (nextFirst.widthPx || 0) + dstLM.glue[0].naturalPx + (srcLM.naturalWidthPx || 0);
      } else if (measure && colW > 0) {
        const word = String(last.words[0]).replace(/\uE102/g, '').replace(/\u00A0/g, ' ');
        mergedW = (nextFirst.widthPx || 0) + measure(' ') + measure(word);
      }
      if (mergedW == null || mergedW > colW - fitEps) continue; // לא נכנס — המילה נשארת (status quo)
      // משלבים את המילה הנופלת לתוך השורה הראשונה של הטור הבא (גרירה)
      nextFirst.words.unshift(...last.words);
      nextFirst.widthPx = mergedW; // רוחב השורה אחרי המיזוג (נצרך ל-runt/balance)
      lines.pop();
      fixed = true;
    }
  }
  return fixed;
}

module.exports = { protectWords, glueNoteMarkers, glueAbbreviations, fixDropWordInColumns };
