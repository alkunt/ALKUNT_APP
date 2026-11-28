import Anthropic from '@anthropic-ai/sdk';
import * as ai from './ai.js';
import * as mock from './mock.js';
import * as store from './store.js';
import { searchImages, matchStock, generateImage, generateNanoBanana, proxyImage, ASPECTS, sceneFor } from './images.js';
import { generateIllustration } from './illustrations.js';
import { extractUrl } from './extract.js';
import { sourceToText } from './sources.js';
import { costOf, LIMITS, FORMATS, LANGUAGES, DENSITY, TONES, SOURCE_MODES, IMAGE_STYLES } from '../public/js/schema.js';
import * as plans from './plans.js';

// ---------- helpers ----------

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

class HttpError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function cfg(env) {
  const freeGemini = ai.textEngine(env) === 'gemini';
  return {
    // Text: Claude when its key is set, else free Workers AI, else demo content.
    textEngine: ai.textEngine(env),
    demo: ai.textEngine(env) === 'demo',
    maxCards: Math.min(Number(env.MAX_CARDS || 25), 30), // absolute cap; each plan has its own limit
    // Nano Banana (Gemini) when its key is set; otherwise Workers AI unless switched off.
    imageEngine: freeGemini ? 'gemini-illustration' : env.GEMINI_API_KEY ? 'nano-banana' : env.AI && env.AI_IMAGES !== 'off' ? 'workers-ai' : 'none',
    aiImages: freeGemini || Boolean(env.GEMINI_API_KEY) || (Boolean(env.AI) && env.AI_IMAGES !== 'off'),
  };
}

async function visitorId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
  // Only a salted hash of the IP is ever stored.
  return (await store.sha256(`${env.IP_SALT || 'madar-salt'}:${ip}`)).slice(0, 24);
}

async function readJSON(request, maxBytes = 12 * 1024 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError('حجم الطلب كبير جداً.', 413);
  try {
    return await request.json();
  } catch {
    throw new HttpError('طلب غير صالح.');
  }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const pick = (v, allowed, dflt) => (Object.hasOwn(allowed, v) ? v : dflt);

function cleanSettings(s = {}) {
  return {
    format: pick(s.format, FORMATS, 'presentation'),
    lang: pick(s.lang, LANGUAGES, 'ar'),
    density: pick(s.density, DENSITY, 'medium'),
    tone: pick(s.tone, TONES, 'professional'),
    audience: str(s.audience, 200),
    imageStyle: pick(s.imageStyle, IMAGE_STYLES, 'photo'),
  };
}

async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token).slice(0, 4096));
  form.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

async function guard(request, env, who, { kind, n = 1, extra = 0, turnstileToken = null }) {
  const owner = (await plans.getPlan(env, who.device)).unlimited;
  if (owner) return { ok: true, remaining: null, refund: async () => {} };
  // Images get their own, looser burst limit so a deck full of pictures never trips the AI one.
  const limiter = kind === 'image' ? env.PROXY_LIMITER : env.AI_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `${kind === 'image' ? 'img' : 'ai'}:${who.ip}` });
    if (!success) throw new HttpError('طلبات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول.', 429);
  }
  // Expensive actions (outline, generate, assistant) pass a token; it is required whenever Turnstile is configured.
  if (turnstileToken !== null && !(await verifyTurnstile(env, turnstileToken, request))) {
    throw new HttpError('تعذّر التحقق من أنك لست روبوتاً. أعد المحاولة.', 403, { code: 'turnstile' });
  }
  const cost = costOf(kind, n) + extra;
  const res = await plans.chargePoints(env, who, cost);
  if (!res.ok) {
    const free = res.plan?.id === 'free';
    const msg =
      res.reason === 'plan'
        ? `هذه العملية تحتاج ${cost} نقطة، والمتبقي في الخطة ${res.plan.name} ${res.remaining} نقطة. ${free ? 'رقِّ إلى الخطة المدفوعة أو انتظر تجدد النقاط.' : 'تتجدد نقاطك مع بداية الفترة القادمة.'}`
        : res.reason === 'network'
          ? 'استُهلك الحد المجاني المتاح لهذه الشبكة. رقِّ إلى الخطة المدفوعة للمتابعة.'
          : 'الاستوديو مزدحم جداً اليوم. حاول مرة أخرى غداً.';
    throw new HttpError(msg, 429, { code: res.reason === 'global' ? 'busy' : 'credits', remaining: res.remaining });
  }
  return res;
}

