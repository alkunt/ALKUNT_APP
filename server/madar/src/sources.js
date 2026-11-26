// Reads uploaded PDFs and photos into plain text with free Workers AI tools, for the free text engine
// (Claude reads these files natively, so this path is only used without an ANTHROPIC_API_KEY).
import { cfText } from './ai.js';

const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Arabic PDFs often store letters in "presentation forms"; NFKC turns them back into normal letters.
function tidy(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Text-based PDFs: Cloudflare's Markdown conversion (free for PDFs).
export async function pdfToText(env, base64) {
  const blob = new Blob([fromBase64(base64)], { type: 'application/pdf' });
  const res = await env.AI.toMarkdown([{ name: 'source.pdf', blob }], {
    conversionOptions: { output: { format: 'text' }, pdf: { metadata: false } },
  });
  const r = Array.isArray(res) ? res[0] : res;
  if (!r || r.format === 'error') throw new Error(r?.error || 'pdf conversion failed');
  return tidy(r.data);
}

// Photos (notes, slides, whiteboards, documents): a vision model transcribes the text and describes visuals.
const READ_PROMPT =
  'Read these images carefully. First transcribe ALL visible text exactly, in its original language and reading order ' +
  '(Arabic stays in Arabic, right to left). Then, after a line "---", briefly describe any diagrams, charts, tables or photos ' +
  'and what they show, in the same language as the text. Output plain text only, without commentary.';

// Free vision model on Groq: reads files first, so Cloudflare's daily allowance is not the only way to read them.
async function readWithGroq(env, images) {
  const content = [
    { type: 'text', text: READ_PROMPT },
    ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } })),
  ];
  const body = { model: env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b', messages: [{ role: 'user', content }], max_completion_tokens: 4000, temperature: 0.1, reasoning_format: 'hidden' };
  const send = (b) =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(50000),
    });
  let res = await send(body);
  let data = await res.json().catch(() => ({}));
  if (res.status === 400 && /reasoning/i.test(data?.error?.message || '')) {
    delete body.reasoning_format;
    res = await send(body);
    data = await res.json().catch(() => ({}));
  }
  const wait = res.status === 429 ? Number(String(data?.error?.message || '').match(/try again in (\d+(?:\.\d+)?)s\b/)?.[1]) : NaN;
  if (wait > 0 && wait <= 12) {
    await new Promise((r) => setTimeout(r, (wait + 0.4) * 1000));
    res = await send(body);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(`groq vision ${res.status}: ${data?.error?.message || ''}`);
  return tidy(String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, ''));
}

async function readBatch(env, images) {
  if (env.GROQ_API_KEY) {
    try {
      const text = await readWithGroq(env, images);
      if (text) return text;
    } catch (e) {
      console.warn('groq vision failed, trying Cloudflare:', e?.message || e);
    }
  }
  const content = [
    { type: 'text', text: READ_PROMPT },
    ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}`, detail: 'high' } })),
  ];
  const r = await env.AI.run(VISION_MODEL, { messages: [{ role: 'user', content }], max_tokens: 6000 });
  return tidy(cfText(r).replace(/<think>[\s\S]*?<\/think>/gi, ''));
}

// Reads up to 15 images (photos or PDF pages) three at a time, two batches in parallel, keeping page order.
export async function imagesToText(env, images) {
  const batches = [];
  for (let i = 0; i < images.length; i += 3) batches.push(images.slice(i, i + 3));
  const out = new Array(batches.length).fill('');
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (next < batches.length) {
        const i = next++;
        out[i] = await readBatch(env, batches[i]);
      }
    }),
  );
  return out.filter(Boolean).join('\n\n');
}

export async function sourceToText(env, source) {
  if (source?.type === 'pdf') return pdfToText(env, source.data);
  if (source?.type === 'images') return imagesToText(env, source.images);
  return '';
}
