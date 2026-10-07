import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.chrome = {
      storage: { session: { get: async () => ({}), set: async settings => { window.savedSettings = settings; } } },
      tabs: { query: async () => [{ id: 42 }], captureVisibleTab: async () => { window.screenshotCalls = (window.screenshotCalls || 0) + 1; return 'data:image/png;base64,test'; } },
      scripting: { executeScript: async () => [{ result: { question: 'Encryption output?', options: ['Ciphertext', '<img src=x onerror=alert(1)>'], raw_text: 'Encryption output?\nCiphertext\nPlaintext' } }] }
    };
  });
  await page.goto('/panel.html');
});

test('DOM capture automatically compares, safely renders and clears stale results', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://127.0.0.1:8765/**', async route => {
    const result = { answers: [{ index: 0, text: 'Ciphertext', probability: .6 }, { index: 1, text: '<img src=x onerror=alert(1)>', probability: .4 }], uncertain: true, model: 'english' };
    expect(new URL(route.request().url()).pathname).toBe('/analyze');
    expect(route.request().postDataJSON()).toMatchObject({ question: 'Encryption output?', options: ['Ciphertext', '<img src=x onerror=alert(1)>'], input_mode: 'text' });
    await route.fulfill({ json: result });
  });
  await page.locator('#settings summary').click();
  await page.locator('#token').fill('test-token');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Token saved');
  await page.locator('#capture').click();
  await expect(page.locator('#question')).toHaveValue('Encryption output?');
  await page.getByText('Extracted text', { exact: true }).click();
  await expect(page.locator('#raw')).toContainText('Encryption output?');
  expect(await page.evaluate(() => window.screenshotCalls || 0)).toBe(0);
  await expect(page.locator('#answers li')).toHaveCount(2);
  await expect(page.locator('#verdict')).toContainText('Uncertain');
  await expect(page.locator('#answers img')).toHaveCount(0);
  await expect(page.locator('#answers')).toContainText('60.0%');
  await page.locator('#question').fill('A new question?');
  await expect(page.locator('#answers li')).toHaveCount(0);
  await page.setViewportSize({ width: 280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#capture')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#capture').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Compared with');
  expect(errors).toEqual([]);
});

test('missing token and unavailable service display errors and restore controls', async ({ page }) => {
  await page.locator('#question').fill('Q?');
  await page.locator('#options').fill('a\nb');
  await page.locator('#analyze').click();
  await expect(page.locator('#status')).toContainText('token');
  await page.locator('#settings summary').click();
  await page.locator('#token').fill('token');
  await page.route('http://127.0.0.1:8765/**', route => route.abort());
  await page.locator('#analyze').click();
  await expect(page.locator('#status')).toContainText('Start it');
  await expect(page.locator('#analyze')).toBeEnabled();
});

test('edits during inference discard the response', async ({ page }) => {
  await page.locator('#settings summary').click();
  await page.locator('#token').fill('token');
  await page.locator('#question').fill('Q?');
  await page.locator('#options').fill('a\nb');
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await page.route('http://127.0.0.1:8765/**', async route => {
    await waiting;
    await route.fulfill({ json: { answers: [{ index: 0, text: 'a', probability: .9 }], model: 'english' } });
  });
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toBeDisabled();
  await page.locator('#options').fill('c\nd');
  release();
  await expect(page.locator('#status')).toContainText('Question changed');
  await expect(page.locator('#answers li')).toHaveCount(0);
});

test('actual extension loads its worker and registers the side panel', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-extension-'));
  const extensionPath = path.resolve('extension');
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(() => chrome.runtime.getManifest().name)).toBe('QuizLens');
    const settings = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
    expect(settings.path).toBe('panel.html');
    const extensionId = new URL(worker.url()).hostname;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(panel.locator('#capture')).toBeEnabled();
    await panel.locator('#settings summary').click();
    await panel.locator('#token').fill('smoke-token');
    await panel.locator('#save').click();
    expect(await worker.evaluate(async () => (await chrome.storage.session.get('token')).token)).toBe('smoke-token');
    await panel.locator('#settings summary').click();
    await panel.locator('#provider').selectOption('local_api');
    await panel.locator('#model').fill('saved-local-model');
    await panel.locator('#save').click();
    await panel.reload();
    await panel.locator('#settings summary').click();
    await expect(panel.locator('#provider')).toHaveValue('local_api');
    await expect(panel.locator('#local-settings')).toBeVisible();
    await expect(panel.locator('#model')).toHaveValue('saved-local-model');
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test('edits during DOM capture preserve the edited text and prevent sending', async ({ page }) => {
  await page.evaluate(() => {
    chrome.scripting.executeScript = () => new Promise(resolve => { window.releaseCapture = () => resolve([{ result: { question: 'Old question?', options: ['a', 'b'] } }]); });
  });
  let sent = false;
  await page.route('http://127.0.0.1:8765/**', route => { sent = true; return route.abort(); });
  await page.locator('#capture').click();
  await expect(page.locator('#capture')).toBeDisabled();
  await page.locator('#question').fill('Keep my edit?');
  await page.evaluate(() => window.releaseCapture());
  await expect(page.locator('#status')).toContainText('Text changed during capture');
  await expect(page.locator('#question')).toHaveValue('Keep my edit?');
  expect(sent).toBe(false);
});

