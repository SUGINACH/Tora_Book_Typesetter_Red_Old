// src/engine/model/adapter.js — adapter יציאה זמני: מודל קנוני → זרם טוקנים (שלב 2)
// **מעמד:** ADAPTER זמני בגבול היציאה (חוזה §4 · תוכנית §2.1-11).
// **מסומן, מוגבל, בעל בדיקות round-trip ותנאי הסרה.**
//
// - מטרה: זרם הטוקנים של ה-DP pipeline (core/pipeline.js) נגזר כעת מהמודל
//   הקנוני — המודל הוא מקור הסמכות בשלב הפענוח; הטוקנים הם תחזית נגזרת.
// - הוכחה: modelToTokens(buildDocumentModel(x)) ≡ tokenize(x) — זהות מלאה
//   (deep-equal) מוכחת בבדיקות על הקורפוסים, כולל סדר, תוכן ומזהי t#.
// - תנאי הסרה: כשתחילת ה-pipeline תצרוך את המודל הקנוני ישירות (שלבים 3–4 —
//   מדידה/שבירה מה-Inline Item Model), ה-adapter יימחק יחד עם מבנה הטוקנים.
// - אין לו להפוך למסלול runtime שני: הוא פונקציה טהורה אחת בגבול, בלי החלטות.
'use strict';

const { BLOCK_KINDS } = require('./kinds');
const { rebuildCanonicalLine } = require('./roundtrip');

/**
 * modelToTokens — בונה את זרם הטוקנים ההיסטורי מהמודל הקנוני.
 * הפונקציה טהורה ודטרמיניסטית: אין מצב מודול-גלובלי (מונה הטוקנים מקומי לקריאה
 * באמצעות closure), המודל המקורי אינו משתנה (ההערות מועברות ל-rebuildCanonicalLine
 * כפרמטר model מפורש — ממשק קיים), וסדר הפליטה זהה לסדר הטוקניזר המקורי.
 * @param {object} model — פלט buildDocumentModel
 */
function modelToTokens(model) {
  // טוהר: מונה הזהויות מקומי לקריאה — קריאות מקבילות/חוזרות/משולבבות אינן
  // משפיעות זו על זו, והזהויות זהות לטוקניזר הישיר (t1, t2, …).
  let tokenSeq = 0;
  const mkToken = (type, payload) => ({ id: `t${++tokenSeq}`, type, ...payload });
  const notesByBlock = new Map();
  for (const n of model.notes || []) {
    if (!notesByBlock.has(n.parentId)) notesByBlock.set(n.parentId, []);
    notesByBlock.get(n.parentId).push(n);
  }
  const tokens = [];
  for (const blk of model.blocks) {
    if (blk.kind === BLOCK_KINDS.EDITORIAL) {
      for (const seg of blk.syntax.editorialSegments || []) {
        tokens.push(mkToken('editorial', { text: seg.text.slice(2, -2), removed: true }));
      }
      continue;
    }
    if (blk.kind === BLOCK_KINDS.HEADING) {
      const raw = rebuildCanonicalLine(blk);
      const text = blk.items.length && blk.items[0].kind === 'text' ? blk.items[0].payload.text : blk.payload.text;
      tokens.push(mkToken('heading', { level: blk.level, text, raw }));
      continue;
    }
    if (blk.kind === BLOCK_KINDS.ENDNOTE) {
      const raw = rebuildCanonicalLine(blk);
      const text = blk.items.length && blk.items[0].kind === 'text' ? blk.items[0].payload.text : blk.payload.text;
      // סדר השדות זהה לטוקניזר (num?, text, raw) — זהות מלאה כולל סדר מפתחות.
      const payload = blk.num != null ? { num: blk.num, text, raw } : { text, raw };
      tokens.push(mkToken('endnote', payload));
      continue;
    }
    if (blk.kind === BLOCK_KINDS.ENDNOTE_CLASS) {
      const raw = rebuildCanonicalLine(blk);
      tokens.push(mkToken('endnote-class', { title: blk.payload.title, raw }));
      continue;
    }
    if (blk.kind === BLOCK_KINDS.PARAGRAPH) {
      // סדר הפליטה: תחילה טוקני editorial של השורה (כמו הטוקניזר), ואז הפסקה.
      for (const seg of blk.syntax.editorialSegments || []) {
        tokens.push(mkToken('editorial', { text: seg.text.slice(2, -2), removed: true }));
      }
      const parts = [];
      const notes = [];
      const noteIndexByRef = new Map();
      const blkNotes = notesByBlock.get(blk.id) || []; // טוהר: חיפוש מקומי — בלי שינוי המודל
      // השורה הקנונית המשוחזרת — ערכי החלקים נחתכים ממנה (כמו הטוקניזר:
      // הטקסט כולל תחביר סמני הגופן/תמונות שטרם נצרך ישירות במסלול ה-DP).
      const lineText = rebuildCanonicalLine(blk, model); // הערות כפרמטר מפורש
      for (const rec of blk.syntax.partRecords || []) {
        if (rec.kind === 'text') {
          parts.push({ kind: 'text', value: lineText.slice(rec.start, rec.end) });
        } else {
          const note = blkNotes.find(n => n.id === rec.noteRef);
          if (!note) throw new Error(`adapter: note body missing for ${rec.noteRef}`);
          if (!noteIndexByRef.has(note.id)) {
            noteIndexByRef.set(note.id, notes.length);
            notes.push(note.payload.atomicText);
          }
          parts.push({ kind: 'note-ref', noteIndex: noteIndexByRef.get(note.id) });
        }
      }
      const raw = rebuildCanonicalLine(blk, model);
      tokens.push(mkToken('paragraph', { parts, notes, unmatchedClosers: blk.syntax.unmatchedClosers || [], raw }));
      continue;
    }
    throw new Error(`adapter: unsupported block kind ${blk.kind}`);
  }
  return tokens;
}

/** השוואת שקילות מלאה של שני זרמי טוקנים (לבדיקות בלבד). */
function tokensEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { modelToTokens, tokensEqual, ADAPTER_REMOVAL_CONDITION: 'שלבים 3–4: כשה-pipeline יצרוך את המודל הקנוני ישירות (מדידה/שבירה מ-Inline Item Model), ה-adapter ומבנה הטוקנים יימחקו יחד.' };
