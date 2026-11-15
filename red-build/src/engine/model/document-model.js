// src/engine/model/document-model.js — בניית מודל מסמך קנוני (שלב 2)
// **חוזה:** spec/03_UNIFIED_ITEM_CONTRACT.md §2-§5 · spec/00_CURRENT_ENGINE_COMPLETION_PLAN.md §2.1.
//
// מודל פריטים אחד → צינור עימוד אחד → מדידה ושבירה פעם אחת → Planner אחד → PageModel יחיד → מקרינים טהורים.
//
// עקרונות:
// 1. אין כאן פרסר חדש — המודל נבנה מהפלט המפורט של הפרסר הקיים
//    (dfa-lexer.lexDocument + block-tokenizer.tokenizeDetailed). הפרסר לא נכתב מחדש.
// 2. אין החלטות מיקום/מדידה — המודל מבני בלבד; גאומטריה נקבעת בשלבים 3–7.
// 3. זהות דטרמיניסטית מהמקור — אין מוני ריצה בזהות (המונה t# של זרם הטוקנים
//    הוא נגזרת של adapter היציאה בלבד, לא זהות המודל).
// 4. שימור מלא: לכל פריט sourceRange + sourceText; לכל שורה תמורה הפיכה;
//    נרמול התווים נשמר כרשומות 1:1 (היפוך מדויק).
// 5. קישור הערות מבני: noteMarker.noteRef ⇄ noteBody.markerRef — לא חיפוש טקסט.
// 6. אין השמטה שקטה: כל חריגה (תוחם לא תואם, טווח גופן חוצה, תמונה בלתי
//    נתמכת) מתועדת ב-diagnostics של הפריט/הבלוק/המסמך.
'use strict';

const { lexDocument } = require('../parser/dfa-lexer');
const { tokenizeDetailed, contentHash, ATOMIC_SPACE } = require('../parser/block-tokenizer');
const { parseInlineRuns } = require('../parser/inline-content');
const { documentId, blockId, itemId, noteId, anchorId, assetId, stableHash } = require('./identity');
const { BLOCK_KINDS, ITEM_KINDS, PARTICIPATION, SPLIT_POLICIES } = require('./kinds');

/** מפת שורות המקור (אחרי איחוד CRLF→LF) — תשתית עוגני המקור. */
function buildLineMap(rawText) {
  const unified = String(rawText).replace(/\r\n?/g, '\n');
  const lineMap = [];
  let u = 0;       // מיקום בטקסט המאוחד
  let o = 0;       // מיקום במקור הגולמי
  const ulines = unified.split('\n');
  for (let i = 0; i < ulines.length; i++) {
    const ln = ulines[i];
    const isLast = i === ulines.length - 1;
    const originalEnd = o + ln.length;
    const hadCr = !isLast && String(rawText).startsWith('\r\n', originalEnd);
    lineMap.push({
      index: i,
      start: u, end: u + ln.length,
      originalStart: o, originalEnd,
      eol: isLast ? '' : (hadCr ? '\r\n' : '\n')
    });
    u += ln.length + 1;
    o += ln.length + (hadCr ? 2 : 1);
  }
  return { unified, lineMap, unifiedLength: unified.length };
}

/** אינדקס תחילת השורה בקואורדינטות המאוחדות לפי אינדקס שורה. */
function lineStartOf(lineMap, lineIndex) {
  const rec = lineMap[lineIndex];
  if (!rec) throw new RangeError(`document-model: line index out of range: ${lineIndex}`);
  return rec.start;
}

/**
 * ריצות inline של חלק טקסט → פריטים קנוניים.
 * ריצות טקסט רצופות מתמזגות לפריט text אחד עם runs[] (חוזה §3); תמונות
 * ופריטים מותאמים הופכים פריטים עצמאיים. טווחי הגופן נשמרים כמקטעים
 * סמנטיים עם family identity ומיקום מקור מדויק — מילה אחת עם כמה גופנים
 * אינה מצטמצמת למחרוזת שטוחה.
 */
