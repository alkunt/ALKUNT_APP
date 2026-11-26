import { queuedProviderJSON } from './provider-request.js';

// Documented free-tier models, reviewed 2026-11-26. No paid tools, image
// generation, stored interactions or fallback to another provider.
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const GEMINI_MODEL = GEMINI_MODELS[0];
export const geminiModel = model => GEMINI_MODELS.includes(model) ? model : null;

// Large enum grammars inside nested card/item arrays can exceed Gemini's
// constrained-decoding state limit. Keep the JSON structure, guide icon choices
// with a description, and retain the application's strict icon normalization.
export function geminiResponseSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiResponseSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const result = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, geminiResponseSchema(value)]));
  if (schema.enum?.length > 32) {
    delete result.enum;
    result.description = [schema.description, 'Choose one of: ' + schema.enum.join(', ')].filter(Boolean).join(' ');
  }
  return result;
}

export function geminiRetrySeconds(response, data, attempt = 0) {
  const details = data?.error?.details || [];
  if (details.some(item => item.violations?.some(v => /PerDay|daily/i.test(v.quotaId || '')))) return null;
  const header = response.headers.get('retry-after');
  const info = details.find(item => item['@type']?.endsWith('google.rpc.RetryInfo'));
  // An explicit long/invalid hint must never turn into an early default retry.
  if (header == null && !info?.retryDelay) return [500, 502, 503, 504].includes(response.status) ? 2 ** (attempt + 1) : null;
  const value = header ?? String(info.retryDelay).replace(/s$/, '');
  let delay = value !== '' ? Number(value) : NaN;
  if (!Number.isFinite(delay) && header) delay = (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(delay) && delay >= 0 && delay <= 65 ? delay : null;
}

export function geminiCompletion(env, body, options) {
  const model = geminiModel(env.GEMINI_TEXT_MODEL || GEMINI_MODEL);
  if (!model) throw new Error('Unsupported Gemini model');
  const apiKey = env.GEMINI_TEXT_API_KEY;
  return queuedProviderJSON({
    provider: 'gemini', apiKey, model, retrySeconds: geminiRetrySeconds,
    send: signal => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal, redirect: 'error',
    }),
  }, options);
}