function planLimitError(plan) {
  return new HttpError(
    `الخطة ${plan.name} تسمح حتى ${plan.maxCards} ${plan.maxCards > 10 ? 'شريحة' : 'شرائح'} للعرض الواحد.${plan.id === 'free' ? ' رقِّ إلى الخطة المدفوعة لعروض أكبر.' : ''}`,
    403,
    { code: 'plan_limit' },
  );
}

function aiErrorMessage(e) {
  if (e instanceof ai.AIError) return e.message;
  if (e instanceof Anthropic.RateLimitError) return 'الخدمة مزدحمة الآن. حاول بعد قليل.';
  if (e instanceof Anthropic.AuthenticationError) return 'مفتاح الذكاء الاصطناعي غير صحيح. راجع إعدادات الخادم.';
  if (e instanceof Anthropic.BadRequestError) return 'تعذّر تنفيذ الطلب. جرّب نصاً أقصر أو إعدادات أخرى.';
  if (e instanceof Anthropic.APIError) return 'حدث خطأ في خدمة الذكاء الاصطناعي. حاول مرة أخرى.';
  if (e?.name === 'AbortError') return 'أُلغي الطلب.';
  if (e?.name === 'TimeoutError') return 'استغرق التوليد وقتًا أطول من المتوقع. أعد المحاولة؛ لم تُخصم نقاط العملية الفاشلة.';
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

// Server-Sent Events response. `run(send)` streams events and returns the final payload.
function sse(request, run, { onError } = {}) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const send = (event, data) => {
    if (!open) return;
    writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => (open = false));
  };
  const ping = setInterval(() => open && writer.write(enc.encode(`: ping\n\n`)).catch(() => (open = false)), 10000);
  (async () => {
    try {
      const final = await run(send);
      send('done', final);
    } catch (e) {
      if (e?.name !== 'AbortError') console.error('stream failed', e?.code || e?.name || 'provider');
      const restored = await onError?.(e);
      if (restored?.remaining != null) send('credits', restored);
      send('error', { error: aiErrorMessage(e) });
    } finally {
      clearInterval(ping);
      open = false;
      writer.close().catch(() => {});
    }
  })();
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ---------- AI routes ----------

const waitingNotice = send => ({ seconds }) => send('notice', {
  message: seconds
    ? `الخدمة مزدحمة مؤقتًا. ننتظر ${seconds} ثانية ثم نكمل طلبك تلقائيًا؛ لا حاجة لإعادة المحاولة.`
    : 'طلبك في قائمة الانتظار. سيكمل مدار تلقائيًا عند توفر الخدمة.',
});

async function refundFailedRequest(env, credit, error) {
  await credit.refund();
  await noteQuota(env, error);
  return { remaining: (await plans.planStatus(env)).remaining };
}

// Validates an uploaded PDF or image set. Returns { type, ... } or null when none was sent.
function cleanSourceFile(file) {
  if (file?.type === 'pdf') {
    const data = str(file.data, Math.ceil((LIMITS.pdfBytes * 4) / 3) + 8);
    if (!data) throw new HttpError('الملف فارغ.');
    return { type: 'pdf', data };
  }
  if (file?.type === 'images' || file?.type === 'pages') {
    const images = (Array.isArray(file.images) ? file.images : [])
      .slice(0, file.type === 'pages' ? LIMITS.pdfPages : LIMITS.images)
      .filter((im) => /^image\/(jpeg|png|webp|gif)$/.test(im?.media_type) && typeof im.data === 'string' && im.data.length > 0 && im.data.length <= LIMITS.imageChars)
      .map((im) => ({ media_type: im.media_type, data: im.data }));
    if (!images.length) throw new HttpError('تعذّرت قراءة الصور. جرّب صوراً بصيغة JPG أو PNG.');
    return { type: 'images', images, pages: file.type === 'pages' };
  }
  return null;
}

