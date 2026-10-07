# Verification

## Latest local run

The backend suite includes 32 passing checks and one optional real-Laya checkpoint test. Provider and browser coverage now includes direct requests, native Ollama, cloud credentials, provider-scoped permissions, browser-side image preparation, and Chrome/Firefox package generation. The linked initial CI failure was an OCR fixture punctuation difference; the existing fix keeps answer text/order assertions while permitting a trailing period.

Version 0.5.0 passed [Linux CI](https://github.com/kevkoa2106/quizlens/actions/runs/37619682656): 32 backend tests, 23 JavaScript tests, and 49 browser tests across Chromium and Firefox. The optional checkpoint test and the Firefox actual-addon smoke test are skipped; the latter is unsupported by Playwright. Mozilla's add-on linter reports zero errors, warnings, or notices for the generated Firefox package. Local macOS Chromium tests pass; the downloaded headless Firefox binary could not start a profile on that host, so Firefox engine verification used Linux CI.

## Test coverage

The Python suite checks question validation, balanced Laya answer ordering, score validity, tied choices, OCR on the supplied quiz fixtures, image preparation, local API requests, structured JSON, truncated responses, answer identity, authentication, origin checks, provider dispatch, body limits, and visible processing errors.

JavaScript unit tests check input parsing, validation, request authentication, network/timeout errors, toolbar behavior, and the minimal capture permissions.

Browser tests execute DOM capture against real page fixtures. They cover nested tiles, arithmetic, wrapped text, hidden/offscreen/private content, visual ordering, open shadow roots, and incomplete captures. Panel tests cover automatic comparison, settings persistence, edits during requests, image preview/upload, unsafe text rendering, one chosen answer for tied scores, errors, narrow widths, light/dark appearance, and keyboard activation. A separate test loads the actual extension worker and panel.

GitHub Actions runs the suites on pushes and pull requests. The optional real-checkpoint test requires `LAYA_INTEGRATION=1` and is excluded from routine CI.

## Verification limits

Panel tests simulate extension capture APIs and model responses. They do not exercise a toolbar permission grant on a live quiz website. DOM fixtures verify the extraction rules, but a particular site can use a layout they do not cover. Chromium loads the actual extension worker and panel. Firefox panel/DOM tests use its real browser engine with simulated extension APIs; Playwright cannot install Firefox add-ons. The Firefox package is checked by build tests and Mozilla's add-on linter. Store signing and permanent Firefox installation are not part of these checks.

Provider tests validate request bodies and headers for LM Studio, Ollama, OpenAI, and Anthropic, including image formats, short JSON prompts, chosen-answer identity, invalid scores, complete constrained JSON, token-limit errors, timeout errors, and credential/endpoint validation. No paid cloud API is called by the tests. These checks do not establish a particular model's accuracy, latency, or vision capabilities.

## Interface review

The chosen answer is the result panel's focal point. Original A/B/C labels preserve answer identity when scores are ranked. The green accent marks actions and the chosen answer; system fonts support small-panel reading. Spacing separates settings, captured text, and results. Native controls, visible focus, status announcements, and the system light/dark preference support keyboard use.

The interface uses restrained emphasis, consistent reading order, and no decorative motion: ENERGY 1 / RHYTHM 1 / MOTION 1. Provider settings show only relevant fields, and cloud choices state where captured data is sent. No decorative controls are added.

## Publication review

- Copy PASS: the README names actual features, setup steps, and limitations; it contains no invented usage, accuracy, or performance claims.
- Functionality PASS: local tests cover capture, comparison, settings, uploads, error recovery, and stale-result handling. No decorative controls were added.
- Layout PASS: the browser suite checks a 280-pixel panel width, both system color schemes, and keyboard activation. The existing layout is retained.
- Attribution PASS: project files and the initial commit are checked for unwanted attribution and local workspace paths before publication. Upstream Laya credit remains in THIRD_PARTY.md.
- Repository hygiene PASS: environments, model caches, downloaded vendor source, logs, local settings, and generated test reports are excluded. Test fixtures and source files are included.
