import { createHash } from 'node:crypto';

const queues = new Map();
function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
function pause(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

// Shared platform allowance; the digest key contains no work or credentials.
// Queue entries disappear after their last request, with bounded waits/retries.
export async function queuedProviderJSON({ provider, apiKey, model, send, retrySeconds }, { signal, onWait } = {}) {
  const timeout = AbortSignal.timeout(180000);
  const active = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const key = createHash('sha256').update(provider).update('\0').update(apiKey).update('\0').update(model).digest('hex');
  const queue = queues.get(key) || { tail: Promise.resolve(), count: 0 };
  if (queue.count >= 32) {
    const data = { error: { message: 'queue full' } };
    return { res: Response.json(data, { status: 429 }), data };
  }
  const previous = queue.tail;
  let release;
  const slot = new Promise(resolve => { release = resolve; });
  queue.tail = previous.then(() => slot);
  queue.count++;
  queues.set(key, queue);
  try {
    if (queue.count > 1) onWait?.({ reason: 'queue', seconds: null });
    await abortable(previous, active);
    for (let attempt = 0; ; attempt++) {
      active.throwIfAborted();
      const res = await send(AbortSignal.any([active, AbortSignal.timeout(55000)]));
      const data = await res.json().catch(() => ({}));
      const retryable = [429, 500, 502, 503, 504].includes(res.status);
      const delay = retryable ? retrySeconds(res, data, attempt) : null;
      if (delay == null || attempt >= 2) return { res, data };
      onWait?.({ reason: res.status === 429 ? 'limit' : 'unavailable', seconds: Math.ceil(delay + 0.5) });
      await pause((delay + 0.5) * 1000, active);
    }
  } finally {
    release();
    if (--queue.count === 0) queues.delete(key);
  }
}
