import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
const directory = mkdtempSync(path.join(tmpdir(), 'madar-images-'));
Object.assign(process.env, { DATA_DIR: directory, APP_ORIGIN: 'http://127.0.0.1:31879', COOKIE_SECURE: 'false', MADAR_TEXT_PROVIDER: 'gemini', MADAR_GEMINI_TEXT_API_KEY: 'image-fixture-not-a-real-key' });
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'GEMINI_TEXT_MODEL', 'PEXELS_API_KEY', 'UNSPLASH_ACCESS_KEY']) process.env['MADAR_' + k] = '';
const { sql } = await import('../server/runtime.mjs');
const { createSession, cookieName } = await import('../server/auth.mjs');
const { handleMadar } = await import('../server/madar/bridge.mjs');
const { searchImages, matchStock } = await import('../server/madar/src/images.js');
const { illustrationSVG, illustrationBrief, conceptLabels, conceptPNG } = await import('../server/madar/src/illustrations.js');
const { cardImageContext } = await import('../server/madar/public/js/image-context.js');
for (const id of ['alice', 'bob']) sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id, id + '@example.test', id, 'unused');
const cookies = Object.fromEntries(['alice', 'bob'].map(id => [id, cookieName + '=' + createSession(id)]));
const request = (route, { user = 'alice', method = 'GET', body } = {}) => handleMadar(new Request(process.env.APP_ORIGIN + '/madar' + route, { method, headers: { ...(user ? { cookie: cookies[user] } : {}), ...(method === 'POST' ? { origin: process.env.APP_ORIGIN, 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
const status = async () => (await (await request('/api/config')).json()).plan.remaining;
const shape = (kind, patch = {}) => ({ kind, x: 400, y: 180, w: 120, h: 160, fill: '#297A62', stroke: 'none', sw: 0, d: '', ...patch });
const scene = { visualType: 'scene', background: '#F3F6F4', shapes: [shape('rect'), shape('ellipse'), shape('ellipse', { x: 500 }), shape('ellipse', { x: 600 }), shape('path', { d: 'M 400 260 C 320 150 360 80 400 200 Z', fill: '#458C5A' }), shape('rect', { x: 350, y: 340, w: 350, h: 90, fill: '#C67C55' })] };
const originalFetch = globalThis.fetch, originalCache = globalThis.caches;
let mode = 'success', googleCalls = 0, photoCalls = 0;
const googleRequests = [];
globalThis.fetch = async (url, options) => {
  const u = new URL(url);
  if (u.hostname === 'api.openverse.org') {
    photoCalls++;
    assert.equal(u.searchParams.get('filter_dead'), 'true');
    return Response.json({ results: [1, 2].map(n => ({ url: `https://photos.example.test/plant-${n}.jpg`, thumbnail: `https://photos.example.test/thumb-${n}.jpg`, title: 'green plant garden', creator: 'Example Photographer', license: 'by', source: 'flickr', foreign_landing_url: `https://photos.example.test/page-${n}` })) });
  }
  assert.equal(u.hostname, 'generativelanguage.googleapis.com');
  assert.equal(u.pathname, '/v1beta/models/gemini-3.8-flash:generateContent');
  googleCalls++;
  const body = JSON.parse(options.body);
  googleRequests.push(body);
  assert.equal(body.generationConfig.imageConfig, undefined, 'Never invoke a billed image model.');
  assert.equal(body.generationConfig.responseModalities, undefined);
  assert.equal(body.tools, undefined);
  if (mode === 'quota') return Response.json({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDay' }] }] } }, { status: 429 });
  if (body.generationConfig.responseJsonSchema.properties.relevant) {
    assert.ok(body.contents[0].parts[1].inlineData.data.startsWith('iVBOR'), 'Review the rendered PNG, not its claimed description.');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({relevant:mode!=='off-topic',recognizable:true,feedback:'Draw the actual current subject, not a clock.'})}]}}]});
  }
  const data = body.generationConfig.responseJsonSchema.properties.query ? { query: 'plant garden' } : mode === 'invalid' ? { shapes: [] } : scene;
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }] });
};
try {
  // This used to throw ReferenceError on Railway before sending any photo request.
  delete globalThis.caches;
  assert.equal((await searchImages({}, 'plant garden')).length, 2);
  assert.equal((await matchStock({}, 'plant garden', '', ['https://photos.example.test/plant-1.jpg'])).url, 'https://photos.example.test/plant-2.jpg');
  const arabic = await (await request('/api/images?q=' + encodeURIComponent('نباتات الحديقة'))).json();
  assert.equal(arabic.results.length, 2); assert.equal(googleCalls, 1);
  const stockBefore = await status();
  const stock = await (await request('/api/image-match', { method: 'POST', body: { query: 'plant garden' } })).json();
  assert.equal(stock.image.source, 'stock'); assert.equal(await status(), stockBefore);
  // Only allowlisted geometry enters the renderer, even if the model is hostile.
  const svg = illustrationSVG({ ...scene, shapes: [...scene.shapes, { kind: 'script', d: 'alert(1)' }, shape('path', { d: 'M 0 0\"/><image href=\"https://evil.example/' }), shape('rect', { fill: 'url(https://evil.example)', x: Infinity })] });
  assert.ok(!/script|href|evil\.example|Infinity/.test(svg));
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 1280); assert.equal(metadata.height, 720);
  assert.ok(bytes.length > 1000);
  const before = await status();
  const generated = await (await request('/api/image-gen', { method: 'POST', body: { prompt: 'ALICE_PRIVATE رسم نبات أخضر', aspect: '3:4' } })).json();
  assert.equal(generated.image.source, 'ai'); assert.equal(generated.remaining, before - 1);
  const imageRoute = generated.image.url.slice('/madar'.length);
  const response = await request(imageRoute);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).height, 1280);
  assert.equal((await request(imageRoute, { user: 'bob' })).status, 404);
  assert.equal((await request(imageRoute, { user: null })).status, 401);
  // A stale clock suggestion must never override an edited card about Tawhid.
  const faith = {deckTitle:'أساس التوحيد',topic:'An outdated lesson about office schedules',slide:{title:'إفراد الله بالعبادة',subtitle:'أساس التوحيد',body:'الإخلاص في العبادة',items:['الإخلاص','الدعاء']},prompt:'A generic clock on a desk',mode:'automatic'};
  const brief = illustrationBrief(faith);
  assert.ok(!JSON.stringify(brief).includes('clock'));
  assert.ok(!JSON.stringify(brief).includes('office schedules'));
  assert.equal(brief.currentCard.title,'إفراد الله بالعبادة');
  assert.deepEqual(conceptLabels(faith).labels,['الإخلاص','الدعاء','أساس التوحيد']);
  const context = cardImageContext({title:'المجموعة الشمسية',topic:'الفضاء'}, {title:'الكواكب تدور حول الشمس',body:'مدارات الكواكب',items:[{title:'الشمس',text:'مركز النظام'}],image:{query:'An unrelated classroom'}});
  assert.equal(context.slide.body,'مدارات الكواكب'); assert.ok(!JSON.stringify(context).includes('classroom'));
  const beforeFaithCalls=googleCalls;
  const grounded = await (await request('/api/image-gen',{method:'POST',body:{...faith,aspect:'3:4'}})).json();
  assert.equal(grounded.image.alt,faith.slide.title); assert.ok(grounded.image.credit.includes('مخطط'));
  assert.equal(googleCalls,beforeFaithCalls,'An exact-source diagram does not need a model to invent or approve a new subject.');
  const typography = await conceptPNG(faith,'16:9'); assert.equal((await sharp(typography).metadata()).width,1280);
  mode='off-topic'; const unrelatedBalance=await status(), imagesBefore=sql.prepare('SELECT COUNT(*) AS n FROM madar_images').get().n, callsBefore=googleCalls;
  const rejected=await request('/api/image-gen',{method:'POST',body:{...context,prompt:'old visual',mode:'automatic'}});
  assert.equal(rejected.status,502); assert.ok((await rejected.json()).error.includes('الصلة'));
  assert.equal(googleCalls-callsBefore,4,'One correction only, with a real picture review on each attempt.');
  assert.equal(await status(),unrelatedBalance); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM madar_images').get().n,imagesBefore,'Rejected pictures must not be saved.');
  for (mode of ['quota', 'invalid']) {
    const balance = await status();
    const failure = await request('/api/image-gen', { method: 'POST', body: { prompt: 'اختبار الفشل' } });
    assert.equal(failure.status, 502);
    const data = await failure.json();
    assert.equal(data.remaining, balance); assert.equal(await status(), balance);
    assert.ok(!JSON.stringify(data).includes('image-fixture'));
  }
  assert.ok(photoCalls >= 3);
  console.log('Madar images: Node photo search, Arabic search, safe PNG rendering, private assets and failed-image refunds passed.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalCache === undefined) delete globalThis.caches; else globalThis.caches = originalCache;
  sql.close(); rmSync(directory, { recursive: true, force: true });
}
