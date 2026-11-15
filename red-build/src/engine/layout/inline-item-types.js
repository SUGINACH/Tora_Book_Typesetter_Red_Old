// src/engine/layout/inline-item-types.js — shared registration entry for project inline items (S14)
// This module is deliberately imported by the headless pipeline, browser UI and engine Worker.
// Add each project item module exactly once below. The module is evaluated independently in
// each JavaScript realm, so its parser/measure/DOM/PDF callbacks are registered where needed.
// Never send callbacks through postMessage: Worker messages carry data, not executable code.
'use strict';

// To add a project item, create a module under src/engine/layout/inline-items/
// and add its import here (once). That module calls registerInlineItemType(kind, descriptor).
// Keep its parser deterministic and its measurement independent of the DOM.
module.exports = {};
