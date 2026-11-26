// Image helpers in the browser: search, AI generation, upload, and auto-filling a deck.
import { postJSON, request, config, ApiError, canAfford, deviceHeaders } from './api.js';
import { LIMITS, imageAspect } from './schema.js';
import { toast } from './ui.js';

export async function searchImages(q, page = 1) {
  const { results } = await request('GET', `/madar/api/images?q=${encodeURIComponent(q)}&page=${page}`);
  return results || [];
}

// `aspect` matches where the image sits on the card (e.g. 3:4 for a side image, 16:9 for a background).
// ---------- when the image generator reaches its daily limit ----------
let mainOutUntil = 0;
let toldBackup = false;

// The daily allowance renews at midnight UTC.
const nextReset = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

async function backupImage() { return null; }

// `slide` ties the picture to that slide's title and text. Returns null when nothing matching is available.
export async function aiImage(prompt, style, aspect = '16:9', topic = '', slide = null) {
  const skipGen = Date.now() < mainOutUntil;
  const { image, fallback, retry } = await postJSON('/madar/api/image-gen', { prompt, style, aspect, topic, slide, skipGen });
  if (!image && retry) return backupImage(retry, prompt, style, aspect);
  if (!image) return null;
  if (image?.data) {
    // Nano Banana sends the full-size original: shrink it to a light JPEG and store it.
    const bytes = Uint8Array.from(atob(image.data), (ch) => ch.charCodeAt(0));
    const file = new File([bytes], 'nano-banana.png', { type: image.mime || 'image/png' });
    const up = await uploadImage(file);
    return { url: up.url, alt: image.alt, credit: image.credit, source: 'ai', fallback: false };
  }
  return { ...image, fallback: !!fallback };
}

// Resizes in the browser (max 1600px, JPEG) before uploading.
export async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new ApiError('اختر ملف صورة.', 415);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  let quality = 0.86;
  let blob;
  do {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    quality -= 0.12;
  } while (blob.size > LIMITS.upload && quality > 0.3);
  if (blob.size > LIMITS.upload) throw new ApiError('الصورة كبيرة جداً.', 413);
  const res = await fetch('/madar/api/upload', { method: 'POST', headers: deviceHeaders({ 'Content-Type': 'image/jpeg' }), body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'تعذّر رفع الصورة.', res.status);
  return { url: data.url, alt: file.name.replace(/\.[^.]+$/, ''), credit: '', source: 'upload' };
}

// Fills every card that should show an image but has none yet.
// onCard(index) is called whenever a card's image state changes.
export async function fillImages(deck, onCard, { only } = {}) {
  const source = deck.imageSource || 'stock';
  if (source === 'none') return;
  // Slides left without a picture on a day the generator was out get another try once it has renewed.
  if (source === 'ai' && only == null) {
    for (const c of deck.cards) {
      if (c.image?.retryAt && Date.now() >= c.image.retryAt) {
        if (c.image.pos === 'none' && !c.image.url) c.image.pos = c.image.retryPos || 'end';
        delete c.image.retryAt;
        delete c.image.retryPos;
      }
    }
  }
  const used = new Set(deck.cards.map((c) => c.image?.url).filter(Boolean));
  const jobs = deck.cards
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => (only == null || only.includes(i)) && c.image && c.image.pos !== 'none' && !c.image.url && !c.image.loading && (c.image.query || c.title));

  for (const { c, i } of jobs) {
    c.image.loading = true;
    onCard(i);
  }

  const slideOf = (c) => ({
    title: c.title || '',
    subtitle: c.subtitle || '',
    body: c.body || '',
    items: (c.items || []).map((it) => [it.title, it.text].filter(Boolean).join(': ')),
  });
  const find = async (q, c) => {
    if (source === 'ai' && config.aiImages && canAfford('image')) {
      const img = await aiImage(q, deck.settings?.imageStyle, imageAspect(deck.format, c.image.pos), deck.topic || deck.title, slideOf(c));
      return img?.source === 'stock' && used.has(img.url) ? null : img; // never the same photo on two slides
    }
    const { image } = await postJSON('/madar/api/image-match', { query: q });
    return image && !used.has(image.url) ? image : null;
  };
  let missing = 0;
  const one = async ({ c, i }) => {
    const q = c.image.query || c.title;
    try {
      let img = null;
      // One retry: free photo services sometimes refuse a burst of requests.
      try {
        img = await find(q, c);
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
        img = await find(q, c);
      }
      if (img?.url) {
        used.add(img.url);
        Object.assign(c.image, { url: img.url, alt: img.alt || q, credit: img.credit || '', source: img.source || source });
      } else {
        // Nothing that shows this subject: a clean text slide beats an unrelated picture.
        if (source === 'ai') Object.assign(c.image, { retryPos: c.image.pos, retryAt: nextReset() });
        c.image.pos = 'none';
        missing++;
      }
    } catch {
      missing++; /* leave the placeholder; the user can pick an image */
    } finally {
      c.image.loading = false;
      onCard(i);
    }
  };

  // AI images one at a time (they are slower and rate limited); photos three at a time.
  const width = source === 'ai' ? 1 : 3;
  const queue = jobs.slice();
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length) await one(queue.shift());
    }),
  );
  if (missing) toast(`لم نجد صورة مطابقة لموضوع ${missing === 1 ? 'شريحة واحدة' : `${missing} ${missing > 10 ? 'شريحة' : 'شرائح'}`}، فتركناها بلا صورة.${Date.now() < mainOutUntil ? ' ستُولَّد تلقائياً عند فتح العرض بعد تجدد الحصة الساعة 3 فجراً بتوقيت الكويت.' : ' يمكنك إضافتها من زر الصورة.'}`, 'info', 8000);
}
