// Synthetic replies and virtual time; never contacts Google or reads a real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { geminiCompletion, geminiRetrySeconds, geminiResponseSchema } from '../server/madar/src/gemini-client.js';
import { CARD_SCHEMA } from '../server/madar/src/ai.js';

const env = { GEMINI_TEXT_API_KEY: 'fixture-only', GEMINI_TEXT_MODEL: 'gemini-3.1-flash-lite' };
const body = { contents: [{ role: 'user', parts: [{ text: 'PRIVATE_SYNTHETIC_SOURCE' }] }] };
const unavailable = (headers = {}) => Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503, headers });

test('Gemini nested-card schema preserves structure without the large icon grammar', () => {
  const before = JSON.stringify(CARD_SCHEMA);
  const adapted = geminiResponseSchema({ type: 'object', properties: { cards: { type: 'array', items: CARD_SCHEMA } } });
  const card = adapted.properties.cards.items;
  assert.equal(card.items, undefined);
  assert.deepEqual(card.required, CARD_SCHEMA.required);
  assert.equal(card.additionalProperties, false);
  assert.deepEqual(card.properties.layout.enum, CARD_SCHEMA.properties.layout.enum);
  assert.equal(card.properties.items.items.properties.icon.enum, undefined);
  for (const name of CARD_SCHEMA.properties.items.items.properties.icon.enum) assert.ok(card.properties.items.items.properties.icon.description.includes(name));
  assert.equal(JSON.stringify(CARD_SCHEMA), before, 'Other providers retain their original strict schema.');
});

test('Gemini service recovery is bounded, respects explicit delays and cancellation', async t => {
  const originalFetch = globalThis.fetch;
  try {
    await t.test('503 then success retries the same request after backoff', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const calls = [], notices = [];
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
        calls.push(JSON.parse(options.body));
        return calls.length === 1 ? unavailable() : Response.json({ result: 'success' });
      };
      const pending = geminiCompletion(env, body, { onWait: notice => notices.push(notice) });
      await turn(); assert.equal(calls.length, 1);
      assert.deepEqual(notices, [{ reason: 'unavailable', seconds: 3 }]);
      t.mock.timers.tick(2000); await turn(); assert.equal(calls.length, 1);
      t.mock.timers.tick(500);
      assert.equal((await pending).res.status, 200);
      assert.deepEqual(calls, [body, body]);
      assert.equal(JSON.stringify(notices).includes('PRIVATE'), false);
      assert.equal(JSON.stringify(notices).includes(env.GEMINI_TEXT_API_KEY), false);
    });

    await t.test('persistent 503 uses increasing waits and stops after three attempts', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let calls = 0; const notices = [];
      globalThis.fetch = async () => (++calls, unavailable());
      const pending = geminiCompletion(env, body, { onWait: notice => notices.push(notice) });
      await turn(); t.mock.timers.tick(2500); await turn();
      assert.equal(calls, 2);
      t.mock.timers.tick(4000); await turn(); assert.equal(calls, 2);
      t.mock.timers.tick(500);
      assert.equal((await pending).res.status, 503); assert.equal(calls, 3);
      assert.deepEqual(notices.map(n => n.seconds), [3, 5]);
    });

    await t.test('does not shorten explicit hints or retry permanent errors', async () => {
      assert.equal(geminiRetrySeconds(unavailable({ 'retry-after': '28' }), {}), 28);
      assert.equal(geminiRetrySeconds(unavailable(), { error: { details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: '60s' }] } }), 60);
      for (const hint of ['3600', 'invalid']) {
        let calls = 0;
        globalThis.fetch = async () => (++calls, unavailable({ 'retry-after': hint }));
        assert.equal((await geminiCompletion(env, body)).res.status, 503); assert.equal(calls, 1);
      }
      for (const status of [400, 401, 403, 404, 413]) {
        let calls = 0;
        globalThis.fetch = async () => (++calls, Response.json({}, { status }));
        assert.equal((await geminiCompletion(env, body)).res.status, status); assert.equal(calls, 1);
      }
      assert.equal(geminiRetrySeconds(new Response(null, { status: 429 }), {}), null);
    });

    await t.test('canceling backoff prevents another call and releases the queue', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const controller = new AbortController(); let calls = 0;
      globalThis.fetch = async () => (++calls, unavailable());
      const pending = geminiCompletion(env, body, { signal: controller.signal });
      await turn(); controller.abort();
      await assert.rejects(pending, e => e.name === 'AbortError');
      t.mock.timers.tick(60000); await turn(); assert.equal(calls, 1);
      globalThis.fetch = async () => Response.json({ result: 'next request' });
      assert.equal((await geminiCompletion(env, body)).res.status, 200);
    });
  } finally { globalThis.fetch = originalFetch; }
});
