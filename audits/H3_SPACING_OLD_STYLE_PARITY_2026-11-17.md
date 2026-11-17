# H3 spacing — old-version parity correction (2026-11-17)

## Source of truth in the older implementations

The older Orange, Yellow and Green stylesheets consistently define the H3 spanning title as:

- title text: `line-height: 1.22`
- spanning wrapper: `padding: 8px 0 4px`
- wrapper: `margin-bottom: 4px`

The previous 34px line pitch was a mistaken composite: approximately 22px text line-height + 8px top padding + 4px bottom padding. Reusing 34px as the pitch of every wrapped line repeated the wrapper padding on each continuation line.

## Correct geometry

For the legacy H3 font size of 13.5pt:

`lineHeightPx = 13.5 × (96 / 72) × 1.22 ≈ 21.96px`

For an H3 of N wrapped lines:

`totalBlockHeight = 8px top padding + N × lineHeightPx + 4px bottom padding + 4px margin-bottom`

Consequences:

- Adjacent H3 text lines are separated by the actual 1.22 line-height, not 34px.
- The 8px top padding is applied once before the first line.
- The bottom padding and bottom margin are applied once after the last line.
- A one-line H3 retains the former overall 38px block height (within rounding).
- DOM line-height and PDF baseline use the text line-height; the final band box separately includes bottom padding, and flow reserves the margin.

## Code change in PR #32

- `legacy-imud-flow.js`: computes the H3 line pitch from the original font size and 1.22 line-height; places top padding once; includes bottom padding and margin once in block geometry and preflight.
- `dom-renderer.js`: renders the text using `lineHeightPx`, not the larger final band box.
- `legacy-projector.js`: calculates the PDF baseline and text line height from `lineHeightPx`, while keeping the band box height separate.
- `s2-heading3-spacing.test.js`: checks multiline pitch, 8px between last-line text and following content, 4px between band box end and content, and the 38px single-line total.

## Remaining integration requirement

The DP/LineModel path still contains the former 34/38 constants. It is not the currently patched IMUD path and must be brought to this same four-part contract before Stage 8/9 completes runtime migration. Do not describe the DP path as parity-proven until it has equivalent tests for the planner, DOM projection, and PDF projection.

## Verification state

Implementation is in PR #32. CI and browser/PDF deployment verification are pending; no successful live visual verification is claimed in this document.
