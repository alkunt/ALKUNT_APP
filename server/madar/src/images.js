import { isPublicUrl, safeFetch } from './extract.js';
import { cfText } from './ai.js';
import { geminiCompletion } from './gemini-client.js';

// Image search (free stock photos) and AI image generation.
// Providers, first configured wins: Pexels (PEXELS_API_KEY) → Unsplash (UNSPLASH_ACCESS_KEY) → Openverse (no key).

const UA = 'MadarStudio/1.0 (+presentation builder)';

async function pexels(env, q, page) {
  const r = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15&page=${page}`,
    { headers: { Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error('pexels ' + r.status);
  const j = await r.json();
  return j.photos.map((p) => ({
    url: p.src.large2x || p.src.large,
    thumb: p.src.medium,
    alt: p.alt || q,
    credit: `${p.photographer} · Pexels`,
    link: p.url,
  }));
}

async function unsplash(env, q, page) {
  const r = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=15&page=${page}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` }, signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error('unsplash ' + r.status);
  const j = await r.json();
  return j.results.map((p) => ({
    url: p.urls.regular,
    thumb: p.urls.small,
    alt: p.alt_description || q,
    credit: `${p.user.name} · Unsplash`,
    link: p.links.html,
  }));
}

async function openverse(q, page) {
  const r = await fetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=15&page=${page}&license_type=commercial,modification&mature=false&filter_dead=true`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error('openverse ' + r.status);
  const j = await r.json();
  return (j.results || [])
    .filter((p) => p.url && /^https:/.test(p.url))
    .map((p) => ({
      url: p.url,
      thumb: p.thumbnail || p.url,
      alt: p.title || q,
      tags: (p.tags || []).map((t) => t?.name).filter(Boolean).join(' ').slice(0, 400),
      credit: [p.creator, p.license ? `CC ${p.license.toUpperCase()}` : '', p.source].filter(Boolean).join(' · '),
      link: p.foreign_landing_url || p.url,
    }));
}

export async function searchImages(env, q, page = 1) {
  q = (await toEnglish(env, q.trim().slice(0, 300))).slice(0, 120);
  if (!q) return [];
  const cacheKey = new Request(`https://madar.cache/images?q=${encodeURIComponent(q.toLowerCase())}&p=${page}`);
  // Railway/Node has no Workers Cache API. A missing cache must not prevent
  // all photo searches from reaching their provider.
  const cache = globalThis.caches?.default;
  const hit = await cache?.match(cacheKey).catch(() => null);
  if (hit) return hit.json();

  const chain = [];
  if (env.PEXELS_API_KEY) chain.push((v) => pexels(env, v, page));
  if (env.UNSPLASH_ACCESS_KEY) chain.push((v) => unsplash(env, v, page));
  chain.push((v) => openverse(v, page));

  // Long descriptive queries often match nothing, so retry with shorter ones.
  const words = q.split(/\s+/);
  const variants = [q];
  if (words.length > 4) variants.push(words.slice(0, 4).join(' '));
  if (words.length > 2) variants.push(words.filter((w) => w.length > 3).slice(0, 2).join(' ') || words.slice(0, 2).join(' '));

  let results = [];
  outer: for (const variant of variants) {
    for (const run of chain) {
      try {
        results = await run(variant);
        if (results.length) break outer;
      } catch (e) {
        console.warn('image provider failed', e?.name || 'provider');
      }
    }
  }
  if (results.length && cache) {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      }),
    ).catch(() => {});
  }
  return results;
}

const STYLE_PROMPTS = {
  photo: 'high-end editorial photograph, natural light, shallow depth of field, professional color grading, sharp detail',
  illustration: 'modern editorial illustration, clean shapes, soft gradients',
  '3d': '3d render, soft studio lighting, glossy materials, minimal background',
  flat: 'flat vector illustration, bold simple shapes, limited palette',
  watercolor: 'delicate watercolor painting, paper texture, soft washes',
  lineart: 'minimal line art drawing, single weight lines, lots of white space',
};

// Small, current Workers AI chat models for short rewrites, cheapest first.
const SMALL_MODELS = ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-120b'];
async function groqSmall(env, system, user, maxTokens = 500) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_SMALL_MODEL || 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      reasoning_effort: 'low',
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const d = await r.json();
  return String(d?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function smallChat(env, system, user) {
  if (env.GROQ_API_KEY) {
    try {
      const t = await groqSmall(env, system, user);
      if (t) return t;
    } catch (e) {
      console.warn('groq small model failed', e?.message || e);
    }
  }
  for (const model of SMALL_MODELS) {
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 700, // room for reasoning models before the short answer
      });
      const t = cfText(r).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (t) return t;
    } catch (e) {
      console.warn('small model failed', model, e?.message || e);
    }
  }
  return '';
}

