import { queuedProviderJSON } from './provider-request.js';

function seconds(value) {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (!/^(?:\d+(?:\.\d+)?[hms])+$/.test(value)) return NaN;
  return [...value.matchAll(/(\d+(?:\.\d+)?)([hms])/g)]
    .reduce((sum, [, n, unit]) => sum + Number(n) * ({ h: 3600, m: 60, s: 1 })[unit], 0);
}

// Respect the provider's delay. Daily exhaustion and requests larger than the
// provider's whole allowance cannot be repaired by repeating the same request.
export function groqRetrySeconds(response, data) {
  const message = String(data?.error?.message || '');
  if (/per day|\b[RT]PD\b|daily/i.test(message)) return null;
  const sizes = message.match(/Limit\s+(\d+),\s*Used\s+[\d.]+,\s*Requested\s+(\d+)/i);
  if (sizes && Number(sizes[2]) > Number(sizes[1])) return null;
  const header = response.headers.get('retry-after');
  const hinted = message.match(/try again in\s+((?:\d+(?:\.\d+)?[hms])+|\d+(?:\.\d+)?)/i)?.[1];
  let delay = header == null ? seconds(hinted || '') : seconds(header);
  if (!Number.isFinite(delay) && header) delay = (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(delay) && delay >= 0 && delay <= 65 ? delay : null;
}

export function groqCompletion(env, body, options) {
  return queuedProviderJSON({
    provider: 'groq', apiKey: env.GROQ_API_KEY, model: body.model, retrySeconds: groqRetrySeconds,
    send: signal => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal, redirect: 'error',
    }),
  }, options);
}