test('missing activeTab access explains the toolbar grant without calling the service', async ({ page }) => {
  await page.evaluate(() => {
    chrome.scripting.executeScript = async () => { throw new Error("Either the '<all_urls>' or 'activeTab' permission is required."); };
  });
  let calledOCR = false;
  await page.route('http://127.0.0.1:8765/**', route => { calledOCR = true; return route.abort(); });
  await page.locator('#capture').click();
  await expect(page.locator('#status')).toContainText('Chrome’s toolbar');
  await expect(page.locator('#capture')).toBeEnabled();
  expect(calledOCR).toBe(false);
});


test('local API settings are saved and sent with provider-specific estimates', async ({ page }) => {
  await page.locator('#settings summary').click();
  await expect(page.locator('#local-settings')).toBeHidden();
  await page.locator('#provider').selectOption('local_api');
  await expect(page.locator('#local-settings')).toBeVisible();
  await page.locator('#token').fill('service-token');
  await page.locator('#base-url').fill('http://localhost:1234/v1');
  await page.locator('#model').fill('local-chat-model');
  await page.locator('#api-key').fill('local-key');
  await page.locator('#save').click();
  expect(await page.evaluate(() => window.savedSettings)).toMatchObject({ provider: 'local_api', model: 'local-chat-model', api_key: 'local-key', structured_json: true, no_thinking: true, max_tokens: 512 });
  await page.locator('#question').fill('3x9');
  await page.locator('#options').fill('32\n27');
  await page.route('http://127.0.0.1:8765/analyze', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ provider: 'local_api', base_url: 'http://localhost:1234/v1', model: 'local-chat-model', api_key: 'local-key', structured_json: true, no_thinking: true, max_tokens: 512 });
    await route.fulfill({ json: { answers: [{ index: 1, text: '27', probability: .9 }, { index: 0, text: '32', probability: .1 }], uncertain: false,
      model: 'local-chat-model', provider_label: 'Local model', method: 'model-reported estimates', probability_note: 'Estimates reported by the chat model.' } });
  });
  await page.locator('#analyze').click();
  await expect(page.locator('#verdict')).toContainText('Local model favors B. 27');
  await expect(page.locator('#status')).toContainText('model-reported estimates');
  await expect(page.locator('#probability-note')).toContainText('chat model');
  await page.locator('#settings summary').click();
  await page.locator('#provider').selectOption('laya');
  await expect(page.locator('#answers li')).toHaveCount(0);
  await expect(page.locator('#local-settings')).toBeHidden();
});


test('model token-limit errors are visible and controls recover', async ({ page }) => {
  await page.locator('#settings summary').click();
  await page.locator('#provider').selectOption('local_api');
  await page.locator('#token').fill('token');
  await page.locator('#model').fill('qwen');
  await page.locator('#question').fill('6x4');
  await page.locator('#options').fill('24\n18\n21\n14');
  await page.route('http://127.0.0.1:8765/analyze', route => route.fulfill({ status: 502, json: { error: 'The model hit its output token limit before returning complete JSON.' } }));
  await page.locator('#analyze').click();
  await expect(page.locator('#status')).toContainText('output token limit');
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#answers li')).toHaveCount(0);
});


