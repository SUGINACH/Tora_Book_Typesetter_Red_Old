// src/engine/model/roundtrip.js — שחזור המקור מהמודל הקנוני (שלב 2)
// **חוזה:** spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §2.3 — "round-trip אינו מאבד
// תווים, סדר, עוגנים, גופנים או asset identity".
//
// ההוכחה כאן מבנית, לא ויזואלית: את המקור בונים מחדש מהפריטים, מהתחביר
// ומרשומות התמורה בלבד — השוואה תו-מול-תו מוכיחה שלא אבד דבר.
'use strict';

const { BLOCK_KINDS } = require('./kinds');

/**
 * בניית השורה הקנונית של בלוק מתוך פריטיו ותחבירו בלבד.
 * כל מיקום בשורה מכוסה בדיוק פעם אחת: טקסט פריט / תוחם הערה / סמן גופן /
 * רווח בין-חלקי / קידומת כותרת. כיסוי חסר או כפול = שגיאת כיסוי (throw) —
 * לעולם לא השלמה שקטה.
 * @param {object} block
 * @param {object} [model] — לחיפוש גופי ההערות של הבלוק (או block._notes שהוזרק)
 * @returns {string} השורה הקנונית (אחרי הסרת editorials בפסקאות)
 */
function rebuildCanonicalLine(block, model) {
  const pieces = []; // {start, text, what}
  const add = (start, text, what) => {
    if (typeof text !== 'string' || text.length === 0) return;
    pieces.push({ start, text, what });
  };
  const syntax = block.syntax || {};

  if (block.kind === BLOCK_KINDS.HEADING || block.kind === BLOCK_KINDS.ENDNOTE) {
    add(syntax.prefix.start, syntax.prefix.text, 'prefix');
    const t0 = block.kind === BLOCK_KINDS.HEADING ? syntax.titleSpan.start : syntax.textSpan.start;
    const t1 = block.kind === BLOCK_KINDS.HEADING ? syntax.titleSpan.end : syntax.textSpan.end;
    for (const ms of syntax.markerSpans || []) add(ms.start, ms.text, 'font-marker');
    for (const it of block.items) {
      if (it.kind === 'text') {
        for (const run of it.payload.runs) add(run.sourceStart, run.text, 'run');
      } else {
        add(it.sourceRange.start - block.source.canonicalBase, it.sourceText, it.kind);
      }
    }
    return splicePieces(pieces, t1, block);
  }
  if (block.kind === BLOCK_KINDS.ENDNOTE_CLASS) {
    add(syntax.prefix.start, syntax.prefix.text, 'prefix');
    add(syntax.titleSpan.start, block.payload.title, 'title');
    return splicePieces(pieces, syntax.titleSpan.end, block);
  }
  if (block.kind === BLOCK_KINDS.EDITORIAL) {
    return ''; // השורה הקנונית ריקה — הכל הוסר; ההיפוך משחזר את pre
  }
  if (block.kind === BLOCK_KINDS.PARAGRAPH) {
    for (const g of syntax.gaps || []) add(g.start, g.text, 'gap');
    for (const ms of syntax.markerSpans || []) if (!ms.inNote) add(ms.start, ms.text, 'font-marker');
    for (const nd of syntax.noteDelims || []) { add(nd.openStart, nd.openText, 'note-open'); add(nd.closeStart, nd.closeText, 'note-close'); }
    for (const rec of syntax.partRecords || []) {
      if (rec.kind !== 'note-ref') continue;
      const note = blockNotesOf(block, model).find(n => n.id === rec.noteRef);
      if (!note) throw new Error(`roundtrip: note body missing for noteRef ${rec.noteRef}`);
      add(note.sourceRange.start - block.source.canonicalBase, note.sourceText, 'note-inner');
    }
    for (const it of block.items) {
      if (it.kind === 'text') {
        for (const run of it.payload.runs) add(run.sourceStart, run.text, 'run');
      } else if (it.kind !== 'noteMarker') {
        add(it.sourceRange.start - block.source.canonicalBase, it.sourceText, it.kind);
      }
      // noteMarker עצמו מכוסה על ידי התוחמים + התוכן הפנימי — לא מוסיפים כאן.
    }
    return splicePieces(pieces, block.source.canonicalLength, block);
  }
  throw new Error(`roundtrip: unsupported block kind ${block.kind}`);
}

function blockNotesOf(block, model) {
  if (block._notes) return block._notes;
  if (model && Array.isArray(model.notes)) return model.notes.filter(n => n.parentId === block.id);
  return [];
}

/** מיון ושרשור חתיכות לפי מיקום — עם בדיקת כיסוי מלא וחד-חד-ערכי. */
function splicePieces(pieces, expectedEnd, block) {
  pieces.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const p of pieces) {
    if (p.start < cursor) throw new Error(`roundtrip: overlapping pieces at ${p.start} (${p.what}) in block ${block.id}`);
    if (p.start > cursor) throw new Error(`roundtrip: uncovered gap ${cursor}..${p.start} in block ${block.id}`);
    out += p.text;
    cursor = p.start + p.text.length;
  }
  if (cursor !== expectedEnd) throw new Error(`roundtrip: coverage ends at ${cursor}, expected ${expectedEnd} in block ${block.id}`);
  return out;
}