/** האם פריט טקסט מרובה-מקטעים מכיל יותר ממשפחת גופן אחת. */
function textRunsHasFamily(runs) {
  return runs.some(r => r.fontFamily);
}

function runsToItems(parsed, parentId, baseOffset, ordinalBase, canonicalBase, diagnostics) {
  const items = [];
  let ordinal = ordinalBase;
  let textRuns = null; // ריצות טקסט רצופות שממתינות לסגירה
  const flushText = () => {
    if (!textRuns) return;
    const start = textRuns[0].sourceStart;
    const end = textRuns[textRuns.length - 1].sourceEnd;
    const first = textRuns[0];
    items.push({
      id: itemId(parentId, ITEM_KINDS.TEXT, ordinal++, start, end),
      kind: ITEM_KINDS.TEXT,
      parentId,
      order: ordinal - 1,
      sourceRange: { start: canonicalBase + start, end: canonicalBase + end },
      sourceText: textRuns.map(r => r.text).join(''),
      payload: {
        text: textRuns.map(r => r.text).join(''),
        runs: textRuns.map(r => ({
          text: r.text,
          fontFamily: r.fontFamily || null,
          sourceStart: r.sourceStart,
          sourceEnd: r.sourceEnd,
          role: r.fontFamily ? 'fontRange' : null
        }))
      },
      styleRef: textRunsHasFamily(textRuns)
        ? { family: null, resolvedBy: 'per-run', inherits: false, multiFamily: true }
        : { family: null, resolvedBy: 'body-default', inherits: true },
      constraints: { atomic: false, participates: PARTICIPATION.INLINE, splittable: SPLIT_POLICIES.LINE },
      diagnostics: []
    });
    textRuns = null;
  };
  for (const run of parsed.runs) {
    if (run.kind === 'text') {
      // רצף טקסט רצוף = פריט text אחד עם runs[] מרובים; כל מקטע שומר את
      // family identity שלו (חוזה §3) — מילה עם כמה גופנים אינה מתמזגת למחרוזת שטוחה.
      if (textRuns && textRuns[textRuns.length - 1].sourceEnd <= run.sourceStart) {
        textRuns.push(run);
      } else {
        flushText();
        textRuns = [run];
      }
      continue;
    }
    flushText();
    if (run.kind === 'image') {
      items.push({
        id: itemId(parentId, ITEM_KINDS.IMAGE, ordinal++, run.sourceStart, run.sourceEnd),
        kind: ITEM_KINDS.IMAGE,
        parentId,
        order: ordinal - 1,
        sourceRange: { start: canonicalBase + run.sourceStart, end: canonicalBase + run.sourceEnd },
        sourceText: run.sourceText,
        payload: {
          assetId: assetId(run.resourcePath),
          resourcePath: run.resourcePath,
          align: run.align || null,
          widthPct: run.widthPct != null ? run.widthPct : null,
          naturalWidth: null, naturalHeight: null, aspectRatio: null,
          fit: null, altText: null,
          // שלב 3 (AssetResolver) ימלא מידות טבעיות ומדיניות fit — החוזה כאן.
          resolution: { stage: 3, pending: ['naturalWidth', 'naturalHeight', 'aspectRatio', 'fit'] }
        },
        styleRef: null,
        constraints: { atomic: true, participates: PARTICIPATION.INLINE, splittable: SPLIT_POLICIES.NEVER, overflow: 'move' },
        diagnostics: [{ code: 'asset-dimensions-pending-stage3', message: 'מידות הנכס ייפתרו בשלב 3 (AssetResolver); הזהות והמקור כבר קבועים.' }]
      });
      continue;
    }
    // פריט מותאם (מה-registry) — kind:custom:* כפי שנרשם.
    items.push({
      id: itemId(parentId, run.kind, ordinal++, run.sourceStart, run.sourceEnd),
      kind: run.kind,
      parentId,
      order: ordinal - 1,
      sourceRange: { start: canonicalBase + run.sourceStart, end: canonicalBase + run.sourceEnd },
      sourceText: run.sourceText || null,
      payload: run,
      styleRef: null,
      constraints: { atomic: true, participates: PARTICIPATION.INLINE, splittable: SPLIT_POLICIES.NEVER },
      diagnostics: []
    });
  }
  flushText();
  for (const w of parsed.warnings || []) {
    diagnostics.push({ code: w.code, start: w.start, end: w.end, message: w.message, severity: 'warning' });
  }
  return { items, nextOrdinal: ordinal };
}