async function routeOutline(request, env, who) {
  const body = await readJSON(request);
  const c = cfg(env);
  const mode = ['generate', 'text', 'url', 'file'].includes(body.mode) ? body.mode : 'generate';
  const plan = await plans.getPlan(env, who.device);
  const input = {
    mode,
    prompt: str(body.prompt, LIMITS.prompt).trim(),
    settings: cleanSettings(body.settings),
    cardCount: body.cardCount === 'auto' ? 'auto' : Math.min(Math.max(Number(body.cardCount) || 8, 1), plan.maxCards),
    maxCards: plan.maxCards,
    sourceMode: pick(body.sourceMode, SOURCE_MODES, 'condense'),
    text: str(body.text, LIMITS.text),
    sourceTitle: str(body.sourceTitle, 200),
  };
  if (mode === 'generate' && input.prompt.length < 3) throw new HttpError('اكتب فكرة العرض أولاً.');
  if (mode === 'text' && input.text.trim().length < 40) throw new HttpError('الصق نصاً أطول قليلاً (40 حرفاً على الأقل).');
  if (mode === 'url') {
    const page = await extractUrl(str(body.url, 2000), LIMITS.text).catch((e) => {
      throw new HttpError(e.message);
    });
    input.text = page.text;
    input.sourceTitle = page.title;
    input.truncated = page.truncated;
  }
  if (mode === 'file') {
    input.source = cleanSourceFile(body.file);
    if (!input.source && input.text.trim().length < 40) throw new HttpError('لم نجد نصاً كافياً في الملف.');
  }
  if(c.demo && input.source && !input.text.trim()) throw new HttpError('قراءة الصور والملفات المصورة تحتاج إلى تفعيل التوليد. يمكنك لصق النص أو استيراد ملف نصي.', 503);
  // Points: the outline (by slide count) plus reading the file (one per page or photo; a whole PDF counts as 5).
  const slides = input.cardCount === 'auto' ? Math.min(8, plan.maxCards) : input.cardCount;
  const readCost = input.source?.type === 'images' ? costOf('read', input.source.images.length) : input.source?.type === 'pdf' ? 5 : 0;
  const credit = await guard(request, env, who, { kind: 'outline', n: slides, extra: readCost, turnstileToken: str(body.turnstile, 4096) });
  return sse(
    request,
    async (send) => {
      send('credits', { remaining: credit.remaining });
      if (input.truncated) send('notice', { message: 'الصفحة طويلة، فاستخدمنا الجزء الأول منها فقط.' });
      await readFileForFreeEngine(env, c, input, send, request.signal);
      const handlers = {
        onTitle: (t) => send('title', { title: t }),
        onCard: (card) => send('card', card),
        onWait: waitingNotice(send),
        signal: request.signal,
      };
      const out = c.demo ? await mock.mockOutline(input, handlers) : await ai.outline(env, input, handlers);
      return { ...out.data, demo: c.demo, sourceText: mode === 'generate' ? '' : input.text };
    },
    { onError: (e) => refundFailedRequest(env, credit, e) },
  );
}

