// Image helpers in the browser: search, AI generation, upload, and auto-filling a deck.
import { postJSON, request, config, ApiError, canAfford, deviceHeaders } from './api.js';
import { LIMITS, imageAspect, defaultImagePos, IMAGE_SOURCES, IMAGE_STYLES } from './schema.js';
import { toast } from './ui.js';
import { cardImageContext } from './image-context.js';

export const imageSources = () => config.demo ? { none: IMAGE_SOURCES.none } : config.aiImages ? { ...IMAGE_SOURCES, ...(config.imageEngine === 'gemini-illustration' ? { ai: 'رسوم توضيحية بالذكاء الاصطناعي · مجانية' } : {}) } : { stock: IMAGE_SOURCES.stock, none: IMAGE_SOURCES.none };
export const imageStyles = () => config.imageEngine === 'gemini-illustration' ? { flat: 'رسم توضيحي ملون', lineart: 'رسم بخطوط بسيطة' } : IMAGE_STYLES;

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
export async function aiImage(prompt, style, aspect = '16:9', context = {}) {
  const skipGen = Date.now() < mainOutUntil;
  const { image, fallback, retry } = await postJSON('/madar/api/image-gen', { prompt, style, aspect, ...context, skipGen });
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
export async function fillImages(deck, onCard, { only, retryMissing = false } = {}) {
  const source = deck.imageSource || 'stock';
  if (source === 'none') return;
  if (retryMissing) {
    for (const [i, card] of deck.cards.entries()) {
      if (card.image?.url) continue;
      card.image ||= { query: card.title || '' };
      if (!card.image.pos || card.image.pos === 'none') card.image.pos = defaultImagePos(card.layout, deck.format, i, card.items?.length || 0);
      delete card.image.retryAt;
      delete card.image.retryPos;
    }
  }
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

  const find = async (q, c) => {
    if (source === 'ai' && config.aiImages && canAfford('image')) {
      const context = cardImageContext(deck, c);
      const img = await aiImage(q, deck.settings?.imageStyle, imageAspect(deck.format, c.image.pos), { ...context, mode: 'automatic' });
      if (JSON.stringify(context) !== JSON.stringify(cardImageContext(deck, c))) throw new ApiError('تغيّر محتوى البطاقة أثناء التوليد. أعد توليد الصورة حسب النص الحالي.', 409);
      return img?.source === 'stock' && used.has(img.url) ? null : img; // never the same photo on two slides
    }
    const { image } = await postJSON('/madar/api/image-match', { query: q, ...cardImageContext(deck, c), exclude: [...used] });
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
      } catch (error) {
        if (source === 'ai') throw error;
        await new Promise((r) => setTimeout(r, 1500));
        img = await find(q, c);
      }
      if (img?.url) {
        used.add(img.url);
        Object.assign(c.image, { url: img.url, alt: img.alt || q, query: img.query || q, credit: img.credit || '', link: img.link || '', source: img.source || source });
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

  // Keep generation and matching sequential within a batch.
  // Reserve each selected URL before the next photo search so two cards cannot
  // race to choose the same first result.
  const width = 1;
  const queue = jobs.slice();
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length) await one(queue.shift());
    }),
  );
  if (missing) toast(source === 'ai' ? `تعذّر تجهيز صور ${missing} من البطاقات. يمكنك إعادة المحاولة من «إكمال الصور» أو من زر الصورة في البطاقة.` : `لم نجد صورة مطابقة لموضوع ${missing === 1 ? 'شريحة واحدة' : `${missing} ${missing > 10 ? 'شريحة' : 'شرائح'}`}، فتركناها بلا صورة. يمكنك إضافتها من زر الصورة.`, 'info', 8000);
}
