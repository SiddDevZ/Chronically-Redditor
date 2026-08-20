import test from 'node:test';
import assert from 'node:assert/strict';

import { getCodexResponse, isConfigured } from '../services/codex.js';

function withEnv(vars, run) {
  const original = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  return run().finally(() => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });
}

function withMockedFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('isConfigured requires both base url and api key', async () => {
  await withEnv({ CODEX_BASE_URL: undefined, CODEX_API_KEY: undefined }, async () => {
    assert.equal(isConfigured(), false);
  });

  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: undefined }, async () => {
    assert.equal(isConfigured(), false);
  });

  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: 'key' }, async () => {
    assert.equal(isConfigured(), true);
  });
});

test('getCodexResponse throws when not configured', async () => {
  await withEnv({ CODEX_BASE_URL: undefined, CODEX_API_KEY: undefined }, async () => {
    await assert.rejects(() => getCodexResponse('hello'), /not configured/);
  });
});

test('getCodexResponse sends OpenAI-compatible chat completion request and parses the response', async () => {
  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: 'secret-key', CODEX_MODEL: undefined }, async () => {
    let capturedUrl, capturedOptions;
    await withMockedFetch(async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'roast text' } }] }),
      };
    }, async () => {
      const result = await getCodexResponse('roast me');
      assert.equal(result, 'roast text');
      assert.equal(capturedUrl, 'https://codex.test/chat/completions');
      assert.equal(capturedOptions.headers.Authorization, 'Bearer secret-key');

      const body = JSON.parse(capturedOptions.body);
      assert.equal(body.model, 'gpt-5.4');
      assert.equal(body.messages[0].content, 'roast me');
    });
  });
});

test('getCodexResponse uses CODEX_MODEL override when provided', async () => {
  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: 'secret-key', CODEX_MODEL: 'custom-model' }, async () => {
    let capturedBody;
    await withMockedFetch(async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    }, async () => {
      await getCodexResponse('prompt');
      assert.equal(capturedBody.model, 'custom-model');
    });
  });
});

test('getCodexResponse throws on non-ok response', async () => {
  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: 'secret-key' }, async () => {
    await withMockedFetch(async () => ({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }), async () => {
      await assert.rejects(() => getCodexResponse('prompt'), /Codex API error: 500/);
    });
  });
});

test('getCodexResponse throws when response has no content', async () => {
  await withEnv({ CODEX_BASE_URL: 'https://codex.test', CODEX_API_KEY: 'secret-key' }, async () => {
    await withMockedFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    }), async () => {
      await assert.rejects(() => getCodexResponse('prompt'), /empty response/);
    });
  });
});
