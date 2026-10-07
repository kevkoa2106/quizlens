# QuizLens

QuizLens reads a multiple-choice question from the current browser tab and compares the answers using a model running on your computer. The Chrome side panel shows the captured text, a chosen answer, and the model's estimates for each option.

Text capture reads visible DOM elements and automatically sends the question and options for comparison. For questions drawn into images or canvas, image mode sends a screenshot to a vision-capable local model. You can also type a question or upload a PNG/JPEG.

## Features

- Capture and compare in one click, with editable question and answer fields.
- Use [Laya](https://github.com/NandhaKishorM/laya) or an OpenAI-compatible local API such as [LM Studio](https://lmstudio.ai/docs/developer/openai-compat/chat-completions).
- Read nested question text, answer grids in visual order, and open shadow roots.
- Highlight one chosen answer, including uncertain or tied results.
- Request short JSON responses and Qwen-compatible non-thinking mode.
- Discard stale results when the question or provider settings change during a request.

QuizLens does not click or submit answers on the page.

## Install and run

You need Chrome 116 or later, Python 3.13, Git, and Tesseract. Node 24 is needed only for development and browser tests. Laya downloads model weights on its first analysis.

On macOS, install the system dependencies:

```sh
brew install python@3.13 tesseract
```

Clone the repository and prepare the service:

```sh
git clone https://github.com/kevkoa2106/quizlens.git
cd quizlens
sh setup.sh
sh start.sh
```

The setup script clones Laya at the revision recorded in `LAYA_REVISION` and installs it from `vendor/laya`. If you do not use uv, make sure `python3` points to Python 3.13 before running setup.

1. Keep the service terminal open. Copy its printed service token.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select the `extension` folder.
3. Open a quiz tab and click the QuizLens toolbar icon. This grants temporary access to that tab.
4. Open **Service settings**, paste the token, and save it.
5. Choose **Capture this tab**. The panel reads the visible question and answers and compares them automatically.

Check the captured text. If it needs correction, edit it and choose **Compare answers**. After switching tabs or navigating to another website, click the toolbar icon on the target tab again. Opening the panel through Chrome's side-panel menu does not grant page access. Browser internal pages cannot be read.

## LM Studio and other local APIs

Keep the QuizLens service running; it relays requests to your model server.

1. Load a chat model in LM Studio and start its API server.
2. In the panel's **Service settings**, choose **Local API (LM Studio)**.
3. Enter the base URL, usually `http://127.0.0.1:1234/v1`, and the model identifier shown by the server.
4. Enter an API key if that server requires one. This is separate from the QuizLens service token.
5. Save settings and capture a question.

The API must implement `/chat/completions` below the configured base URL. URLs are restricted to HTTP loopback addresses: `localhost`, `127.0.0.1`, or `::1`. Redirects are rejected.

JSON output, the Qwen-compatible non-thinking flag, and a 512-token output budget are enabled by default. Some servers or model templates ignore or reject these options. Disable unsupported options in the panel, or use the server's thinking controls. The output budget can be adjusted from 128 to 8192 tokens. Incomplete JSON produces an error rather than a partial answer.

## Image mode

Choose the local API provider and **Image (vision model)** input mode. Load a model that actually supports images.

Capturing a tab sends its screenshot for comparison automatically. Uploaded files show a preview and require **Compare answers**. The model reads the question and options from the image; the extracted text appears in the panel for checking.

Images must be PNG/JPEG under 12 MB and 20 megapixels. The service resizes images to a maximum dimension of 1600 pixels and encodes JPEG before sending them. Laya accepts text only.

## What the estimates mean

Laya averages scores across cyclic answer-order permutations. The local API returns model-reported estimates and a chosen option. Its prompt asks for one best answer with a unique highest estimate.

The panel always highlights one choice. If a model still returns tied scores, QuizLens uses its explicit choice or the original option order as a fallback, and labels the result tentative. It preserves the reported scores. The 70% uncertainty threshold is a display rule, not an accuracy measurement.

These estimates are not calibrated probabilities of correctness. A model can select the wrong answer with a high score.

## Data and permissions

The extension uses `activeTab` and `scripting` to read the tab after a toolbar click. It does not request access to every website. Its only host permission is the service at `127.0.0.1:8765`.

Text mode sends the identified question and options, not the entire page or a screenshot. The extractor excludes hidden/offscreen content, navigation, and form values. Image mode sends the visible screenshot or uploaded image through the local service to the configured loopback API.

The service requires a random token and rejects ordinary website origins. It does not save screenshots, questions, or answers. Tokens and provider settings, including API keys, are stored for the browser session. Images remain in panel memory. Model files are cached under `.cache/`. Model downloads require internet access; subsequent inference uses local services.

## Development and tests

The normal test suite does not load a model checkpoint. It uses DOM fixtures, OCR fixtures, simulated model responses, and real local HTTP servers. The browser suite also loads the actual extension and checks its worker, panel, and session storage.

To run tests without installing Laya:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
npm ci
npx playwright install chromium
.venv/bin/python -m unittest discover -s tests -v
npm test
npm run test:browser
```

Tesseract must be installed for the OCR fixture tests. GitHub Actions runs these suites on pushes and pull requests.

After running the full setup, you can also test the real Laya checkpoint:

```sh
HF_HOME="$PWD/.cache/huggingface" LAYA_INTEGRATION=1 .venv/bin/python -m unittest discover -s tests -v
```

See [VERIFICATION.md](VERIFICATION.md) for coverage and verification limits.

## Project layout

| Path | Purpose |
| --- | --- |
| `extension/` | Manifest, toolbar handler, DOM capture, side panel, and result display |
| `backend/core.py` | Validation, optional OCR, and Laya inference |
| `backend/local_api.py` | Text/image requests and model-response validation |
| `backend/server.py` | Authenticated local HTTP service |
| `tests/` | Python, JavaScript, and browser tests |
| `.github/workflows/tests.yml` | Automated test runs |

## Limits

DOM capture uses layout and naming heuristics. Unusual layouts, multiple visible questions, embedded frames, closed shadow roots, and image/canvas content may need manual correction or vision mode. Only visible content is captured. Toolbar permission grants and extraction on a particular live quiz site still need a manual check.

Restart the service after backend updates and paste its new token into the panel. Reload the extension after extension updates.

Laya is an external dependency under Apache-2.0. Its source and license remain in the downloaded checkout. See [THIRD_PARTY.md](THIRD_PARTY.md).