// The free engine cannot read PDFs or photos directly: turn them into text first (Claude reads them natively).
async function readFileForFreeEngine(env, c, input, send, signal) {
  if (!ai.textOnlyEngine(env) || !input.source) return;
  send('notice', { message: input.source.type === 'pdf' || input.source.pages ? 'جارٍ قراءة صفحات ملف PDF…' : 'جارٍ قراءة الصور…' });
  let text = '';
  try {
    text = await sourceToText(env, input.source, { signal, onWait: waitingNotice(send) });
  } catch (e) {
    if (e instanceof ai.AIError || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e;
    console.error('file reading failed', e?.code || e?.name || 'provider');
    if (ai.isQuotaError(e)) throw new ai.AIError(ai.QUOTA_MESSAGE, 'quota');
    throw new ai.AIError('تعذّرت قراءة الملف. جرّب ملفاً آخر أو الصق نصه في تبويب «من نص».', 'read');
  }
  if (text.replace(/\s/g, '').length < 30) {
    throw new ai.AIError(
      input.source.type === 'pdf'
        ? 'لم نجد نصاً في ملف PDF، وغالباً هو ممسوح ضوئياً. صوّر صفحاته وارفعها كصور بدلاً منه.'
        : 'لم نجد نصاً أو محتوى واضحاً في الصور. جرّب صوراً أوضح.',
      'read',
    );
  }
  input.text = text.slice(0, LIMITS.text);
  input.source = null;
}

const pausedKey = () => `d:${new Date().toISOString().slice(0, 10)}:ai-paused`;
async function noteQuota(env, e) {
  if (!ai.isQuotaError(e)) return;
  try {
    await store.bump(env, pausedKey(), 1);
  } catch {
    /* best effort */
  }
}

function cleanOutline(o = {}) {
  const cards = (Array.isArray(o.cards) ? o.cards : []).slice(0, 30).map((c) => ({
    title: str(c?.title, 300),
    points: (Array.isArray(c?.points) ? c.points : []).slice(0, 8).map((p) => str(p, 4000)),
  }));
  return { title: str(o.title, 300), cards };
}

async function routeGenerate(request, env, who) {
  const body = await readJSON(request);
  const c = cfg(env);
  const outline = cleanOutline(body.outline);
  if (!outline.cards.length) throw new HttpError('المخطط فارغ.');
  const plan = await plans.getPlan(env, who.device);
  if (outline.cards.length > plan.maxCards) throw planLimitError(plan);
  const input = {
    outline,
    settings: cleanSettings(body.settings),
    // The original request and the full source travel with the outline, so every card stays on them.
    topic: str(body.topic, LIMITS.prompt).trim(),
    sourceTitle: str(body.sourceTitle, 200),
    sourceMode: pick(body.sourceMode, SOURCE_MODES, 'condense'),
    sourceText: str(body.sourceText, LIMITS.text),
    sourceFile: cleanSourceFile(body.sourceFile),
    sourceNotes: str(body.sourceNotes, 12000),
    instructions: str(body.instructions, LIMITS.instruction),
  };
  if (ai.textOnlyEngine(env) && input.sourceFile && input.sourceText.trim()) input.sourceFile = null;
  const credit = await guard(request, env, who, { kind: 'generate', n: outline.cards.length, turnstileToken: str(body.turnstile, 4096) });
  return sse(
    request,
    async (send) => {
      send('credits', { remaining: credit.remaining });
      const handlers = {
        onTitle: (t) => send('title', { title: t }),
        onCard: (card) => send('card', card),
        onWait: waitingNotice(send),
        signal: request.signal,
      };
      if (input.sourceFile) {
        const tmp = { source: input.sourceFile, text: '' };
        await readFileForFreeEngine(env, c, tmp, send, request.signal);
        input.sourceText = tmp.text;
        input.sourceFile = tmp.source;
      }
      const out = c.demo ? await mock.mockDeck(input, handlers) : await ai.generateDeck(env, input, handlers);
      return { ...out.data, demo: c.demo };
    },
    { onError: (e) => refundFailedRequest(env, credit, e) },
  );
}

function cleanDeckForAI(d = {}) {
  const cards = (Array.isArray(d.cards) ? d.cards : []).slice(0, 30).map((c) => ({
    layout: str(c?.layout, 30),
    title: str(c?.title, 400),
    subtitle: str(c?.subtitle, 600),
    body: str(c?.body, 4000),
    notes: str(c?.notes, 2000),
    items: (Array.isArray(c?.items) ? c.items : []).slice(0, 8).map((it) => ({
      icon: str(it?.icon, 40),
      title: str(it?.title, 300),
      text: str(it?.text, 1000),
      value: str(it?.value, 60),
    })),
  }));
  return { title: str(d.title, 300), cards };
}

async function routeAssistant(request, env, who) {
  const body = await readJSON(request);
  const c = cfg(env);
  const instruction = str(body.instruction, LIMITS.instruction).trim();
  if (!instruction) throw new HttpError('اكتب طلبك للمساعد.');
  const deck = cleanDeckForAI(body.deck);
  if (!deck.cards.length) throw new HttpError('العرض فارغ.');
  const input = {
    instruction,
    deck,
    settings: cleanSettings(body.settings),
    history: (Array.isArray(body.history) ? body.history : []).slice(-6).map((m) => ({
      role: m?.role === 'user' ? 'user' : 'assistant',
      text: str(m?.text, 800),
    })),
  };
  const credit = await guard(request, env, who, { kind: 'assistant', n: deck.cards.length, turnstileToken: str(body.turnstile, 4096) });
  return sse(
    request,
    async (send) => {
      send('credits', { remaining: credit.remaining });
      const handlers = {
        onReply: (t) => send('reply', { reply: t }),
        onWait: waitingNotice(send),
        onTitle: (t) => send('title', { title: t }),
        onCard: (card) => send('card', card),
        signal: request.signal,
      };
      const out = c.demo ? await mock.mockAssistant(input, handlers) : await ai.assistant(env, input, handlers);
      return { ...out.data, demo: c.demo };
    },
    { onError: (e) => refundFailedRequest(env, credit, e) },
  );
}

async function routeCard(request, env, who) {
  const body = await readJSON(request);
  const c = cfg(env);
  const instruction = str(body.instruction, LIMITS.instruction).trim();
  if (!instruction) throw new HttpError('اكتب التعديل المطلوب.');
  const input = {
    instruction,
    card: body.card ? cleanDeckForAI({ cards: [body.card] }).cards[0] : null,
    deckTitle: str(body.deckTitle, 300),
    context: (Array.isArray(body.context) ? body.context : []).slice(0, 30).map((t) => str(t, 200)),
    position: Math.max(1, Number(body.position) || 1),
    settings: cleanSettings(body.settings),
  };
  const credit = await guard(request, env, who, { kind: 'card' });
  try {
    const out = c.demo ? await mock.mockCard(input) : await ai.editCard(env, input, { signal: request.signal });
    return json({ card: out.data, remaining: credit.remaining, demo: c.demo });
  } catch (e) {
    await credit.refund();
    await noteQuota(env, e);
    console.error('card edit failed', e?.code || e?.name || 'provider');
    throw new HttpError(aiErrorMessage(e), 502);
  }
}

// ---------- images ----------

async function routeImageGen(request, env, who) {
  const body = await readJSON(request);
  const c = cfg(env);
  const prompt = str(body.prompt, 600).trim();
  if (!prompt) throw new HttpError('اكتب وصف الصورة.');
  const topic = str(body.topic, 600);
  const deckTitle = str(body.deckTitle, 240);
  const slide = cleanSlide(body.slide);
  if (!c.aiImages) {
    // No image generator: use a free photo only if it really shows the subject.
    const photo = await matchStock(env, prompt);
    return json({ image: photo ? { ...photo, source: 'stock' } : null, fallback: true });
  }
  if (c.imageEngine === 'gemini-illustration') {
    const credit = await guard(request, env, who, { kind: 'image' });
    try {
      const img = await generateIllustration(env, { prompt, topic, deckTitle, slide, mode: body.mode === 'custom' ? 'custom' : 'automatic', aspect: body.aspect, style: body.style }, { signal: request.signal });
      const id = await store.saveImage(env, img.mime, img.base64);
      return json({ image: { url: `/madar/api/img/${id}`, alt: img.alt, query: img.alt, credit: img.concept ? 'مخطط توضيحي · مدار' : 'رسم توضيحي · Gemini / مدار', source: 'ai' }, remaining: credit.remaining });
    } catch (e) {
      const restored = await refundFailedRequest(env, credit, e);
      console.warn('illustration failed', e?.code || e?.name || 'provider');
      const message = e?.code === 'rate_limit' ? 'بلغ توليد الرسوم حد الاتصال المجاني مؤقتًا. جرّب لاحقًا؛ لم تُخصم نقطة الصورة.' : e?.code === 'image_relevance' ? 'لم ينتج رسم واضح الصلة بمحتوى البطاقة. وضّح الفكرة وأعد المحاولة؛ بقيت صورتك السابقة ولم تُخصم نقطة الصورة.' : 'تعذّر توليد الرسم التوضيحي. أعد المحاولة؛ لم تُخصم نقطة الصورة.';
      return fail(message, 502, restored);
    }
  }
  // The main generator is known to be out for now: only prepare the scene for the browser's free generators (no points).
  if (body.skipGen === true) {
    if (env.PROXY_LIMITER) {
      const { success } = await env.PROXY_LIMITER.limit({ key: `scene:${who.ip}` });
      if (!success) throw new HttpError('طلبات كثيرة. انتظر دقيقة.', 429);
    }
    const planned = await sceneFor(env, prompt, deckTitle || topic, slide);
    return json({ image: null, fallback: true, retry: { scene: planned.scene || prompt, keywords: planned.keywords || '' } });
  }
  const credit = await guard(request, env, who, { kind: 'image' });
  const style = pick(body.style, IMAGE_STYLES, 'photo');
  // One English, text-free scene about this slide (image models cannot write real text).
  const { scene: drawn, keywords, subject } = await sceneFor(env, prompt, deckTitle || topic, slide);
  const scene = drawn || prompt;
  try {
    if (c.imageEngine === 'nano-banana') {
      const aspect = ASPECTS.includes(body.aspect) ? body.aspect : '16:9';
      const img = await generateNanoBanana(env, scene, style, aspect, subject);
      // Sent back raw: the browser shrinks it to a light JPEG and stores it via /api/upload.
      return json({ image: { data: img.base64, mime: img.mime, alt: prompt, credit: 'Nano Banana · مدار', source: 'ai' }, remaining: credit.remaining });
    }
    const img = await generateImage(env, scene, style, subject);
    const id = await store.saveImage(env, img.mime, img.base64);
    return json({ image: { url: `/madar/api/img/${id}`, alt: prompt, credit: 'AI · مدار', source: 'ai' }, remaining: credit.remaining });
  } catch (e) {
    await credit.refund();
    await noteQuota(env, e);
    console.error('image generation failed', e?.code || e?.name || 'provider');
    // The browser moves on to its free generators, then to a matching photo.
    return json({ image: null, fallback: true, retry: { scene, keywords: keywords || '' } });
  }
}

function cleanSlide(s) {
  if (!s || typeof s !== 'object') return null;
  const title = str(s.title, 240).trim();
  if (!title) return null;
  return {
    title,
    subtitle: str(s.subtitle, 300),
    body: str(s.body, 1200),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 6).map((t) => str(t, 240)),
  };
}

