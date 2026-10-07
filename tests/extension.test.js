import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, validateInput, request } from '../extension/core.js';

test('options retain order and remove empty lines', () => {
  assert.deepEqual(parseOptions(' Ciphertext\n\nPlaintext '), ['Ciphertext', 'Plaintext']);
});
test('validates question and distinct options', () => {
  assert.doesNotThrow(() => validateInput('Q?', ['a', 'b']));
  for (const [q, options] of [['', ['a', 'b']], ['Q', ['a']], ['Q', ['A', 'a']], ['Q', ['a', 'x'.repeat(501)]]]) {
    assert.throws(() => validateInput(q, options));
  }
});
test('API sends text and bearer token to loopback', async () => {
  const result = await request('/analyze', { question: 'Q?' }, ' token ', async (url, settings) => {
    assert.equal(url, 'http://127.0.0.1:8765/analyze');
    assert.equal(settings.headers.Authorization, 'Bearer token');
    assert.equal(JSON.parse(settings.body).question, 'Q?');
    return { ok: true, json: async () => ({ answers: [] }) };
  });
  assert.deepEqual(result, { answers: [] });
});
test('missing token, service failures and network errors are actionable', async () => {
  await assert.rejects(request('/analyze', {}, ''), /token/);
  await assert.rejects(request('/analyze', {}, 'x', async () => ({ ok: false, json: async () => ({ error: 'Bad token' }) })), /Bad token/);
  await assert.rejects(request('/analyze', {}, 'x', async () => { throw new TypeError(); }), /Start it/);
});


test('timeout errors explain recovery instead of reporting a disconnected service', async () => {
  await assert.rejects(request('/analyze', {}, 'x', async () => {
    throw new DOMException('Timed out', 'TimeoutError');
  }), /Processing timed out/);
});

test('manifest grants temporary DOM access without unrestricted website access', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:8765/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['http://127.0.0.1/*', 'http://localhost/*', 'https://api.openai.com/*', 'https://api.anthropic.com/*']);
});

test('toolbar click explicitly opens the panel and disables automatic action interception', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  let listener;
  let behavior;
  let opened;
  runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), {
    console,
    chrome: {
      sidePanel: {
        setPanelBehavior: options => { behavior = options.openPanelOnActionClick; return Promise.resolve(); },
        open: options => { opened = options.windowId; return Promise.resolve(); }
      },
      action: { onClicked: { addListener: callback => { listener = callback; } } }
    }
  });
  assert.equal(behavior, false);
  listener({ windowId: 42 });
  assert.equal(opened, 42);
});

test('Firefox toolbar opens its native sidebar', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  let listener;
  let opened = false;
  runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), {
    console, browser: { sidebarAction: { open: async () => { opened = true; } }, action: { onClicked: { addListener: callback => { listener = callback; } } } }
  });
  listener({ windowId: 42 });
  assert.equal(opened, true);
});
