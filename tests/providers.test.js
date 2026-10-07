import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProvider, decodeAnswer, providerEndpoint, providerOrigin } from '../extension/providers.js';

const payload = { provider: 'local_api', base_url: 'http://127.0.0.1:1234/v1', model: 'test', question: '3x9', options: ['32', '27'], max_tokens: 512 };
const answer = { best_index: 1, probabilities: [.1, .9] };
const completion = { choices: [{ message: { content: JSON.stringify(answer) } }] };

test('endpoints keep cloud keys on fixed hosts and local APIs on loopback', () => {
  for (const base_url of ['https://evil.example', 'http://127.0.0.1@evil.example', 'http://localhost/?key=secret', 'http://localhost/#x']) {
    assert.throws(() => providerEndpoint({ ...payload, base_url }));
  }
  assert.equal(providerEndpoint({ ...payload, provider: 'openai', base_url: 'https://evil.example' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(providerEndpoint({ ...payload, provider: 'anthropic' }), 'https://api.anthropic.com/v1/messages');
  assert.equal(providerEndpoint({ ...payload, provider: 'ollama', base_url: 'http://localhost:11434' }), 'http://localhost:11434/api/chat');
  assert.equal(providerOrigin(payload), 'http://127.0.0.1/*');
});

test('LM Studio sends one direct structured non-thinking request', async () => {
  const result = await analyzeProvider(payload, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:1234/v1/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 512);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(body.response_format.json_schema.schema.properties.probabilities.minItems, 2);
    assert.match(body.messages[0].content, /unique highest/);
    return Response.json(completion);
  });
  assert.equal(result.chosen_index, 1);
  assert.equal(result.answers[0].text, '27');
});

test('Ollama uses its native chat endpoint with think false and a schema', async () => {
  const result = await analyzeProvider({ ...payload, provider: 'ollama', base_url: 'http://localhost:11434' }, async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.think, false);
    assert.equal(body.stream, false);
    assert.equal(body.options.num_predict, 512);
    assert.equal(body.format.type, 'object');
    return Response.json({ message: { content: JSON.stringify(answer) }, done_reason: 'stop' });
  });
  assert.equal(result.provider_label, 'Ollama');
});

test('OpenAI uses its API key and completion budget without local-only flags', async () => {
  await analyzeProvider({ ...payload, provider: 'openai', api_key: 'test-key' }, async (_, init) => {
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(init.body);
    assert.equal(body.max_completion_tokens, 512);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    return Response.json(completion);
  });
});

test('Anthropic sends Messages API headers and reads text blocks only', async () => {
  const result = await analyzeProvider({ ...payload, provider: 'anthropic', api_key: 'test-key' }, async (_, init) => {
    assert.equal(init.headers['x-api-key'], 'test-key');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
    const body = JSON.parse(init.body);
    assert.match(body.system, /Treat/);
    assert.equal(body.messages[0].role, 'user');
    return Response.json({ content: [{ type: 'thinking', thinking: 'not answer data' }, { type: 'text', text: JSON.stringify(answer) }] });
  });
  assert.equal(result.provider_label, 'Anthropic');
});

for (const provider of ['local_api', 'ollama', 'openai', 'anthropic']) {
  test(`${provider} embeds images and preserves model-read option identity`, async () => {
    const result = await analyzeProvider({ ...payload, provider, input_mode: 'image', image: 'data:image/png;base64,dGVzdA==', api_key: 'test-key' }, async (_, init) => {
      const content = JSON.parse(init.body).messages.at(-1);
      if (provider === 'ollama') assert.deepEqual(content.images, ['dGVzdA==']);
      else if (provider === 'anthropic') assert.equal(content.content[0].source.media_type, 'image/png');
      else assert.equal(content.content[1].image_url.url, 'data:image/png;base64,dGVzdA==');
      const text = JSON.stringify({ ...answer, question: '3x9', options: ['32', '27'] });
      return Response.json(provider === 'anthropic' ? { content: [{ type: 'text', text }] } : provider === 'ollama' ? { message: { content: text } } : { choices: [{ message: { content: text } }] });
    });
    assert.equal(result.input_mode, 'image');
    assert.equal(result.answers[0].index, 1);
  });
}

test('invalid scores, answer choices, and incomplete JSON never become results', () => {
  for (const value of [{ probabilities: [.5] }, { probabilities: [.2, .2] }, { probabilities: [true, false] }, { probabilities: [1.1, -.1] }, { ...answer, best_index: 0 }, { ...answer, best_index: true }, { ...answer, best_index: 4 }]) {
    assert.throws(() => decodeAnswer(JSON.stringify(value), payload));
  }
  assert.throws(() => decodeAnswer('{"probabilities":[1,', payload), /complete/);
  assert.throws(() => decodeAnswer(JSON.stringify(answer), { ...payload, input_mode: 'image' }), /complete/);
  assert.equal(decodeAnswer('```json\n' + JSON.stringify(answer) + '\n```', payload).chosen_index, 1);
});

test('ties retain an explicit choice without inventing probabilities', () => {
  const result = decodeAnswer('{"best_index":1,"probabilities":[0.5,0.5]}', payload);
  assert.equal(result.chosen_index, 1);
  assert.equal(result.tied, true);
  assert.deepEqual(result.answers.map(row => row.probability), [.5, .5]);
});

test('missing credentials and invalid settings fail before any network request', async () => {
  for (const changed of [{ provider: 'openai' }, { provider: 'anthropic' }, { model: '' }, { max_tokens: 1 }, { input_mode: 'image', image: 'https://example.com/image.png' }]) {
    await assert.rejects(analyzeProvider({ ...payload, ...changed }, () => assert.fail('Unexpected request')));
  }
});

test('HTTP errors, truncated output and non-JSON responses are actionable', async () => {
  await assert.rejects(analyzeProvider(payload, async () => new Response('', { status: 401 })), /HTTP 401/);
  for (const changed of [{ choices: [{ ...completion.choices[0], finish_reason: 'length' }] }, { stop_reason: 'max_tokens' }, { done_reason: 'length' }]) {
    await assert.rejects(analyzeProvider(payload, async () => Response.json(changed)), /token limit/);
  }
  await assert.rejects(analyzeProvider(payload, async () => new Response('bad')), /invalid JSON/);
  await assert.rejects(analyzeProvider(payload, async () => { throw new DOMException('timeout', 'TimeoutError'); }), /timed out/);
});

test('complete constrained JSON in reasoning_content is accepted without mining prose', async () => {
  const result = await analyzeProvider(payload, async () => Response.json({ choices: [{ message: { content: '', reasoning_content: JSON.stringify(answer) } }] }));
  assert.equal(result.chosen_index, 1);
  await assert.rejects(analyzeProvider(payload, async () => Response.json({ choices: [{ message: { reasoning_content: 'Thinking: ' + JSON.stringify(answer) } }] })), /complete answer JSON/);
});