// Automatic free photos for a slide: only a photo that matches its subject.
async function routeImageMatch(request, env, who) {
  if (env.PROXY_LIMITER) {
    const { success } = await env.PROXY_LIMITER.limit({ key: `match:${who.ip}` });
    if (!success) throw new HttpError('طلبات كثيرة. انتظر دقيقة.', 429);
  }
  const body = await readJSON(request);
  const query = str(body.query, 300).trim();
  if (!query) throw new HttpError('لا يوجد وصف للصورة.');
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).filter(u => typeof u === 'string').slice(0, 30);
  const photo = await matchStock(env, query, str(body.keywords, 100), exclude).catch(() => null);
  return json({ image: photo ? { ...photo, source: 'stock' } : null });
}

const UPLOADS_PER_DAY = 200;

async function routeUpload(request, env, who) {
  const limiter = env.PROXY_LIMITER || env.AI_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `up:${who.ip}` });
    if (!success) throw new HttpError('طلبات كثيرة. انتظر دقيقة.', 429);
  }
  const type = request.headers.get('content-type') || '';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new HttpError('نوع الصورة غير مدعوم.', 415);
  if (Number(request.headers.get('content-length') || 0) > LIMITS.upload) throw new HttpError('الصورة كبيرة جداً.', 413);
  // A daily cap per network keeps the free database from being filled by one visitor.
  if (!(await plans.getPlan(env, who.device)).unlimited) {
    const n = await store.bump(env, `d:${new Date().toISOString().slice(0, 10)}:up:${who.ip}`, 1);
    if (n > UPLOADS_PER_DAY) throw new HttpError('وصلت إلى حد رفع الصور اليومي. حاول غداً.', 429);
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > LIMITS.upload) throw new HttpError('الصورة كبيرة جداً.', 413);
  let bin = '';
  const bytes = new Uint8Array(buf);
  const signature = Buffer.from(bytes.subarray(0,16));
  const valid = type==='image/png' ? signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type==='image/jpeg' ? signature[0]===255&&signature[1]===216&&signature[2]===255
    : type==='image/gif' ? /^GIF8[79]a/.test(signature.toString('ascii'))
    : signature.subarray(0,4).toString('ascii')==='RIFF'&&signature.subarray(8,12).toString('ascii')==='WEBP';
  if (!valid) throw new HttpError('الملف لا يطابق نوع الصورة.',415);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const id = await store.saveImage(env, type, btoa(bin));
  return json({ url: `/madar/api/img/${id}` });
}