/** היפוך שלב ב׳ (הסרת editorials + צמצום רווחים + שוליים): canonical → pre. */
function invertStage2(canonical, stage2, preLength) {
  if (!stage2 || !stage2.removedSegments || stage2.removedSegments.length === 0) {
    if (canonical.length !== preLength) throw new Error('roundtrip: no-editorial line length mismatch');
    return canonical;
  }
  const canonOfPre = new Array(preLength).fill(null);
  for (let cp = 0; cp < stage2.charMap.length; cp++) canonOfPre[stage2.charMap[cp]] = cp;
  const inSeg = new Array(preLength).fill(false);
  for (const seg of stage2.removedSegments) for (let k = seg.start; k < seg.end; k++) inSeg[k] = true;
  const droppedAt = new Map();
  for (const d of stage2.droppedWs || []) for (let k = d.start; k < d.end; k++) droppedAt.set(k, d);
  let pre = '';
  for (let p = 0; p < preLength; p++) {
    if (inSeg[p]) {
      const seg = stage2.removedSegments.find(s => s.start === p);
      pre += seg.text;
      p = seg.end - 1;
      continue;
    }
    if (droppedAt.has(p)) {
      const run = droppedAt.get(p);
      pre += run.text;
      p = run.end - 1;
      continue;
    }
    const cp = canonOfPre[p];
    if (cp === null) throw new Error(`roundtrip: pre position ${p} uncovered by any record`);
    pre += canonical[cp];
  }
  return pre;
}

/** היפוך שלב א׳ (trim + נרמול 1:1): pre → שורת המקור הגולמית. */
function invertStage1(pre, stage1) {
  let out = pre;
  // נרמול הפוך — רשומות מסודרות לפי offset עולה; מהסוף כדי שמיקומים לא יזוזו.
  const edits = [...(stage1.normalizations || [])].sort((a, b) => a.offset - b.offset);
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (out[e.offset] === e.normalized) out = out.slice(0, e.offset) + e.original + out.slice(e.offset + 1);
    else throw new Error(`roundtrip: normalization inverse mismatch at ${e.offset}`);
  }
  return (stage1.rawLeadText || '') + out + (stage1.rawTrailText || '');
}

/**
 * שחזור המסמך המלא מהמודל — תו-מול-תו.
 * @param {object} model — פלט buildDocumentModel (חייב _notesByBlock פנימי או notes)
 */
function reconstructSource(model) {
  const notesByBlock = new Map();
  for (const n of model.notes || []) {
    if (!notesByBlock.has(n.parentId)) notesByBlock.set(n.parentId, []);
    notesByBlock.get(n.parentId).push(n);
  }
  const blockBySkeleton = new Map();
  for (const b of model.blocks) blockBySkeleton.set(b.lineIndex, b);

  const lineCount = model.source.lineMap.length;
  const lines = new Array(lineCount).fill(null);
  for (const sk of model.source.skeleton) {
    if (sk.kind === 'metadata') {
      const entry = model.metadata.entries.find(e => e.lineIndex === sk.lineIndex);
      if (!entry) throw new Error(`roundtrip: metadata entry missing for line ${sk.lineIndex}`);
      lines[sk.lineIndex] = { text: entry.sourceText, eol: eolOf(model, sk.lineIndex) };
    } else if (sk.kind === 'blank') {
      // שורה ריקה — השוליים המקוריים שמורים בתמורת שלב א׳ של הבלוק הבא? לא:
      // שורות ריקות קיבלו stage1 משלהן ב-tokenizeDetailed; המודל שומר אותן
      // ברשומות השלד עם הטקסט המדויק (השדה blankText נבנה ב-buildDocumentModel).
      const rec = model.source.blankLines && model.source.blankLines.get(sk.lineIndex);
      lines[sk.lineIndex] = { text: rec != null ? rec : '', eol: eolOf(model, sk.lineIndex) };
    } else if (sk.kind === 'body') {
      const blk = blockBySkeleton.get(sk.lineIndex);
      if (!blk) throw new Error(`roundtrip: block missing for body line ${sk.lineIndex}`);
      blk._notes = notesByBlock.get(blk.id) || [];
      const canonical = rebuildCanonicalLine(blk);
      const pre = invertStage2(canonical, blk.source.stage2, blk.source.preLength);
      const rawLine = invertStage1(pre, blk.source);
      lines[sk.lineIndex] = { text: rawLine, eol: eolOf(model, sk.lineIndex) };
    }
  }
  let out = '';
  for (let i = 0; i < lineCount; i++) {
    if (!lines[i]) throw new Error(`roundtrip: line ${i} not covered by skeleton`);
    out += lines[i].text + (i < lineCount - 1 ? (lines[i].eol || '\n') : '');
  }
  return out;
}

function eolOf(model, lineIndex) {
  const rec = model.source.lineMap[lineIndex];
  return rec ? (rec.eol || '\n') : '\n';
}

module.exports = { rebuildCanonicalLine, reconstructSource, invertStage1, invertStage2, splicePieces };
