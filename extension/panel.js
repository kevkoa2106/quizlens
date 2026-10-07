import { parseOptions, validateInput, request, renderAnswers } from './core.js';
import { captureDOM } from './dom.js';

const byId = id => document.getElementById(id);
const status = byId('status');
const question = byId('question');
const options = byId('options');
const token = byId('token');
let revision = 0;
let capturedImage = '';
function imageMode() { return byId('provider').value === 'local_api' && byId('input-mode').value === 'image'; }
function updateInputMode() {
  byId('text-fields').hidden = imageMode();
  byId('image-fields').hidden = !imageMode();
  question.required = options.required = !imageMode();
}
function setImage(image) {
  capturedImage = image;
  byId('image-preview').src = image;
  byId('image-preview').hidden = false;
  byId('raw').textContent = 'Image mode: the vision model will read the question and answers when you compare.';
}
const settings = await chrome.storage.session.get(['token', 'provider', 'base_url', 'model', 'api_key', 'structured_json', 'no_thinking', 'max_tokens', 'input_mode']);
token.value = settings.token || '';
byId('provider').value = settings.provider || 'laya';
byId('base-url').value = settings.base_url || 'http://127.0.0.1:1234/v1';
byId('model').value = settings.model || '';
byId('api-key').value = settings.api_key || '';
byId('structured-json').checked = settings.structured_json !== false;
byId('no-thinking').checked = settings.no_thinking !== false;
byId('max-tokens').value = settings.max_tokens || 512;
byId('input-mode').value = settings.input_mode || 'text';
updateInputMode();
byId('input-mode').addEventListener('change', () => { updateInputMode(); clearResult(); });
byId('local-settings').hidden = byId('provider').value !== 'local_api';
byId('provider').addEventListener('change', () => {
  byId('local-settings').hidden = byId('provider').value !== 'local_api';
  updateInputMode();
  clearResult();
});
for (const id of ['base-url', 'model', 'api-key', 'structured-json', 'no-thinking', 'max-tokens']) byId(id).addEventListener('input', clearResult);
if (token.value) status.textContent = 'Capture a question or type one below.';

function clearResult() {
  revision++;
  byId('answers').replaceChildren();
  byId('verdict').textContent = 'Compare the current question to see estimates.';
}
question.addEventListener('input', clearResult);
options.addEventListener('input', clearResult);

async function run(message, action) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  status.textContent = message;
  try { await action(); }
  catch (error) { status.textContent = error.message; }
  finally { buttons.forEach(button => button.disabled = false); }
}

byId('save').addEventListener('click', () => run('Saving token…', async () => {
  await chrome.storage.session.set({ token: token.value.trim(), provider: byId('provider').value, base_url: byId('base-url').value.trim(), model: byId('model').value.trim(), api_key: byId('api-key').value.trim(), structured_json: byId('structured-json').checked, no_thinking: byId('no-thinking').checked, max_tokens: Number(byId('max-tokens').value), input_mode: imageMode() ? 'image' : 'text' });
  status.textContent = 'Token saved; provider settings saved for this browser session.';
  byId('settings').open = false;
}));

async function compare(currentRevision) {
  status.textContent = byId('provider').value === 'laya' ? 'Laya is comparing the answers. First use may download a model…' : 'Your local model is comparing the answers…';
  const choices = parseOptions(options.value);
  if (imageMode()) {
    if (!capturedImage) throw new Error('Capture a tab or choose an image first.');
  } else validateInput(question.value, choices);
  const result = await request('/analyze', { question: question.value.trim(), options: choices, provider: byId('provider').value, base_url: byId('base-url').value.trim(), model: byId('model').value.trim(), api_key: byId('api-key').value.trim(), structured_json: byId('structured-json').checked, no_thinking: byId('no-thinking').checked, max_tokens: Number(byId('max-tokens').value), input_mode: imageMode() ? 'image' : 'text', ...(imageMode() ? { image: capturedImage } : {}) }, token.value);
  if (revision !== currentRevision) { status.textContent = 'Question changed during analysis. Compare it again.'; return; }
  if (result.input_mode === 'image') {
    question.value = result.question;
    options.value = result.options.join('\n');
    byId('raw').textContent = `${result.question}\n${result.options.join('\n')}`;
  }
  const chosen = result.answers.find(answer => answer.index === result.chosen_index) || result.answers[0];
  const tied = result.tied ?? result.answers.filter(answer => Math.abs(answer.probability - chosen.probability) < 1e-9).length > 1;
  renderAnswers(byId('answers'), result.answers, chosen.index);
  byId('verdict').textContent = `${result.provider_label || 'Laya'} favors ${String.fromCharCode(65 + chosen.index)}. ${chosen.text}` +
    (tied ? ' Scores are tied; this is a tentative choice.' : result.uncertain ? ' Uncertain: below the 70% display threshold.' : '');
  byId('probability-note').textContent = (result.probability_note || "Percentages reflect Laya's preferences among these options. They have not been calibrated on your quizzes and can be confidently wrong.") +
    (tied ? result.choice_source === 'model' ? ' The model explicitly selected this answer despite tied scores.' : ' The original option order breaks the tie; the scores do not distinguish a winner.' : '');
  status.textContent = `Compared with ${result.model}; ${result.method || 'averaged across answer orders'}.`;
}

byId('capture').addEventListener('click', () => run('Reading the visible page…', async () => {
  clearResult();
  const currentRevision = revision;
  let result;
  try {
    if (imageMode()) {
      capturedImage = '';
      byId('image-preview').hidden = true;
      const image = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
      if (revision !== currentRevision) { status.textContent = 'Input changed during capture. Capture again when ready.'; return; }
      setImage(image);
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Open a quiz tab before capturing.');
      const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureDOM });
      result = frames[0]?.result;
      if (!result) throw new Error('Could not read this page. Enter the question below or use Image mode.');
      if (revision !== currentRevision) { status.textContent = 'Text changed during capture. Capture again when ready.'; return; }
      question.value = result.question;
      options.value = result.options.join('\n');
      byId('raw').textContent = result.raw_text || 'No complete question found in visible page elements.';
      if (result.error) { status.textContent = result.error; return; }
    }
  } catch (error) {
    if (/activeTab|<all_urls>|Cannot access|cannot be scripted|Missing host permission/i.test(error.message)) {
      throw new Error('Click the QuizLens extension icon in Chrome’s toolbar while viewing this quiz tab, then click Capture this tab again. Switching tabs or websites requires another toolbar click. Chrome internal pages cannot be read.');
    }
    throw error;
  }
  await compare(currentRevision);
}));

byId('question-form').addEventListener('submit', event => {
  event.preventDefault();
  run('Comparing answers…', async () => {
    clearResult();
    await compare(revision);
  });
});

byId('image-upload').addEventListener('change', () => run('Loading image…', async () => {
  clearResult();
  capturedImage = '';
  byId('image-preview').hidden = true;
  const currentRevision = revision;
  const file = byId('image-upload').files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Choose a PNG or JPEG under 12 MB.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
  if (revision !== currentRevision) { status.textContent = 'Input changed while loading the image. Choose it again.'; return; }
  setImage(data);
  status.textContent = 'Image loaded. Compare with a vision-capable local model.';
}));