// Authorize every image read. A URL or a previous cache entry never grants access.
async function routeImg(request, env, ctx, id) {
  const row = await store.getImage(env, id);
  if (!row) return new Response('not found', { status: 404 });
  let bytes;
  if (typeof Uint8Array.fromBase64 === 'function') bytes = Uint8Array.fromBase64(row.data);
  else {
    const bin = atob(row.data);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  const res = new Response(bytes, {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  return res;
}

// ---------- decks ----------

function cleanDeckForStore(d) {
  const text = JSON.stringify(d || {});
  if (text.length > LIMITS.deckBytes) throw new HttpError('العرض كبير جداً للنشر.', 413);
  if (!Array.isArray(d?.cards) || !d.cards.length) throw new HttpError('العرض فارغ.');
  return d;
}

async function routeDecks(request, env, url, who) {
  const m = url.pathname.match(/^\/api\/decks(?:\/([a-z0-9]{6,20}))?$/);
  if (!m) throw new HttpError('غير موجود', 404);
  const id = m[1];
  if (!id && request.method === 'POST') {
    if (env.AI_LIMITER) {
      const { success } = await env.AI_LIMITER.limit({ key: who.ip });
      if (!success) throw new HttpError('طلبات كثيرة. انتظر دقيقة.', 429);
    }
    const body = await readJSON(request, 2 * 1024 * 1024);
    const deck = cleanDeckForStore(body.deck);
    return json(await store.createDeck(env, deck), 201);
  }
  if (id && request.method === 'GET') {
    const got = await store.getDeck(env, id, { countView: url.searchParams.get('view') === '1' });
    return got ? json(got) : fail('العرض غير موجود في حسابك أو حُذفت نسخته المحفوظة.', 404);
  }
  if (id && request.method === 'PUT') {
    const body = await readJSON(request, 2 * 1024 * 1024);
    const ok = await store.updateDeck(env, id, str(body.editKey, 100), cleanDeckForStore(body.deck));
    return ok ? json({ ok: true }) : fail('لا تملك صلاحية تعديل هذا العرض.', 403);
  }
  if (id && request.method === 'DELETE') {
    const body = await readJSON(request);
    const ok = await store.deleteDeck(env, id, str(body.editKey, 100));
    return ok ? json({ ok: true }) : fail('لا تملك صلاحية حذف هذا العرض.', 403);
  }
  throw new HttpError('طريقة غير مدعومة', 405);
}

// ---------- router ----------

async function api(request, env, ctx, url) {
  const p = url.pathname;
  const ip = env.accountId;
  // Each browser carries a signed device id (issued by /api/config); requests without one count against the network.
  const deviceId = env.accountId;
  const who = { device: deviceId || `ip-${ip}`, ip };
  if (Math.random() < 0.02) ctx.waitUntil(store.pruneUsage(env).catch(() => {}));

  if (p === '/api/config' && request.method === 'GET') {
    const c = cfg(env);
    let issued = null;
    if (!deviceId) {
      issued = await plans.issueDevice(env);
      who.device = issued.id;
    }
    const pc = plans.planCfg(env);
    const plan = await plans.planStatus(env, who.device);
    return json({
      demo: c.demo,
      textEngine: c.textEngine,
      engines: ai.textEngines(env),
      maxCards: plan.maxCards,
      aiImages: c.aiImages,
      imageEngine: c.imageEngine,
      aiPaused: c.textEngine === 'workers-ai' && (await store.usageOf(env, pausedKey())) > 0,
      plan,
      plans: { free: pc.free, paid: pc.paid, pro: pc.pro, period: pc.period },
      purchaseUrl: pc.purchaseUrl,
      device: issued?.token || null,
      turnstileSiteKey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY || '' : '',
    });
  }
  if (p === '/api/redeem' && request.method === 'POST') {
    if (!deviceId) throw new HttpError('حدّث الصفحة ثم أعد المحاولة.', 400);
    if (env.AI_LIMITER) {
      const { success } = await env.AI_LIMITER.limit({ key: `redeem:${ip}` });
      if (!success) throw new HttpError('محاولات كثيرة. انتظر دقيقة.', 429);
    }
    const body = await readJSON(request);
    const r = await plans.redeem(env, deviceId, body.code);
    if (!r.ok) throw new HttpError(r.message, 400);
    return json({ ok: true, plan: await plans.planStatus(env, deviceId) });
  }
  if (p === '/api/admin/owner') {
    if (!(await plans.isAdmin(request, env))) throw new HttpError('غير مصرّح.', 401);
    if (!deviceId) throw new HttpError('حدّث الصفحة ثم أعد المحاولة.', 400);
    if (request.method === 'POST') {
      const body = await readJSON(request);
      await plans.setOwner(env, deviceId, body.on !== false);
    }
    return json({ plan: await plans.planStatus(env, deviceId) });
  }
  if (p === '/api/admin/codes') {
    if (!(await plans.isAdmin(request, env))) throw new HttpError('غير مصرّح.', 401);
    if (request.method === 'GET') return json({ codes: await plans.listCodes(env) });
    if (request.method === 'POST') {
      const body = await readJSON(request);
      return json({ codes: await plans.createCodes(env, { count: Number(body.count), days: Number(body.days), note: str(body.note, 200), plan: str(body.plan, 10) }) }, 201);
    }
  }
  if (cfg(env).demo && ['/api/assistant', '/api/card'].includes(p)) return fail('المساعد الذكي غير مفعّل حاليًا. يمكنك تحرير البطاقات يدويًا.',503);
  if (cfg(env).demo && ['/api/image-gen', '/api/image-match', '/api/images'].includes(p)) return json(p==='/api/images'?{results:[]}:{image:null});
  if (request.method === 'POST') {
    if (p === '/api/outline') return routeOutline(request, env, who);
    if (p === '/api/generate') return routeGenerate(request, env, who);
    if (p === '/api/assistant') return routeAssistant(request, env, who);
    if (p === '/api/card') return routeCard(request, env, who);
    if (p === '/api/image-gen') return routeImageGen(request, env, who);
    if (p === '/api/image-match') return routeImageMatch(request, env, who);
    if (p === '/api/upload') return routeUpload(request, env, who);
  }
  if (request.method === 'GET') {
    if (p === '/api/images') {
      const results = await searchImages(env, url.searchParams.get('q') || '', Math.max(1, Number(url.searchParams.get('page')) || 1));
      return json({ results }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }
    if (p === '/api/proxy') {
      if (env.PROXY_LIMITER) {
        const { success } = await env.PROXY_LIMITER.limit({ key: who.ip });
        if (!success) return new Response('slow down', { status: 429 });
      }
      return proxyImage(url.searchParams.get('u') || '');
    }
    const img = p.match(/^\/api\/img\/([a-z0-9]{8,24})$/);
    if (img) return routeImg(request, env, ctx, img[1]);
  }
  if (p.startsWith('/api/decks')) return routeDecks(request, env, url, who);
  throw new HttpError('غير موجود', 404);
}

// /d/<id>: the shared-deck page. Serves the app shell with the deck title in the link-preview tags.
async function sharePage(request, env, url) {
  const id = url.pathname.split('/')[2] || '';
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (!/^[a-z0-9]{6,20}$/.test(id)) return shell;
  let title = '';
  try {
    const got = await store.getDeck(env, id);
    title = got?.title || '';
  } catch {
    /* fall back to the default tags */
  }
  if (!title) return shell;
  // A published title is visitor text: it must never reach the page as HTML.
  const t = `${title} | مدار`.replace(/[<>"&]/g, ' ').replace(/\s+/g, ' ').trim();
  return new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(t) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', t) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', url.toString()) })
    .transform(shell);
}

// Browsers must treat every response as the type it declares.
function secured(res) {
  if (res.headers.get('X-Content-Type-Options') === 'nosniff' || res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return secured(await api(request, env, ctx, url));
      if (url.pathname.startsWith('/d/')) return secured(await sharePage(request, env, url));
      return secured(await env.ASSETS.fetch(request));
    } catch (e) {
      if (e instanceof HttpError) return secured(fail(e.message, e.status, e.extra));
      if (e?.code==='madar_storage_limit') return secured(fail(e.message,413));
      console.error('unhandled', e?.stack || e);
      return secured(fail('حدث خطأ في الخادم.', 500));
    }
  },
};
