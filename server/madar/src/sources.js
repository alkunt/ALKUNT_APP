// Reads uploaded PDFs and photos into plain text with free Workers AI tools, for the free text engine
// (Claude reads these files natively, so this path is only used without an ANTHROPIC_API_KEY).
import { AIError, cfText } from './ai.js';
import { groqCompletion } from './groq-client.js';

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

// Read files on the configured Groq connection, without forwarding them elsewhere on failure.
async function readWithGroq(env, images, options) {
  const content = [
    { type: 'text', text: READ_PROMPT },
    ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } })),
  ];
  const body = { model: env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b', messages: [{ role: 'user', content }], max_completion_tokens: 4000, temperature: 0.1, reasoning_format: 'hidden' };
  let { res, data } = await groqCompletion(env, body, options);
  if (res.status === 400 && /reasoning/i.test(data?.error?.message || '')) {
    delete body.reasoning_format;
    ({ res, data } = await groqCompletion(env, body, options));
  }
  if (res.status === 429) throw new AIError('خدمة قراءة الملف مزدحمة مؤقتًا. أعد المحاولة بعد قليل؛ لم تُخصم نقاط العملية الفاشلة.', 'rate_limit');
  if (!res.ok) throw new AIError('تعذّرت قراءة الملف من خدمة التوليد. جرّب مجددًا أو الصق نصه.', 'read');
  return tidy(String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, ''));
}

async function readBatch(env, images, options) {
  if (env.GROQ_API_KEY) {
    return readWithGroq(env, images, options);
  }
  const content = [
    { type: 'text', text: READ_PROMPT },
    ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}`, detail: 'high' } })),
  ];
  const r = await env.AI.run(VISION_MODEL, { messages: [{ role: 'user', content }], max_tokens: 6000 });
  return tidy(cfText(r).replace(/<think>[\s\S]*?<\/think>/gi, ''));
}

// Reads up to 15 images (photos or PDF pages) three at a time, two batches in parallel, keeping page order.
export async function imagesToText(env, images, options = {}) {
  const batches = [];
  for (let i = 0; i < images.length; i += 3) batches.push(images.slice(i, i + 3));
  const out = new Array(batches.length).fill('');
  // One Groq batch at a time: parallel pages share the same platform allowance.
  if (env.GROQ_API_KEY) {
    for (let i = 0; i < batches.length; i++) out[i] = await readBatch(env, batches[i], options);
    return out.filter(Boolean).join('\n\n');
  }
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (next < batches.length) {
        const i = next++;
        out[i] = await readBatch(env, batches[i], options);
      }
    }),
  );
  return out.filter(Boolean).join('\n\n');
}

export async function sourceToText(env, source, options) {
  if (source?.type === 'pdf') return pdfToText(env, source.data);
  if (source?.type === 'images') return imagesToText(env, source.images, options);
  return '';
}