test('image capture skips OCR and renders model-read answers without text fields', async ({ page }) => {
  await page.locator('#settings summary').click();
  await page.locator('#provider').selectOption('local_api');
  await page.locator('#input-mode').selectOption('image');
  await page.locator('#token').fill('token');
  await page.locator('#model').fill('vision-model');
  await page.locator('#save').click();
  expect(await page.evaluate(() => window.savedSettings.input_mode)).toBe('image');
  await expect(page.locator('#text-fields')).toBeHidden();
  await page.locator('#analyze').click();
  await expect(page.locator('#status')).toContainText('Capture a tab or choose an image first');
  let paths = [];
  await page.route('http://127.0.0.1:8765/**', async route => {
    paths.push(new URL(route.request().url()).pathname);
    expect(route.request().postDataJSON()).toMatchObject({ input_mode: 'image', image: 'data:image/png;base64,test' });
    await route.fulfill({ json: { input_mode: 'image', question: '3x9', options: ['32', '27'], answers: [{ index: 1, text: '27', probability: .9 }, { index: 0, text: '32', probability: .1 }], model: 'vision-model', provider_label: 'Local model', uncertain: false } });
  });
  await page.locator('#capture').click();

  await expect(page.locator('#answers')).toContainText('27');
  await expect(page.locator('#verdict')).toContainText('B. 27');
  expect(paths).toEqual(['/analyze']);
  await page.locator('#settings summary').click();
  await page.locator('#provider').selectOption('laya');
  await expect(page.locator('#text-fields')).toBeVisible();
  await expect(page.locator('#image-fields')).toBeHidden();
});

test('image upload previews a PNG and rejects unsupported file types', async ({ page }) => {
  await page.locator('#settings summary').click();
  await page.locator('#provider').selectOption('local_api');
  await page.locator('#input-mode').selectOption('image');
  await page.locator('#image-upload').setInputFiles(path.resolve('tests/quiz.png'));
  await expect(page.locator('#status')).toContainText('Image loaded');
  await expect(page.locator('#image-preview')).toBeVisible();
  expect(await page.locator('#image-preview').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  await page.locator('#image-upload').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await expect(page.locator('#status')).toContainText('PNG or JPEG');
  await expect(page.locator('#image-preview')).toBeHidden();
});

test('incomplete DOM capture does not send a model request', async ({ page }) => {
  await page.evaluate(() => { chrome.scripting.executeScript = async () => [{ result: { question: '', options: [], raw_text: '', error: 'Could not identify a complete question. Use Image mode.' } }]; });
  let sent = false;
  await page.route('http://127.0.0.1:8765/**', route => { sent = true; return route.abort(); });
  await page.locator('#capture').click();
  await expect(page.locator('#status')).toContainText('Could not identify');
  await expect(page.locator('#capture')).toBeEnabled();
  expect(sent).toBe(false);
});

test('legacy tied scores show the original-order fallback explicitly', async ({ page }) => {
  await page.locator('#settings summary').click();
  await page.locator('#token').fill('token');
  await page.locator('#question').fill('Q?');
  await page.locator('#options').fill('First\nSecond');
  await page.route('http://127.0.0.1:8765/analyze', route => route.fulfill({ json: {
    answers: [{ index: 0, text: 'First', probability: .5 }, { index: 1, text: 'Second', probability: .5 }],
    uncertain: true, model: 'test'
  } }));
  await page.locator('#analyze').click();
  await expect(page.locator('.chosen-answer')).toHaveCount(1);
  await expect(page.locator('.chosen-answer')).toContainText('First');
  await expect(page.locator('#probability-note')).toContainText('original option order breaks the tie');
});

for (const count of [2, 3, 4]) {
  test(`uniform ${count}-option estimates show exactly one chosen answer`, async ({ page }) => {
    await page.locator('#settings summary').click();
    await page.locator('#token').fill('token');
    await page.locator('#question').fill('Q?');
    await page.locator('#options').fill(Array.from({ length: count }, (_, i) => `Option ${i}`).join('\n'));
    await page.route('http://127.0.0.1:8765/analyze', route => route.fulfill({ json: {
      answers: Array.from({ length: count }, (_, i) => ({ index: i, text: `Option ${i}`, probability: 1 / count })),
      chosen_index: count - 1, tied: true, choice_source: 'model', uncertain: true, model: 'test', provider_label: 'Local model'
    } }));
    await page.locator('#analyze').click();
    await expect(page.locator('.chosen-answer')).toHaveCount(1);
    await expect(page.locator('.chosen-answer')).toContainText(`Option ${count - 1}`);
    await expect(page.locator('.chosen-answer')).toContainText(`${(100 / count).toFixed(1)}%`);
    await expect(page.locator('#verdict')).toContainText('Scores are tied');
    await expect(page.locator('#probability-note')).toContainText('explicitly selected');
  });
}
