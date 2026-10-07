# QuizLens

QuizLens reads a multiple-choice question from a browser tab and compares its answers with a model you choose. It works in Google Chrome and Firefox, with a side panel showing the captured text, one chosen answer, and estimates for each option.

Use LM Studio, Ollama, OpenAI, or Anthropic directly from the extension. These providers do not need the QuizLens Python service or a session token. Laya remains available as an optional local Python provider.

## Install

Build the browser packages from source:

```sh
git clone https://github.com/kevkoa2106/quizlens.git
cd quizlens
npm run build
```

Building requires Node 24 or later and uses only its standard library. It creates `dist/chrome` and `dist/firefox` from the shared extension source.

- **Chrome 116+:** open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/chrome`.
- **Firefox 142+:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. This unsigned development installation lasts until Firefox restarts. Permanent Firefox installation requires a signed add-on; the build does not perform store signing.

Click the QuizLens toolbar icon while viewing a quiz tab. Open **Model settings**, choose a provider, enter its model identifier and credentials if needed, and save. The browser asks for access to that provider. Then choose **Capture this tab** to capture and compare automatically.

## Providers

| Provider | What runs | Settings | QuizLens service needed? |
| --- | --- | --- | --- |
| LM Studio / local API | Your local OpenAI-compatible server | Base URL, model identifier, optional API key | No |
| Ollama | Your Ollama server | Base URL, model name, optional proxy key | No |
| OpenAI | OpenAI API | Model identifier and your API key | No |
| Anthropic | Anthropic Messages API | Model identifier and your API key | No |
| Laya | Local Python inference | Laya service token | Yes |

LM Studio's usual base URL is `http://127.0.0.1:1234/v1`. The local API option appends `/chat/completions` to this URL.

Ollama's default base URL is `http://127.0.0.1:11434`. QuizLens uses `/api/chat`, schema output, and `think: false` when non-thinking mode is selected. Some models do not support thinking controls; uncheck that option if your server rejects it.

Ollama requires browser-extension origins to be allowed. Its [official instructions](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama) describe `OLLAMA_ORIGINS`. For example, if running the server from a terminal:

```sh
OLLAMA_ORIGINS='chrome-extension://*,moz-extension://*' ollama serve
```

You can allow just your extension's origin instead. Restart Ollama after changing its configuration. Local URLs are limited to HTTP `localhost` and `127.0.0.1`; the extension rejects redirects and remote custom endpoints.

OpenAI and Anthropic use fixed official HTTPS endpoints. Captured questions and images are sent to the selected provider. API usage may incur charges. Enter a model identifier available to your account; QuizLens does not provision models or manage billing. Your API key stays in the extension's browser session and is sent only to that provider. Switching providers clears the key field to avoid reusing credentials across providers.

The local API adapter requests short structured JSON by default. OpenAI uses Chat Completions with a completion-token budget. Anthropic uses Messages with a JSON-only prompt. Support for image input and structured output depends on the selected model. Truncated or invalid responses produce an error instead of a partial answer.

## Capture and image mode

Text mode reads visible DOM elements and sends the identified question and answer options, not the entire page. It supports nested text, answer grids in visual order, and open shadow roots. Hidden/offscreen content, navigation, and form values are excluded.

Capture automatically compares the question. You can correct the text and choose **Compare answers** again. Editing while a request is running prevents stale results from appearing. QuizLens does not click or submit answers on the page.

For questions drawn into images or canvas, choose **Image (vision model)**. Capturing sends the visible screenshot automatically. Uploading a PNG/JPEG shows a preview and requires **Compare answers**. Images are limited to 12 MB and 20 megapixels, resized to a maximum dimension of 1600 pixels, and encoded as JPEG in the browser. Use a vision-capable model; a model's name alone does not establish image support.

After switching tabs or navigating to another website, click the toolbar icon on the target tab again. Opening the sidebar through the browser's sidebar menu does not grant page access. Internal browser pages cannot be read.

## Optional Laya service

Laya runs through Python, which a browser extension cannot launch by itself. Its local service therefore remains a separate process. The random token prevents ordinary websites from invoking that process. This setup is only for Laya, not for the direct providers.

You need Python 3.13, Git, and Tesseract. On macOS:

```sh
brew install python@3.13 tesseract
sh setup.sh
sh start.sh
```

Keep the service terminal open. Select **Laya (Python service)**, paste its printed token, and save. Setup downloads the Laya checkout at `LAYA_REVISION`; the first inference downloads model weights. Model files are cached under `.cache/`. Laya accepts text only and averages scores across cyclic answer-order permutations.

The backend also retains its optional OCR and local-API endpoints for existing clients, but the extension's direct providers do not use them. The service listens on `127.0.0.1:8765`, requires its token, and accepts Chrome/Firefox extension origins. Restart it after backend updates and enter the new token.

## Estimates and data

The model prompt asks for one best answer with a unique highest estimate. The panel highlights one choice even when the model is uncertain. If scores tie, it uses the model's explicit choice or original option order and labels the result tentative. It preserves reported scores. The 70% threshold is a display rule, not an accuracy measurement; these estimates are not calibrated chances of correctness.

The extension uses temporary `activeTab` access and `scripting` to read the selected tab. Optional host permissions are requested when saving provider settings. It does not request access to every website. Provider calls omit browser cookies and reject redirects. QuizLens has no shared server and does not log captured questions or API keys.

Settings and keys last for the browser session. Images remain in panel memory. Local providers send data to your local server, which may itself be configured to use cloud models; check that server's configuration. OpenAI and Anthropic process requests according to their own account settings and policies.

DOM capture uses naming and layout heuristics. Unusual layouts, multiple visible questions, embedded frames, closed shadow roots, and image/canvas content can require correction or vision mode.

## Development and tests

The normal suite does not load a model checkpoint or call paid APIs. It uses real DOM/OCR fixtures, local HTTP servers, and simulated provider responses.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
npm ci
npx playwright install chromium firefox
.venv/bin/python -m unittest discover -s tests -v
npm test
npm run test:browser
npm run build
```

Install Tesseract for the OCR fixture tests. Browser tests run the panel and DOM fixtures in Chromium and Firefox. Chromium also loads the actual extension; build tests check both manifests and toolbar tests check both sidebar APIs. See [VERIFICATION.md](VERIFICATION.md) for limits.

After the full Laya setup, real-checkpoint inference can be tested with:

```sh
HF_HOME="$PWD/.cache/huggingface" LAYA_INTEGRATION=1 .venv/bin/python -m unittest discover -s tests -v
```

GitHub Actions builds both packages and runs backend, JavaScript, Chromium, and Firefox tests. The initial backend failure was a Tesseract punctuation difference (`Ciphertext.` versus `Ciphertext`); the fixture now permits that trailing punctuation while requiring the same answer text and order.

| Path | Purpose |
| --- | --- |
| `extension/` | Shared panel, DOM capture, browser API adapter, and provider calls |
| `scripts/build.mjs` | Chrome and Firefox manifests/packages |
| `backend/` | Optional Laya service, retained OCR, and local API adapter |
| `tests/` | Backend, extension, provider, build, and browser tests |

Laya is distributed under Apache-2.0. Its upstream source and notices remain in the downloaded checkout. See [THIRD_PARTY.md](THIRD_PARTY.md).
