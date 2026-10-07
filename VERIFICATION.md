# Tests

Version 0.5.0 passed [Linux CI](https://github.com/kevkoa2106/quizlens/actions/runs/37619682656):

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| Python backend | 32 | 1 |
| JavaScript | 23 | 0 |
| Chromium and Firefox | 49 | 1 |

Tests cover DOM capture, provider requests, image handling, authentication, score validation, stale results, keyboard use, and both browser builds. Mozilla's add-on linter found no errors, warnings, or notices.

## Run

Requires Node 24+, Python 3.13, and Tesseract.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
npm ci
npx playwright install chromium firefox
.venv/bin/python -m unittest discover -s tests -v
npm test
npm run package
npm run test:browser
```

After full Laya setup, enable the optional checkpoint test:

```sh
HF_HOME="$PWD/.cache/huggingface" LAYA_INTEGRATION=1 .venv/bin/python -m unittest discover -s tests -v
```

## Scope

- Chromium tests load the actual extension. Firefox tests use its browser engine with simulated extension APIs; Playwright cannot install Firefox add-ons.
- Routine tests simulate model responses and do not call paid APIs or load Laya weights.
- Live-site permission grants, model accuracy, latency, vision support, and Firefox signing are not verified.