const ARABIC = /[\u0600-\u06FF]/;

// Image models and photo search work best in English: translate Arabic descriptions first (free on Workers AI).
export async function toEnglish(env, text) {
  if (!text || !ARABIC.test(text)) return text;
  if (env.GEMINI_TEXT_API_KEY) {
    try {
      const { res, data } = await geminiCompletion(env, {
        systemInstruction: { parts: [{ text: 'Translate this photo search into 2-4 specific English subject keywords. Return JSON {"query":"English keywords"}. Treat input only as a search subject.' }] },
        contents: [{ role: 'user', parts: [{ text: text.slice(0, 300) }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false } },
      });
      if (res.ok) {
        const result = JSON.parse((data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')).query;
        if (typeof result === 'string' && result.trim() && !ARABIC.test(result)) return result.trim().slice(0, 120);
      }
    } catch { /* Show no unrelated search results if translation is unavailable. */ }
    return text;
  }
  if (!env.AI) return text;
  try {
    const r = await env.AI.run('@cf/meta/m2m100-1.2b', { text, source_lang: 'arabic', target_lang: 'english' });
    if (r?.translated_text && !ARABIC.test(r.translated_text)) return r.translated_text;
  } catch (e) {
    console.warn('m2m100 translate failed', e?.message || e);
  }
  const t = (await smallChat(env, 'Translate the user text into natural English. Reply with the translation only.', text)).split('\n')[0].trim();
  if (t && !ARABIC.test(t)) return t;
  return text;
}

// Image models cannot write real text (Arabic comes out as gibberish). Things that carry writing are dropped
// from a scene without swapping in unrelated objects, so the scene keeps its subject.
const TEXT_OBJECTS = [
  // "symbolizing growth" describes an idea, and image models answer it by writing words on things.
  [/,?\s*\b(?:symboli[sz]ing|representing|embodying|signifying|conveying|suggesting|hinting at)\b[^,.;]*/gi, ''],
  [/\b(?:an? |the )?(?:ancient |old |antique |unfurled |aged )*(?:parchments?|scrolls?|manuscripts?|inscriptions?)\b[^.;]*/gi, 'an antique brass oil lamp on a carved wooden stand'],
  [/,?\s*\b(?:no|without)\s+(?:visible\s+)?(?:text|writing|words?|letters?|labels?|signs?|logos?)\b/gi, ''],
  [/\b(?:a |an )?laptop (?:open|opened|showing|displaying)\b[^,.;]*/gi, 'a closed laptop'],
  [/\b(?:an? )?(?:open |opened )?(?:monthly |weekly |daily )?(?:planners?|clipboards?|calendars?|schedules?|timetables?)\b(?: (?:with|showing|displaying) [^,.;]*)?/gi, ''],
  [/\b(?:an? )?open showing [^,.;]*/gi, ''],
  [/\b(?:an? )?(?:leather[\u2011-]bound|hardcover|book|notebook|journal|ledger)(?: book| notebook| journal)? open(?:ed)? to\b[^,.;]*/gi, ''],
  [/\b(?:an? )?(?:open |leather[\u2011-]bound )*(?:notebooks?|journals?|ledgers?|binders?)\b(?: (?:with|showing) [^,.;]*)?/gi, ''],
  [/\b(?:colou?rful |illustrated |children's )*story ?books?\b/gi, 'plain solid-color hardcover book'],
  [/\b(?:storefronts?|shop ?fronts?)\b/gi, 'outdoor terraces'],
  [/\bArabic\b/g, 'Middle Eastern'],
  // Scripture is never drawn as a page: a generator would fake the sacred text.
  [/\b(?:an? |the )?(?:(?:open|opened|sunlit|illuminated) )*(?:pages? of (?:an? |the )?)?(?:holy )?(?:qur'?an|koran|bible|torah|scriptures?|surah)\b(?: (?:page|pages|opened to [\w' -]+))?/gi, 'amber prayer beads beside a brass lantern'],
  [/\bopen (books?|textbooks?|notebooks?)\b/gi, 'closed $1'],
  [/\b(?:on|with|showing|displaying) (?:a |an |the )?(?:digital |computer |tv |phone )?(?:screens?|monitors?|dashboards?)\b/gi, ''],
  [/\b(?:bar |line |pie )?(?:charts?|graphs?|infographics?|diagrams?|spreadsheets?|kpis?)\b/gi, ''],
  [/\b(?:logos?|logotypes?|emblems?|trademarks?|brand marks?|monograms?|wordmarks?)\b/gi, ''],
  [/\b(?:signs?|signage|signboards?|billboards?|banners?|posters?|flyers?|brochures?|labels?|stickers?|price tags?|price lists?|menu boards?)\b/gi, ''],
  [/\b(?:an? )?(?:small |neat )?(?:stacks? of )?(?:loyalty|business|gift|membership|flash) cards?\b/gi, ''],
  [/\b(?:an? )?(?:newspapers?|magazines?|certificates?|whiteboards?|blackboards?|chalkboards?|thought bubbles?|speech bubbles?)\b/gi, ''],
  [/\b(?:text|words?|letters?|lettering|typography|captions?|headlines?|slogans?|handwriting|calligraphy|digits?)\b/gi, ''],
];

// A business seen from the street always comes with an invented sign, so show what it offers up close instead.
const BUSINESS_VIEWS = [
  [/\b(?:coffee|caf[eé]|espresso)\b/i, 'Close-up of hands holding a cup of specialty coffee at a wooden cafe table'],
  [/\b(?:restaurant|diner|kitchen|food)\b/i, 'Close-up of a beautifully plated meal on a restaurant table'],
  [/\b(?:bakery|pastr)/i, 'Close-up of fresh golden pastries on a wooden board'],
  [/\b(?:shop|store|boutique|mall|retail)\b/i, 'Close-up of a customer\'s hands choosing a product from a neat wooden shelf'],
];
const STREET_VIEW = /\b(?:street|downtown|fa[cç]ade|storefronts?|shop ?fronts?|shopping district|strip mall|high street)\b/i;

export function cleanScene(text) {
  let t = String(text || '');
  if (STREET_VIEW.test(t)) {
    const view = BUSINESS_VIEWS.find(([re]) => re.test(t));
    if (view) t = view[1];
  }
  for (const [re, sub] of TEXT_OBJECTS) t = t.replace(re, sub);
  // Tidy the words left dangling by a removal ("with in", "and,").
  for (let i = 0; i < 3; i++) t = t.replace(/\s{2,}/g, ' ').replace(/\b(?:a|an|the|of|with|and|on|in|showing|displaying)\s+(?=(?:with|of|and|on|in|at)\b|[,.;]|$)/gi, '');
  return t
    .replace(/\b(a|an|the) (a|an)\b/gi, '$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,.;]+|[\s,;]+$/g, '')
    .trim();
}

const ART_DIRECTOR =
  'You are the art director of a presentation. For ONE slide, design the single image a viewer would instantly connect to THIS slide\'s specific subject inside the deck topic.\n' +
  'Rules:\n' +
  '1. Show the actual subject of the slide: name its real objects, place and action. For an abstract idea, pick the most recognizable real-world symbol of that exact idea. Never fall back on a generic person at a desk, classroom, office, meeting or handshake unless the slide is literally about that.\n' +
  '2. Keep the culture, place and era of the deck topic.\n' +
  '3. The image generator cannot write. Nothing that carries writing: no signs, labels, open books, pages, scrolls, parchment, manuscripts, inscriptions, calligraphy, documents, screens, charts, maps, posters, logos, shop fronts, commercial streets, chalkboards, packaging or branded cups. Express those ideas through physical objects. For decor say "geometric patterns", never "Arabic".\n' +
  '4. Religious topics: never show pages of the Quran or any scripture, prophets, angels, God or named holy figures. Use respectful architecture, light, lanterns, prayer beads or nature, and no books.\n' +
  '5. One single scene: no collages, split panels, vignettes, before/after or thought bubbles. At most two people; prefer objects and places.\n' +
  '6. Describe only what is physically visible, as a close or medium shot with a plain background. Never mention numbers, metrics, or what the image symbolizes or represents.\n' +
  'Reply with JSON only: {"scene":"one English sentence, max 35 words, the main subject first","keywords":"2-3 English nouns for a photo search, most specific first","subject":"the deck topic in 2-5 English words"}';

// Slides about religious rulings or sacred texts get a calm, respectful image and never a generated "holy" page.
const SACRED = /الشريعة|شرع|القرآن|قرآن|آية|آيات|سورة|الحديث|حديث نبوي|السنة النبوية|النبي|الرسول|فقه|فتوى|التحريم|حرام|في الإسلام|حكم الإسلام/;
const SACRED_RULE =
  '\nThis slide discusses religion. Ignore the writer\'s image idea and show ONLY one of: an empty mosque courtyard with arches at sunrise, lantern light on geometric tiles, amber prayer beads on plain cloth, or a calm desert dawn. No people, hands, books, amulets, altars or objects of superstition.';
const SACRED_SCENE = 'An empty mosque courtyard with stone arches and geometric tiles at sunrise, warm soft light';

const ARABIC_TEXT = /[\u0600-\u06FF]/;
const short = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function artDirect(env, idea, topic, slide) {
  const points = (slide.items || []).map((t) => short(t, 60)).filter(Boolean).slice(0, 5).join('; ');
  const brief =
    `Deck topic: ${short(topic, 300) || 'general'}\nSlide title: ${short(slide.title, 160)}\n` +
    (slide.subtitle ? `Slide subtitle: ${short(slide.subtitle, 160)}\n` : '') +
    (slide.body ? `Slide text: ${short(slide.body, 320)}\n` : '') +
    (points ? `Slide points: ${points}\n` : '') +
    `Writer's image idea: ${short(idea, 200)}`;
  const sacred = SACRED.test(`${slide.title} ${slide.subtitle || ''} ${slide.body || ''}`);
  const reply = await smallChat(env, ART_DIRECTOR + (sacred ? SACRED_RULE : ''), brief);
  const at = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (at < 0 || end <= at) return null;
  try {
    const j = JSON.parse(reply.slice(at, end + 1));
    const scene = short(j.scene, 320);
    if (scene.length < 15 || ARABIC_TEXT.test(scene)) return null;
    const clean = (v) => (ARABIC_TEXT.test(String(v || '')) ? '' : short(v, 80));
    return { scene: cleanScene(scene), keywords: clean(j.keywords), subject: clean(j.subject) };
  } catch {
    return null;
  }
}

// Turns a slide into one English, text-free scene about that slide's subject.
// Without slide details (a prompt typed by the user), it keeps the user's own idea.
export async function sceneFor(env, idea, topic = '', slide = null) {
  if (slide?.title && env.AI) {
    const directed = await artDirect(env, idea, topic, slide).catch((e) => (console.warn('art direction failed', e?.message || e), null));
    if (directed) return directed;
    if (SACRED.test(`${slide.title} ${slide.body || ''}`)) return { scene: SACRED_SCENE, keywords: 'mosque courtyard arches', subject: '' };
  }
  if (!ARABIC_TEXT.test(idea)) return { scene: cleanScene(idea), keywords: '', subject: '' };
  return { scene: cleanScene(await toEnglish(env, idea)), keywords: '', subject: '' };
}

// ---------- stock photos only when they really match ----------
const NOT_SUBJECT = new Set(
  'a an the of in on at to with and or for from by over under near into through while during beside behind around its their his her this that these those is are showing soft warm bright dim natural golden light lighting sunlight morning evening night close closeup close-up up view shot photo photograph image scene modern traditional beautiful elegant serene quiet calm young old small large big single one two three person people man woman holding sitting standing looking wooden table background atmosphere mood style detail'.split(' '),
);

function subjectWords(text) {
  const seen = new Set();
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !NOT_SUBJECT.has(w) && !seen.has(w) && seen.add(w));
}

// A free photo is used only if its own title or tags mention the subject. A wrong picture is worse than none.
export async function matchStock(env, query, keywords = '', exclude = []) {
  const english = await toEnglish(env, short(query, 200));
  const words = subjectWords(keywords || english);
  if (!words.length) return null;
  const need = Math.min(words.length, 2);
  for (const size of [4, 3, 2]) {
    if (size > words.length && size !== 2) continue;
    const results = await searchImages(env, words.slice(0, size).join(' ')).catch(() => []);
    let best = null;
    let bestScore = 0;
    for (const r of results) {
      if (exclude.includes(r.url)) continue;
      const own = new Set(subjectWords(`${r.alt || ''} ${r.tags || ''}`));
      const score = words.filter((w) => own.has(w) || own.has(`${w}s`) || own.has(w.replace(/s$/, ''))).length;
      if (score >= need && score > bestScore) [best, bestScore] = [r, score];
    }
    if (best) return best;
  }
  return null;
}

export const NO_TEXT =
  'Strictly no text of any kind: no letters, words or numbers in any language, no signs, logos, labels, posters or screens with content. ' +
  'Every surface is plain and unmarked; background softly blurred.';

export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

const NANO_STYLES = {
  photo: 'Ultra-realistic high-end editorial photograph, natural light, shallow depth of field, 35mm lens, professional color grading, rich detail',
  illustration: 'Premium modern editorial illustration, clean confident shapes, refined soft gradients, cohesive palette',
  '3d': 'Polished 3D render, soft studio lighting, glossy premium materials, subtle reflections, minimal background',
  flat: 'Clean flat vector illustration, bold simple shapes, limited harmonious palette, generous negative space',
  watercolor: 'Delicate watercolor painting, visible paper texture, soft layered washes, elegant restraint',
  lineart: 'Minimal fine line art drawing, single weight lines, lots of white space, elegant and precise',
};

// Google's Nano Banana image models (Gemini API, generateContent). Needs the GEMINI_API_KEY secret.
// Returns the raw image; the browser shrinks it to JPEG and stores it through /api/upload.
export async function generateNanoBanana(env, prompt, style, aspect, topic = '') {
  const model = env.IMAGE_MODEL || 'gemini-nano-banana-2.1';
  const imageConfig = { aspectRatio: ASPECTS.includes(aspect) ? aspect : '16:9' };
  // The original Nano Banana (2.5) does not accept imageSize.
  if (!model.startsWith('gemini-2.5')) imageConfig.imageSize = ['1K', '2K', '4K'].includes(env.IMAGE_SIZE) ? env.IMAGE_SIZE : '2K';
  const text =
    `${prompt}. ${NANO_STYLES[style] || NANO_STYLES.photo}. ` +
    (topic ? `The image belongs to a presentation about "${topic.replace(/"/g, '')}" and must clearly relate to that subject. ` : '') +
    'Composed for a professional presentation slide: one clear subject, calm uncluttered background, balanced negative space. ' +
    NO_TEXT;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: text.slice(0, 3000) }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
  });
  const base = (env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  let res;
  for (const version of ['v1beta', 'v1']) {
    res = await fetch(`${base}/${version}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body,
      signal: AbortSignal.timeout(90000),
    });
    if (res.status !== 404) break;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`nano banana ${res.status}: ${data?.error?.message || 'request failed'}`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.map((p) => p.inlineData || p.inline_data).find((d) => d?.data);
  if (!img) throw new Error(`nano banana returned no image (${data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'unknown'})`);
  return { mime: img.mimeType || img.mime_type || 'image/png', base64: img.data, model };
}

// Workers AI (FLUX.1 schnell). Used when there is no GEMINI_API_KEY and the "ai" binding is enabled.
// Free within Cloudflare's daily Workers AI allowance.
export async function generateImage(env, prompt, style, subject = '') {
  // A tight shot with a blurred background also keeps stray signs and shelves, where models invent writing, out of frame.
  const framing = !style || style === 'photo' ? 'Tight close-up on the main subject, background fully blurred into soft bokeh' : 'One clear subject on a simple plain background';
  const full =
    `${prompt}. ${framing}. ${subject ? `Theme: ${subject}. ` : ''}${NANO_STYLES[style] || NANO_STYLES.photo}. ` +
    'Balanced composition. Plain unmarked surfaces, no writing anywhere.';
  // steps: 6 keeps the look of the maximum (8) at about a quarter less of the daily AI allowance.
  const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: full.slice(0, 2000), steps: 6 });
  if (!out?.image) throw new Error('no image returned');
  return { mime: 'image/jpeg', base64: out.image };
}

// Fetches a remote image for exports (PPTX/PNG need same-origin bytes).
// Raster images only: an SVG served from this site could run scripts in a visitor's browser.
const PROXY_TYPES = /^image\/(jpeg|jpg|png|webp|gif|avif)\b/i;

export async function proxyImage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!isPublicUrl(u)) return new Response('bad url', { status: 400 });
  let r;
  try {
    r = await safeFetch(u.toString(), {
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      cf: { cacheTtl: 86400, cacheEverything: true },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
  const type = r.headers.get('content-type') || '';
  const len = Number(r.headers.get('content-length') || 0);
  if (!r.ok || !PROXY_TYPES.test(type) || len > 10 * 1024 * 1024) {
    return new Response('not an image', { status: 415 });
  }
  return new Response(r.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
