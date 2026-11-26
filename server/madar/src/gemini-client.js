import { queuedProviderJSON } from './provider-request.js';

// Documented free-tier models, reviewed 2026-11-26. No paid tools, image
// generation, stored interactions or fallback to another provider.
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const GEMINI_MODEL = GEMINI_MODELS[0];
export const geminiModel = model => GEMINI_MODELS.includes(model) ? model : null;

export function geminiRetrySeconds(response, data) {
  const details = data?.error?.details || [];
  if (details.some(item => item.violations?.some(v => /PerDay|daily/i.test(v.quotaId || '')))) return null;
  const header = response.headers.get('retry-after');
  const info = details.find(item => item['@type']?.endsWith('google.rpc.RetryInfo'));
  const value = header ?? String(info?.retryDelay || '').replace(/s$/, '');
  const delay = value !== '' ? Number(value) : NaN;
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
