// Talking to the Worker.
import { costOf, PLANS } from './schema.js';

export const config = {
  demo: false,
  maxCards: 10,
  aiImages: false,
  plan: { id: 'free', name: PLANS.free.name, points: PLANS.free.points, remaining: PLANS.free.points, maxCards: PLANS.free.maxCards, period: 'month' },
  plans: { free: PLANS.free, paid: PLANS.paid, pro: PLANS.pro, period: 'month' },
  purchaseUrl: '',
  turnstileSiteKey: '',
};

// ---------- device id: issued and signed by the server, kept in this browser ----------
const accountScope = document.documentElement.dataset.madarAccount;
const headers = (extra = {}) => ({ ...extra, 'X-Madar-Account': accountScope });

export const deviceHeaders = headers;

// ---------- points ----------
// `n` is the number of slides, pages or images the action works on.
export const isFree = () => false; // every plan counts points
export const pointsFor = (kind, n) => costOf(kind, n);
export const isUnlimited = () => Boolean(config.plan?.unlimited);
export const costLabel = (kind, n) => (isUnlimited() ? '' : ` · ${costOf(kind, n)} نقطة`);
export const canAfford = (kind, n) => isUnlimited() || (config.plan?.remaining ?? Infinity) >= costOf(kind, n);

// Ask the app to show the plans window (used when points run out or a plan limit is hit).
export const askUpgrade = () => window.dispatchEvent(new CustomEvent('madar:upgrade'));

const listeners = new Set();
export function onCredits(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setRemaining(n) {
  if (typeof n !== 'number' || isUnlimited()) return;
  config.plan.remaining = n;
  listeners.forEach((fn) => fn(n));
}

export function setPlan(plan) {
  if (!plan) return;
  config.plan = plan;
  config.maxCards = plan.maxCards;
  listeners.forEach((fn) => fn(plan.remaining));
}

export function authRequired() { document.body.replaceChildren(); if(window.parent !== window) window.parent.postMessage({type:'madar:auth-required'}, location.origin); else location.assign('/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search)); }
export async function checkSession() { try { const r=await fetch('/madar/api/config',{cache:'no-store'}); if(r.status===401)return authRequired(); if(r.ok){const c=await r.json(); if(c.userScope!==document.documentElement.dataset.madarAccount)authRequired();} } catch {} }
export async function loadConfig() { const r=await fetch('/madar/api/config',{cache:'no-store'}); if(r.status===401){authRequired();throw new Error('سجّل الدخول لفتح مدار.');} if(!r.ok)throw new Error('تعذّر فتح الاستوديو. أعد تحميل الصفحة.');const data=await r.json();if(data.userScope!==document.documentElement.dataset.madarAccount){authRequired();throw new Error('تغير الحساب. أعد فتح مدار.');}Object.assign(config,data);setRemaining(config.plan.remaining);return config; }

export async function redeemCode(code) {
  const data = await postJSON('/madar/api/redeem', { code });
  setPlan(data.plan);
  return data.plan;
}

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function errorFrom(res) {
  if(res.status === 401) authRequired();
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (data.remaining != null) setRemaining(data.remaining);
  if (data.code === 'credits' || data.code === 'plan_limit') askUpgrade();
  return new ApiError(data.error || `خطأ ${res.status}`, res.status, data);
}

export async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = await res.json();
  if (data.remaining != null) setRemaining(data.remaining);
  return data;
}

export async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

// POSTs and reads a Server-Sent Events stream. handlers: { [eventName]: fn(data) }.
// Resolves with the payload of the "done" event.
export async function stream(path, body, handlers = {}, { signal } = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'credits') setRemaining(parsed.remaining);
      if (event === 'error') throw new ApiError(parsed.error, 500, parsed);
      if (event === 'done') done = parsed;
      handlers[event]?.(parsed);
    }
  }
  if (!done) throw new ApiError('انقطع الاتصال قبل اكتمال الرد.', 0);
  return done;
}

// ---------- Cloudflare Turnstile (only when the site owner configured it) ----------

let tsReady = null;
function loadTurnstile() {
  if (!tsReady) {
    tsReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => res(window.turnstile);
      s.onerror = () => {
        tsReady = null;
        rej(new Error('تعذّر تحميل التحقق'));
      };
      document.head.append(s);
    });
  }
  return tsReady;
}

export async function turnstileToken() {
  if (!config.turnstileSiteKey) return '';
  const ts = await loadTurnstile();
  let box = document.getElementById('ts-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ts-box';
    document.body.append(box);
  }
  return new Promise((resolve, reject) => {
    const id = ts.render(box, {
      sitekey: config.turnstileSiteKey,
      appearance: 'interaction-only',
      callback: (token) => {
        resolve(token);
        setTimeout(() => ts.remove(id), 0);
      },
      'error-callback': () => {
        reject(new ApiError('تعذّر التحقق، حاول مرة أخرى.', 403));
        setTimeout(() => ts.remove(id), 0);
      },
    });
  });
}
