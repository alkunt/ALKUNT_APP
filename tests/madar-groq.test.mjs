// Provider replies and time are fixtures; no real AI request or real backoff wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { groqCompletion, groqRetrySeconds } from '../server/madar/src/groq-client.js';
import { imagesToText } from '../server/madar/src/sources.js';

const env = { GROQ_API_KEY: 'fixture-key-never-exposed' };
const body = content => ({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content }] });
const ok = text => Response.json({ choices: [{ message: { content: text } }] });
const limited = (delay, message = 'temporary limit') => Response.json({ error: { message } }, { status: 429, headers: delay == null ? {} : { 'retry-after': String(delay) } });

test('Groq recovery respects provider limits, cancellation and private request boundaries', async t => {
  const originalFetch = globalThis.fetch;
  try {
    await t.test('waits the full 28-second provider delay and completes the same request', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const calls = [], notices = [];
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.ok(options.signal instanceof AbortSignal);
        calls.push(JSON.parse(options.body));
        return calls.length === 1 ? limited(28) : ok('complete');
      };
      const pending = groqCompletion(env, body('ALICE_PRIVATE_SOURCE'), { onWait: n => notices.push(n) });
      await turn();
      assert.equal(calls.length, 1);
      assert.equal(notices[0].seconds, 29);
      t.mock.timers.tick(28000); await turn();
      assert.equal(calls.length, 1, 'No early retry before the provider permits it.');
      t.mock.timers.tick(500);
      const result = await pending;
      assert.equal(result.res.status, 200); assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
      assert.equal(JSON.stringify(notices).includes('PRIVATE'), false);
      assert.equal(JSON.stringify(notices).includes(env.GROQ_API_KEY), false);
    });

    await t.test('uses documented headers and compound delays; never retries daily or oversized requests', async () => {
      assert.equal(groqRetrySeconds(limited(9), { error: { message: 'try again in 2s' } }), 9);
      assert.equal(groqRetrySeconds(limited(null), { error: { message: 'Please try again in 1m0.8s.' } }), 60.8);
      assert.equal(groqRetrySeconds(limited(1), { error: { message: 'tokens per day (TPD)' } }), null);
      assert.equal(groqRetrySeconds(limited(1), { error: { message: 'Limit 7000, Used 0, Requested 8000' } }), null);
      let calls = 0;
      globalThis.fetch = async () => (++calls, limited(3600, 'daily limit private-provider-detail'));
      assert.equal((await groqCompletion(env, body('source'))).res.status, 429);
      assert.equal(calls, 1);
    });

    await t.test('serializes the shared platform connection without mixing members work', async () => {
      const calls = [], notices = [];
      let finishFirst;
      globalThis.fetch = async (_url, options) => {
        const sent = JSON.parse(options.body); calls.push(sent);
        if (calls.length === 1) return new Promise(resolve => { finishFirst = resolve; });
        return ok('second');
      };
      const alice = groqCompletion(env, body('ALICE_PRIVATE_SOURCE'));
      const bob = groqCompletion(env, body('BOB_PRIVATE_SOURCE'), { onWait: n => notices.push(n) });
      await turn();
      assert.equal(calls.length, 1); assert.equal(notices[0].reason, 'queue');
      finishFirst(ok('first'));
      assert.equal((await alice).res.status, 200); assert.equal((await bob).res.status, 200);
      assert.equal(calls.length, 2);
      assert.ok(JSON.stringify(calls[0]).includes('ALICE_PRIVATE_SOURCE'));
      assert.equal(JSON.stringify(calls[0]).includes('BOB_PRIVATE_SOURCE'), false);
      assert.equal(JSON.stringify(calls[1]).includes('ALICE_PRIVATE_SOURCE'), false);
    });

    await t.test('canceling a wait prevents another provider call and frees the next request', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const controller = new AbortController(); let calls = 0;
      globalThis.fetch = async () => (++calls, limited(30));
      const pending = groqCompletion(env, body('cancel-me'), { signal: controller.signal });
      await turn(); controller.abort();
      await assert.rejects(pending, e => e.name === 'AbortError');
      t.mock.timers.tick(60000); await turn(); assert.equal(calls, 1);
      globalThis.fetch = async () => ok('next');
      assert.equal((await groqCompletion(env, body('next'))).res.status, 200);
    });

    await t.test('keeps temporary retries bounded', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0;
      globalThis.fetch = async () => (++calls, limited(0));
      const pending = groqCompletion(env, body('bounded'));
      await turn(); t.mock.timers.tick(500); await turn(); t.mock.timers.tick(500);
      assert.equal((await pending).res.status, 429); assert.equal(calls, 3);
    });

    await t.test('image batches wait instead of racing the shared allowance or changing provider', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const calls = [], notices = []; let otherProvider = 0;
      const visionEnv = { ...env, AI: { run() { otherProvider++; throw new Error('must not forward images'); } } };
      const images = ['one', 'two', 'three', 'four'].map(data => ({ data, media_type: 'image/png' }));
      globalThis.fetch = async (_url, options) => {
        const sent = JSON.parse(options.body); calls.push(sent);
        assert.equal(sent.model, 'qwen/qwen3.8-27b');
        if (calls.length === 1) return limited(null, 'Limit 7000, Used 4076, Requested 6231. Please try again in 28.345714285s.');
        return ok(calls.length === 2 ? 'نص الصفحات الأولى كاملاً' : 'نص الصفحة الأخيرة كاملاً');
      };
      const pending = imagesToText(visionEnv, images, { onWait: n => notices.push(n) });
      await turn(); assert.equal(calls.length, 1); assert.equal(notices[0].seconds, 29);
      t.mock.timers.tick(28846);
      const text = await pending;
      assert.equal(calls.length, 3); assert.equal(otherProvider, 0);
      assert.equal(text, 'نص الصفحات الأولى كاملاً\n\nنص الصفحة الأخيرة كاملاً');
      assert.deepEqual(calls[1], calls[0]);
      assert.equal(calls[2].messages[0].content[1].image_url.url, 'data:image/png;base64,four');
      globalThis.fetch = async () => limited(3600, 'daily limit secret-provider-detail');
      await assert.rejects(imagesToText(visionEnv, images), e => e.code === 'rate_limit' && !e.message.includes('secret-provider-detail'));
      assert.equal(otherProvider, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
