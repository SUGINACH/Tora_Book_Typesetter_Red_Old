// src/engine/layout/inline-item-registry.js — one registry for mixed inline item adapters (S14)
'use strict';

const BUILT_IN_KINDS = new Set(['text', 'image', 'anchor', 'glue', 'penalty']);
const adapters = new Map();

function validateKind(kind) {
  if (typeof kind !== 'string' || !kind.trim()) {
    throw new TypeError('inline-item-registry: kind must be a non-empty string');
  }
  const normalized = kind.trim();
  if (BUILT_IN_KINDS.has(normalized)) {
    throw new TypeError('inline-item-registry: built-in item kind cannot be replaced: ' + normalized);
  }
  return normalized;
}

function emptyEntry() {
  return { dom: null, pdf: null, validate: null, parse: null, measure: null };
}

function entryOf(kind) {
  return adapters.get(kind) || emptyEntry();
}

function storeIfEmpty(kind, entry) {
  if (Object.values(entry).some(Boolean)) adapters.set(kind, entry);
  else adapters.delete(kind);
}

function registerAdapter(kind, slot, handler) {
  const normalized = validateKind(kind);
  if (!['dom', 'pdf', 'validate', 'parse', 'measure'].includes(slot)) {
    throw new TypeError('inline-item-registry: unsupported adapter slot: ' + slot);
  }
  if (typeof handler !== 'function') {
    throw new TypeError('inline-item-registry: ' + slot + ' adapter must be a function');
  }

  const prior = entryOf(normalized);
  if (prior[slot] && prior[slot] !== handler) {
    throw new Error('inline-item-registry: ' + slot + ' adapter already registered for ' + normalized);
  }
  adapters.set(normalized, { ...prior, [slot]: handler });

  return () => {
    const current = adapters.get(normalized);
    if (!current || current[slot] !== handler) return;
    storeIfEmpty(normalized, { ...current, [slot]: null });
  };
}

function registerRenderer(kind, target, renderer) {
  if (target !== 'dom' && target !== 'pdf') {
    throw new TypeError('inline-item-registry: target must be dom or pdf');
  }
  return registerAdapter(kind, target, renderer);
}

/**
 * Register one custom inline item with all required output adapters and
 * optional source parser, measurement resolver and pure payload validator.
 *
 * parse(source, index, context) -> null | { consumed:number, item:object }
 * measure(item, context) -> {widthPx,heightPx,...} | complete measured item
 * validate(item, context) -> true | void; false rejects the item, throw for detail.
 * dom(fragment, document, settings) -> DOM Node
 * pdf(fragment, {pxToPt, pageHeightPt, round2}) -> PDF operator string[]
 *
 * A parser claims source only by returning a positive consumed count. The
 * registry then preserves the exact source slice on the canonical item.
 */
function registerInlineItemType(kind, descriptor) {
  const normalized = validateKind(kind);
  if (!descriptor || typeof descriptor !== 'object'
    || typeof descriptor.dom !== 'function'
    || typeof descriptor.pdf !== 'function') {
    throw new TypeError('inline-item-registry: a complete item type requires dom and pdf renderers');
  }
  const prior = entryOf(normalized);
  if (Object.values(prior).some(Boolean)) {
    throw new Error('inline-item-registry: item type already registered: ' + normalized);
  }
  for (const slot of ['validate', 'parse', 'measure']) {
    if (descriptor[slot] != null && typeof descriptor[slot] !== 'function') {
      throw new TypeError('inline-item-registry: ' + slot + ' adapter must be a function');
    }
  }

  const disposers = [];
  try {
    for (const slot of ['validate', 'parse', 'measure', 'dom', 'pdf']) {
      if (typeof descriptor[slot] === 'function') {
        disposers.push(registerAdapter(normalized, slot, descriptor[slot]));
      }
    }
  } catch (error) {
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
    throw error;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
  };
}

function getInlineItemRenderer(kind, target) {
  if (target !== 'dom' && target !== 'pdf') {
    throw new TypeError('inline-item-registry: target must be dom or pdf');
  }
  const entry = adapters.get(kind);
  return entry ? entry[target] : null;
}

function parseInlineItemAt(source, index, context = {}) {
  const text = String(source == null ? '' : source);
  if (!Number.isInteger(index) || index < 0 || index >= text.length) return null;

  const matches = [];
  for (const [kind, entry] of adapters) {
    if (!entry.parse) continue;
    const result = entry.parse(text, index, context);
    if (result == null) continue;
    if (!result || typeof result !== 'object'
      || !Number.isInteger(result.consumed) || result.consumed <= 0
      || index + result.consumed > text.length
      || !result.item || typeof result.item !== 'object'
      || result.item.kind !== kind) {
      throw new TypeError('inline-item-registry: parser for ' + kind + ' must return {consumed,item} with a matching kind');
    }
    matches.push({
      kind,
      consumed: result.consumed,
      item: {
        ...result.item,
        // Source identity belongs to the registry, not the plugin. A parser
        // cannot forge or normalize away the exact command accepted here.
        sourceText: text.slice(index, index + result.consumed)
      }
    });
  }

  if (matches.length > 1) {
    const kinds = matches.map(match => match.kind).sort();
    throw new Error(
      'inline-item-registry: ambiguous parser match at index ' + index + ': ' + kinds.join(', ')
    );
  }
  return matches[0] || null;
}

function measureInlineItem(item, context = {}) {
  if (!item || typeof item !== 'object' || typeof item.kind !== 'string') {
    throw new TypeError('inline-item-registry: item with kind is required');
  }
  const entry = adapters.get(item.kind);
  if (!entry || !entry.measure) return item;
  const measured = entry.measure(item, context);
  if (!measured || typeof measured !== 'object') {
    throw new TypeError('inline-item-registry: measure adapter must return a measured item object');
  }
  return {
    ...item,
    ...measured,
    kind: item.kind,
    id: item.id,
    sourceText: item.sourceText,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd
  };
}

function validateInlineItem(item, context = {}) {
  if (!item || typeof item !== 'object' || typeof item.kind !== 'string') {
    throw new TypeError('inline-item-registry: item with kind is required');
  }
  const entry = adapters.get(item.kind);
  if (!entry || !entry.validate) return true;
  const result = entry.validate(item, context);
  if (result === false) {
    throw new TypeError('inline-item-registry: custom item rejected by validator: ' + item.kind);
  }
  return true;
}

function hasInlineItemType(kind) {
  const entry = adapters.get(kind);
  return !!(entry && entry.dom && entry.pdf);
}

module.exports = {
  registerInlineItemType,
  registerRenderer,
  getInlineItemRenderer,
  parseInlineItemAt,
  measureInlineItem,
  validateInlineItem,
  hasInlineItemType
};
