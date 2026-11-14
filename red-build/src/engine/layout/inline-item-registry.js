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

function entryOf(kind) {
  return adapters.get(kind) || { dom: null, pdf: null, validate: null };
}

function storeIfEmpty(kind, entry) {
  if (entry.dom || entry.pdf || entry.validate) adapters.set(kind, entry);
  else adapters.delete(kind);
}

function registerRenderer(kind, target, renderer) {
  const normalized = validateKind(kind);
  if (target !== 'dom' && target !== 'pdf') {
    throw new TypeError('inline-item-registry: target must be dom or pdf');
  }
  if (typeof renderer !== 'function') {
    throw new TypeError('inline-item-registry: ' + target + ' renderer must be a function');
  }

  const prior = entryOf(normalized);
  if (prior[target] && prior[target] !== renderer) {
    throw new Error('inline-item-registry: renderer already registered for ' + normalized + '/' + target);
  }
  const next = { ...prior, [target]: renderer };
  adapters.set(normalized, next);

  return () => {
    const current = adapters.get(normalized);
    if (!current || current[target] !== renderer) return;
    storeIfEmpty(normalized, { ...current, [target]: null });
  };
}

function registerValidator(kind, validator) {
  const normalized = validateKind(kind);
  if (validator != null && typeof validator !== 'function') {
    throw new TypeError('inline-item-registry: validator must be a function');
  }
  const prior = entryOf(normalized);
  if (prior.validate && prior.validate !== validator) {
    throw new Error('inline-item-registry: validator already registered for ' + normalized);
  }
  adapters.set(normalized, { ...prior, validate: validator || null });
  return () => {
    const current = adapters.get(normalized);
    if (!current || current.validate !== validator) return;
    storeIfEmpty(normalized, { ...current, validate: null });
  };
}

/**
 * Register one custom inline item with both output adapters in a single call.
 *
 * dom(fragment, document, settings) -> DOM Node
 * pdf(fragment, {pxToPt, pageHeightPt, round2}) -> PDF operator string[]
 * validate(fragment) -> true | void; false rejects the item, throw for detail.
 */
function registerInlineItemType(kind, descriptor) {
  const normalized = validateKind(kind);
  if (!descriptor || typeof descriptor !== 'object'
    || typeof descriptor.dom !== 'function'
    || typeof descriptor.pdf !== 'function') {
    throw new TypeError('inline-item-registry: a complete item type requires dom and pdf renderers');
  }
  const prior = entryOf(normalized);
  if (prior.dom || prior.pdf || prior.validate) {
    throw new Error('inline-item-registry: item type already registered: ' + normalized);
  }

  const disposers = [];
  try {
    if (descriptor.validate) disposers.push(registerValidator(normalized, descriptor.validate));
    disposers.push(registerRenderer(normalized, 'dom', descriptor.dom));
    disposers.push(registerRenderer(normalized, 'pdf', descriptor.pdf));
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
  validateInlineItem,
  hasInlineItemType
};
