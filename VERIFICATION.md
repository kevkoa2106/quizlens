# Verification

## Latest local run

Verified on macOS with Python 3.13, Node 24, and Tesseract: 32 Python tests, 7 JavaScript unit tests, and 21 browser tests pass. One optional real-Laya checkpoint test is skipped. The pinned test dependencies resolve from the package index for a fresh installation.

## Test coverage

The Python suite checks question validation, balanced Laya answer ordering, score validity, tied choices, OCR on the supplied quiz fixtures, image preparation, local API requests, structured JSON, truncated responses, answer identity, authentication, origin checks, provider dispatch, body limits, and visible processing errors.

JavaScript unit tests check input parsing, validation, request authentication, network/timeout errors, toolbar behavior, and the minimal capture permissions.

Browser tests execute DOM capture against real page fixtures. They cover nested tiles, arithmetic, wrapped text, hidden/offscreen/private content, visual ordering, open shadow roots, and incomplete captures. Panel tests cover automatic comparison, settings persistence, edits during requests, image preview/upload, unsafe text rendering, one chosen answer for tied scores, errors, narrow widths, light/dark appearance, and keyboard activation. A separate test loads the actual extension worker and panel.

GitHub Actions runs the suites on pushes and pull requests. The optional real-checkpoint test requires `LAYA_INTEGRATION=1` and is excluded from routine CI.

## Verification limits

Panel tests simulate Chrome capture APIs and model responses. They do not exercise a toolbar permission grant on a live quiz website. DOM fixtures verify the extraction rules, but a particular site can use a layout they do not cover.

The local API adapter is tested using real loopback HTTP servers with simulated completions. These tests do not establish a particular model's accuracy, latency, or vision capabilities. A loaded vision model must be checked separately.

## Interface review

The chosen answer is the result panel's focal point. Original A/B/C labels preserve answer identity when scores are ranked. The green accent marks actions and the chosen answer; system fonts support small-panel reading. Spacing separates settings, captured text, and results. Native controls, visible focus, status announcements, and the system light/dark preference support keyboard use.

The interface uses restrained emphasis, consistent reading order, and no decorative motion: ENERGY 1 / RHYTHM 1 / MOTION 1. This publication update changes the product name and documentation, without redesigning the existing layout.

## Publication review

- Copy PASS: the README names actual features, setup steps, and limitations; it contains no invented usage, accuracy, or performance claims.
- Functionality PASS: local tests cover capture, comparison, settings, uploads, error recovery, and stale-result handling. No decorative controls were added.
- Layout PASS: the browser suite checks a 280-pixel panel width, both system color schemes, and keyboard activation. The existing layout is retained.
- Attribution PASS: project files and the initial commit are checked for unwanted attribution and local workspace paths before publication. Upstream Laya credit remains in THIRD_PARTY.md.
- Repository hygiene PASS: environments, model caches, downloaded vendor source, logs, local settings, and generated test reports are excluded. Test fixtures and source files are included.