/** טווחי תחביר הגופן שנשמרו בפרסר ה-inline (לשחזור מדויק). */
function markerSyntaxSpans(parsed) {
  // parseInlineRuns מחזיר markerSpans: המיקומים המדויקים שהוסרו (סמני גופן).
  return (parsed.markerSpans || []).map(ms => ({ start: ms.start, end: ms.end, text: ms.text, purpose: 'font-range' }));
}

/**
 * buildDocumentModel — הכניסה היחידה לבניית המודל הקנוני.
 * @param {string} rawText — מקור המסמך הגולמי
 * @param {object} [opts]
 *   - parseOpts: { endnotePrefix, fnOpen, fnClose } (כמו הפייפליין)
 *   - inlineOptions: אפשרויות פרסר ה-inline (fontMarkers/knownFamilies/availableFamilies)
 *   - declarations: { customStyles?, customPages?, inlineFontStyles? } — הצהרות מסמך מההגדרות
 */
function buildDocumentModel(rawText, opts = {}) {
  const parseOpts = opts.parseOpts || {};
  const { unified, lineMap } = buildLineMap(rawText);
  const docId = documentId(rawText);
  const diagnostics = [];

  const lexResult = opts.lexResult && opts.lexResult.bodyLines
    ? opts.lexResult
    : lexDocument(rawText, parseOpts);
  const detail = opts.detail || tokenizeDetailed(lexResult.bodyLines, parseOpts);
  const inlineOptions = opts.inlineOptions || {};
  const bodyBase = lexResult.bodyLineStart != null ? lexResult.bodyLineStart : 0;

  const blocks = [];
  const notes = [];
  const anchors = [];
  const skeleton = []; // שורות המקור: סיווג + קישור לבלוק/מטא-דאטה
  const blankLines = new Map(); // lineIndex → טקסט הרווחים המקורי המדויק של שורה ריקה
  const blockOrdinalByToken = new Map();
  let partParentId = null;
  let blockOrdinal = 0;

  // ── שורות פתיח (metadata) ──
  const metadataEntries = [];
  for (const ml of (lexResult.metadataLines || [])) {
    const start = lineStartOf(lineMap, ml.lineIndex);
    metadataEntries.push({
      key: ml.key,
      value: ml.value,
      lineIndex: ml.lineIndex,
      sourceRange: { start, end: start + ml.raw.length },
      sourceText: ml.raw
    });
    skeleton.push({ lineIndex: ml.lineIndex, kind: 'metadata', key: ml.key });
  }
  // שורה ריקה שנבלעה במעבר הפתיח→גוף (יש לשמר את תוכנה המדויק — גם רווחים).
  for (const pb of (lexResult.preludeBlanks || [])) {
    skeleton.push({ lineIndex: pb.lineIndex, kind: 'blank' });
    blankLines.set(pb.lineIndex, pb.raw);
  }

  const mkBlock = (lineRec, extra) => {
    const lineIndex = bodyBase + lineRec.bodyLineIndex;
    const lStart = lineStartOf(lineMap, lineIndex);
    const s1 = lineRec.stage1;
    // הטווח הקנוני של השורה (בקואורדינטות המקור המאוחד)
    const canonicalStart = lStart + s1.rawLead + (lineRec.stage2 ? lineRec.stage2.charMap[0] || 0 : 0);
    const canonicalLen = lineRec.kind === 'paragraph' && lineRec.stage2
      ? lineRec.canonicalAfterEditorial.length
      : s1.pre.length;
    const id = blockId(docId, extra.kind, blockOrdinal, canonicalStart, canonicalStart + canonicalLen);
    // בסיס הקואורדינטות: מיקום המסמך של canonical[0] — ההיסט המדויק של השורה
    // (שוליים + תחילת המיפוי אחרי הסרת editorials). כל טווחי הפריטים נגזרים ממנו.
    const canonicalBase = canonicalStart;
    const blk = {
      id, kind: extra.kind,
      parentId: partParentId,
      order: blockOrdinal++,
      lineIndex,
      sourceRange: { docId, start: canonicalStart, end: canonicalStart + canonicalLen },
      source: {
        lineStart: lStart,
        canonicalBase,
        canonicalLength: canonicalLen,
        rawLead: s1.rawLead, rawTrail: s1.rawTrail,
        rawLeadText: s1.rawLeadText, rawTrailText: s1.rawTrailText,
        normalizations: s1.normalizations,
        stage2: lineRec.stage2 || null,
        preLength: s1.pre.length
      },
      items: [],
      syntax: {},
      constraints: {},
      diagnostics: [],
      ...extra
    };
    blocks.push(blk);
    skeleton.push({ lineIndex, kind: 'body', blockId: id });
    if (lineRec.tokenId) blockOrdinalByToken.set(lineRec.tokenId, blk);
    return blk;
  };

  // ── מעבר על שורות הגוף לפי סדר המקור ──
  for (const lineRec of detail.lines) {
    if (lineRec.kind === 'blank') {
      const li = bodyBase + lineRec.bodyLineIndex;
      skeleton.push({ lineIndex: li, kind: 'blank' });
      blankLines.set(li, (lineRec.stage1.rawLeadText || '') + (lineRec.stage1.rawTrailText || ''));
      continue;
    }
    if (lineRec.kind === 'editorial') {
      const blk = mkBlock(lineRec, { kind: BLOCK_KINDS.EDITORIAL, payload: { segments: lineRec.stage2.removedSegments }, removed: true });
      blk.syntax.editorialSegments = lineRec.stage2.removedSegments;
      blk.constraints = { participates: 'none', removed: true };
      for (const seg of lineRec.stage2.removedSegments) {
        blk.diagnostics.push({ code: 'editorial-removed', start: blk.source.start, end: blk.source.end, message: 'סימון ##…## הוסר מהפלט ונשמר לחשבונאות מקור.', severity: 'info' });
      }
      continue;
    }
    if (lineRec.kind === 'heading') {
      const blk = mkBlock(lineRec, {
        kind: BLOCK_KINDS.HEADING,
        level: lineRec.level,
        payload: { text: null, num: null }
      });
      blk.constraints = { keepWithNext: true, participates: PARTICIPATION.BLOCK, splittable: SPLIT_POLICIES.NEVER };
      // תחביר הכותרת (הקידומת «כותרת N - ») נשמר במדויק — טקסט תחביר, לא תוכן.
      blk.syntax.prefix = { start: 0, end: lineRec.spans.title.start, text: lineRec.stage1.pre.slice(0, lineRec.spans.title.start) };
      blk.syntax.titleSpan = lineRec.spans.title;
      // heading level<=1 פותח חלק — parentId של הבאים (כמו currentPart בפייפליין)
      if (lineRec.level <= 1) partParentId = blk.id;
      // פריט הטקסט של הכותרת — כולל טווחי גופן (חוזה: "לרבות... כותרות")
      const t0 = lineRec.spans.title.start;
      const t1 = lineRec.spans.title.end;
      const headingText = lineRec.stage1.pre.slice(t0, t1);
      const parsed = parseInlineRuns(headingText, { ...inlineOptions, sourceOffset: t0, allowImages: false, allowCustomItems: false });
      const built = runsToItems(parsed, blk.id, t0, 0, blk.source.canonicalBase, blk.diagnostics);
      blk.items = built.items;
      blk.payload.text = headingText;
      blk.syntax.markerSpans = markerSyntaxSpans(parsed);
      blk.syntax.inlineParsed = true;
      // עוגן יעד להצלבות (TOC) — זהות יציבה של הכותרת עצמה
      anchors.push({ id: anchorId(docId, `heading:${blk.id}`), kind: 'anchor', targetBlockId: blk.id, note: 'יעד כותרת — עגינה לקישורים פנימיים/TOC (שלב 6+)' });
      continue;
    }
    if (lineRec.kind === 'endnote' || lineRec.kind === 'endnote-numbered') {
      const blk = mkBlock(lineRec, {
        kind: BLOCK_KINDS.ENDNOTE,
        num: lineRec.num != null ? lineRec.num : null,
        payload: { text: null }
      });
      blk.constraints = { participates: PARTICIPATION.BLOCK, splittable: SPLIT_POLICIES.LINE };
      const t0 = lineRec.spans.text.start;
      const t1 = lineRec.spans.text.end;
      const enText = lineRec.stage1.pre.slice(t0, t1);
      const parsed = parseInlineRuns(enText, { ...inlineOptions, sourceOffset: t0, allowImages: false, allowCustomItems: false });
      blk.items = runsToItems(parsed, blk.id, t0, 0, blk.source.canonicalBase, blk.diagnostics).items;
      blk.payload.text = enText;
      blk.syntax.textSpan = lineRec.spans.text;
      blk.syntax.prefix = { start: 0, end: t0, text: lineRec.stage1.pre.slice(0, t0) };
      blk.syntax.markerSpans = markerSyntaxSpans(parsed);
      continue;
    }
    if (lineRec.kind === 'endnote-class') {
      const blk = mkBlock(lineRec, {
        kind: BLOCK_KINDS.ENDNOTE_CLASS,
        payload: { title: null }
      });
      // הוראה — מגדירה כותרת לעמודי ההערות של החלק; אינה תוכן זורם.
      blk.constraints = { participates: PARTICIPATION.PAGE_FURNITURE, directive: 'endnote-pages-title' };
      const t0 = lineRec.spans.title.start;
      const t1 = lineRec.spans.title.end;
      blk.payload.title = lineRec.stage1.pre.slice(t0, t1);
      blk.syntax.titleSpan = lineRec.spans.title;
      blk.syntax.prefix = { start: 0, end: t0, text: lineRec.stage1.pre.slice(0, t0) };
      continue;
    }
    // paragraph
    const blk = mkBlock(lineRec, { kind: BLOCK_KINDS.PARAGRAPH, payload: {} });
    blk.constraints = { participates: PARTICIPATION.BLOCK, splittable: SPLIT_POLICIES.LINE };
    const canon = lineRec.canonicalAfterEditorial;
    const cm = lineRec.stage2 ? lineRec.stage2.charMap : null; // canonical→pre
    const toPre = (ci) => (cm ? cm[ci] : ci);
    const blkDiag = blk.diagnostics;
    const syntax = blk.syntax;
    syntax.partRanges = [];
    syntax.gaps = [];
    syntax.noteDelims = [];
    syntax.markerSpans = [];
    syntax.editorialSegments = lineRec.stage2 ? lineRec.stage2.removedSegments : [];
    syntax.unmatchedClosers = lineRec.unmatchedClosers || [];
    syntax.delimiters = lineRec.delimiters;

    let itemOrdinal = 0;
    let noteOrdinalInBlock = 0;
    let prevEnd = 0;
    const partItems = [];
    const partRecs = [];
    // partRanges שמורים ב-syntax (מיקומים בלבד — הטקסט מגיע מהפריטים)
    for (let pi = 0; pi < lineRec.partRanges.length; pi++) {
      const pr = lineRec.partRanges[pi];
      if (pr.start > prevEnd) syntax.gaps.push({ start: prevEnd, end: pr.start, text: canon.slice(prevEnd, pr.start) }); // רווח בין-חלקי (trim)
      prevEnd = Math.max(prevEnd, pr.end);
      if (pr.kind === 'text') {
        const value = canon.slice(pr.start, pr.end);
        const parsed = parseInlineRuns(value, { ...inlineOptions, sourceOffset: pr.start, allowImages: true });
        const built = runsToItems(parsed, blk.id, pr.start, itemOrdinal, blk.source.canonicalBase, blkDiag);
        for (const it of built.items) {
          it.order = itemOrdinal++;
          partItems.push(it);
        }
        partRecs.push({ kind: 'text', start: pr.start, end: pr.end, itemCount: built.items.length });
        for (const ms of markerSyntaxSpans(parsed)) syntax.markerSpans.push(ms);
      } else {
        // note-ref → פריט סמן אטומי + גוף הערה עם קישור מבני
        const markerIt = {
          id: itemId(blk.id, ITEM_KINDS.NOTE_MARKER, itemOrdinal, pr.start, pr.end),
          kind: ITEM_KINDS.NOTE_MARKER,
          parentId: blk.id,
          order: itemOrdinal++,
          sourceRange: { start: blk.source.canonicalBase + pr.start, end: blk.source.canonicalBase + pr.end },
          sourceText: canon.slice(pr.start, pr.end),
          payload: { noteRef: null, delimiters: { open: canon.slice(pr.openStart, pr.openEnd), close: canon.slice(pr.closeStart, pr.closeEnd) } },
          styleRef: { family: null, resolvedBy: 'note-marker-style', inherits: true },
          constraints: { atomic: true, participates: PARTICIPATION.INLINE, splittable: SPLIT_POLICIES.NEVER, bindToNeighbor: true },
          diagnostics: []
        };
        const innerRaw = canon.slice(pr.innerStart, pr.innerEnd);
        const innerTrimmed = innerRaw.trim();
        const innerLead = innerRaw.length - innerRaw.trimStart().length;
        const innerParsed = parseInlineRuns(innerTrimmed, { ...inlineOptions, sourceOffset: pr.innerStart + innerLead, allowImages: true, allowCustomItems: false });
        const noteIt = {
          id: noteId(blk.id, noteOrdinalInBlock, blk.source.canonicalBase + pr.start, blk.source.canonicalBase + pr.end),
          kind: 'noteBody',
          parentId: blk.id,
          order: noteOrdinalInBlock++,
          sourceRange: { start: blk.source.canonicalBase + pr.innerStart, end: blk.source.canonicalBase + pr.innerEnd },
          sourceText: innerRaw,
          payload: {
            markerRef: markerIt.id,
            atomicText: innerTrimmed.replace(/ +/g, ATOMIC_SPACE),
            body: innerTrimmed,
            runs: innerParsed.runs.filter(r => r.kind === 'text').map(r => ({ text: r.text, fontFamily: r.fontFamily || null, sourceStart: r.sourceStart, sourceEnd: r.sourceEnd }))
          },
          styleRef: { family: null, resolvedBy: 'note-body-style', inherits: true },
          constraints: { participates: PARTICIPATION.INLINE, splittable: SPLIT_POLICIES.LINE },
          continuation: { sharedId: null, policy: 'preserve-identity-on-split' },
          diagnostics: []
        };
        noteIt.continuation.sharedId = noteIt.id;
        markerIt.payload.noteRef = noteIt.id;
        for (const w of innerParsed.warnings || []) noteIt.diagnostics.push({ code: w.code, start: w.start, end: w.end, message: w.message, severity: 'warning' });
        for (const ms of markerSyntaxSpans(innerParsed)) syntax.markerSpans.push({ ...ms, inNote: noteIt.id });
        anchors.push({ id: anchorId(docId, `note:${noteIt.id}`), kind: 'anchor', targetItemId: markerIt.id, targetNoteId: noteIt.id });
        partItems.push(markerIt);
        notes.push(noteIt);
        partRecs.push({ kind: 'note-ref', start: pr.start, end: pr.end, noteRef: noteIt.id });
        syntax.noteDelims.push({
          noteRef: noteIt.id, openStart: pr.openStart, openEnd: pr.openEnd,
          closeStart: pr.closeStart, closeEnd: pr.closeEnd,
          openText: canon.slice(pr.openStart, pr.openEnd), closeText: canon.slice(pr.closeStart, pr.closeEnd)
        });
      }
    }
    if (prevEnd < canon.length) syntax.gaps.push({ start: prevEnd, end: canon.length, text: canon.slice(prevEnd, canon.length) });
    blk.items = partItems;
    syntax.partRecords = partRecs;
    // תוחמים לא תואמים — דיווח מפורש, לעולם לא תיקון שקט (דוקטרינת הסורק)
    for (const uc of syntax.unmatchedClosers) {
      blkDiag.push({ code: 'unmatched-note-closer', pos: uc.pos, form: uc.form, message: uc.note || 'סוגר הערה ללא פותח — דורש אימות מול מקור.', severity: 'warning' });
    }
    continue;
  }

  // ── הצהרות מסמך מההגדרות (זהות יציבה, לא העתקים אלמונים) ──
  // סגנונות מותאמים, עמודים מותאמים וטווחי גופן inline הם חלק ממבנה המסמך
  // (מגיעים דרך ההגדרות/הנכסים) — המודל מתעד אותם עם זהות; הגאומטריה שלהם
  // נקבעת בשלבים 5–7. ריהוט עמוד מנועי (שערים/גיליון/TOC) — ראה coverage.
  const declarations = {};
  if (opts.declarations && Array.isArray(opts.declarations.customStyles)) {
    declarations.customStyles = opts.declarations.customStyles.map(st => ({ styleRef: `custom-style:${st.id}`, styleId: st.id, name: st.name, layoutMode: st.layoutMode }));
  }
  if (opts.declarations && Array.isArray(opts.declarations.customPages)) {
    declarations.customPages = opts.declarations.customPages.map((cp, i) => ({
      id: `page-${stableHash('page', [docId, String(cp.id || `custom-${i + 1}`)])}`,
      sourceId: String(cp.id || `custom-${i + 1}`),
      position: cp.position || null,
      counted: cp.counted !== false
    }));
  }
  if (opts.declarations && Array.isArray(opts.declarations.inlineFontStyles)) {
    declarations.inlineFontStyles = opts.declarations.inlineFontStyles.map(fs => ({
      styleRef: `inline-font:${fs.id}`,
      open: fs.open, close: fs.close, family: fs.family
    }));
  }

  const model = {
    version: 1,
    docId,
    createdAtStage: 2,
    source: {
      unifiedLength: unified.length,
      lineMap: lineMap.map(l => ({ index: l.index, start: l.start, end: l.end, eol: l.eol, originalStart: l.originalStart, originalEnd: l.originalEnd })),
      skeleton,
      blankLines
    },
    metadata: { entries: metadataEntries },
    blocks,
    notes,
    anchors,
    declarations,
    diagnostics,
    parse: {
      contentHash: contentHash(detail.tokens),
      tokenCount: detail.tokens.length,
      lineCount: detail.lines.length,
      delimiters: detail.delimiters
    },
    _detail: detail, // פנימי: לשימוש adapter היציאה (אין לצרוך מבחוץ)
    _lexResult: lexResult
  };
  return model;
}

module.exports = { buildDocumentModel, buildLineMap };
