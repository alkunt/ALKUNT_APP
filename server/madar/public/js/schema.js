// Shared by the browser app and the Worker (the Worker imports this file directly),
// so layouts, icons and limits never drift apart.

export const LAYOUTS = [
  'cover', 'section', 'bullets', 'image_text', 'columns', 'stats',
  'timeline', 'steps', 'comparison', 'quote', 'chart', 'closing',
];

export const LAYOUT_LABELS = {
  cover: 'غلاف', section: 'فاصل قسم', bullets: 'نقاط', image_text: 'نص وصورة',
  columns: 'أعمدة', stats: 'أرقام', timeline: 'خط زمني', steps: 'خطوات',
  comparison: 'مقارنة', quote: 'اقتباس', chart: 'رسم بياني', closing: 'خاتمة',
};

export const LAYOUT_ICONS = {
  cover: 'presentation', section: 'flag', bullets: 'list-checks', image_text: 'image',
  columns: 'layout-grid', stats: 'trending-up', timeline: 'clock', steps: 'goal',
  comparison: 'scale', quote: 'message-square-quote', chart: 'chart-column', closing: 'rocket',
};

// Lucide icon names (checked against lucide@0.460.0).
export const CARD_ICONS = [
  'sparkles', 'rocket', 'target', 'lightbulb', 'brain', 'cpu', 'bot', 'chart-line', 'chart-column',
  'chart-pie', 'trending-up', 'trending-down', 'dollar-sign', 'wallet', 'coins', 'banknote',
  'shopping-cart', 'store', 'briefcase', 'building-2', 'users', 'user', 'user-check', 'handshake',
  'heart', 'smile', 'star', 'award', 'trophy', 'medal', 'graduation-cap', 'book-open', 'pencil',
  'pen-tool', 'palette', 'camera', 'image', 'video', 'music', 'mic', 'megaphone', 'message-circle',
  'mail', 'phone', 'globe', 'map-pin', 'plane', 'car', 'truck', 'package', 'box', 'layers',
  'layout-grid', 'puzzle', 'settings', 'wrench', 'hammer', 'shield-check', 'lock', 'key', 'eye',
  'search', 'clock', 'calendar', 'timer', 'zap', 'flame', 'leaf', 'sun', 'moon', 'cloud', 'droplet',
  'coffee', 'utensils', 'house', 'school', 'stethoscope', 'activity', 'dumbbell', 'gift', 'flag',
  'compass', 'map', 'link', 'share-2', 'database', 'server', 'code', 'terminal', 'smartphone',
  'laptop', 'wifi', 'circle-check', 'circle-x', 'triangle-alert', 'circle-help', 'info',
  'list-checks', 'clipboard-list', 'file-text', 'folder', 'refresh-cw', 'repeat', 'infinity',
  'scale', 'gavel', 'landmark', 'factory', 'recycle', 'sprout', 'mountain', 'waves', 'baby',
  'accessibility', 'languages', 'newspaper', 'tv', 'gamepad-2', 'headphones', 'shirt', 'gem',
  'crown', 'thumbs-up', 'presentation', 'goal', 'hand-heart', 'ticket', 'wand-sparkles',
];

export const FORMATS = {
  presentation: { label: 'عرض تقديمي', icon: 'presentation', w: 1280, h: 720 },
  document: { label: 'مستند', icon: 'file-text', w: 900, h: 0 },
  webpage: { label: 'صفحة ويب', icon: 'globe', w: 1280, h: 0 },
  social: { label: 'منشورات سوشيال', icon: 'smartphone', w: 1080, h: 1350 },
};

export const LANGUAGES = {
  ar: 'العربية', en: 'English', fr: 'Français', es: 'Español', tr: 'Türkçe', ur: 'اردو', auto: 'نفس لغة المدخلات',
};

export const DENSITY = { brief: 'موجز', medium: 'متوسط', detailed: 'مفصّل' };

export const TONES = {
  professional: 'احترافي', friendly: 'ودود', inspiring: 'مُلهم', educational: 'تعليمي',
  persuasive: 'إقناعي وتسويقي', playful: 'مرح',
};

export const IMAGE_SOURCES = { ai: 'صور بالذكاء الاصطناعي', stock: 'صور فوتوغرافية مجانية', none: 'بدون صور' };

export const IMAGE_STYLES = {
  photo: 'واقعية', illustration: 'رسم توضيحي', '3d': 'ثلاثية الأبعاد', flat: 'مسطّحة',
  watercolor: 'ألوان مائية', lineart: 'خطوط بسيطة',
};

export const SOURCE_MODES = { generate: 'توسيع وتطوير', condense: 'تلخيص', preserve: 'حفظ النص كما هو' };

// ---------- plans and points (shared by the Worker and the browser) ----------
// Defaults; wrangler.jsonc can override the numbers (FREE_POINTS, PAID_POINTS, FREE_MAX_CARDS, MAX_CARDS, PLAN_DAYS).
export const PLANS = {
  free: { name: 'المجانية', points: 200, maxCards: 10, price: 'مجاناً' },
  paid: { name: 'الأساسية', points: 500, maxCards: 25, days: 30, price: '3 د.ك' },
  pro: { name: 'الاحترافية', points: 1000, maxCards: 30, days: 30, price: '6 د.ك' },
};
export const PAID_PLANS = ['paid', 'pro'];

// Points per action. They grow with the number of slides, pages and images, so bigger jobs cost more.
export function costOf(kind, n = 1) {
  const k = Math.max(1, Math.round(Number(n) || 1));
  switch (kind) {
    case 'outline': return 1 + Math.ceil(k / 5); // plan: 1 + one per 5 slides
    case 'generate': return k; // writing: one per slide
    case 'assistant': return 2 + Math.ceil(k / 2); // whole-deck revision: 2 + one per 2 slides
    case 'read': return k; // reading a file: one per PDF page or photo
    case 'card': return 1; // rewrite or add one slide with AI
    case 'image': return 1; // one AI image
    default: return 1;
  }
}

// A full deck from an idea: outline + writing + one AI image per slide.
export const deckEstimate = (slides, aiImages = true) => costOf('outline', slides) + costOf('generate', slides) + (aiImages ? slides : 0);

export const PRICE_LIST = [
  ['المخطط', '1 نقطة + نقطة لكل 5 شرائح'],
  ['كتابة العرض', 'نقطة لكل شريحة'],
  ['صورة بالذكاء الاصطناعي', 'نقطة لكل صورة'],
  ['قراءة ملف PDF أو صور', 'نقطة لكل صفحة أو صورة'],
  ['تعديل شريحة أو إضافتها بالذكاء', 'نقطة واحدة'],
  ['المساعد على العرض كاملاً', '2 نقطة + نقطة لكل شريحتين'],
  ['الصور الفوتوغرافية، العرض، التصدير، النشر', 'مجاناً'],
];

export const LIMITS = {
  prompt: 4000, // characters for a topic prompt
  text: 60000, // characters for pasted / imported text
  pdfBytes: 8 * 1024 * 1024,
  upload: 1024 * 1024, // bytes per uploaded image after in-browser resize
  instruction: 1500,
  images: 5, // images per upload in "from file"
  pdfPages: 15, // PDF pages read as images by the free engine
  imageChars: 4000000, // base64 characters per image (after in-browser resize)
  deckBytes: 1500000,
};

// Default image placement for each layout: every slide gets an image that fits its layout.
// Side images alternate sides; multi-column layouts take a band on top; big numbers and quotes sit on a photo.
// (`items` is kept for callers; placement no longer depends on it.)
export function defaultImagePos(layout, format, index, items = 0) {
  const side = index % 2 ? 'start' : 'end';
  const BG = ['section', 'closing', 'quote', 'stats'];
  const TOP = ['columns', 'steps', 'timeline', 'comparison'];
  if (format === 'social') {
    if (layout === 'cover' || BG.includes(layout)) return 'bg';
    return 'top';
  }
  if (format === 'document') {
    if (layout === 'image_text' || layout === 'bullets' || layout === 'chart') return side;
    return 'top';
  }
  if (format === 'webpage') {
    if (layout === 'cover' || BG.includes(layout)) return 'bg';
    if (TOP.includes(layout)) return 'top';
    return side;
  }
  // presentation
  if (layout === 'cover') return 'end';
  if (BG.includes(layout)) return 'bg';
  if (TOP.includes(layout)) return 'top';
  return side; // bullets, image_text, chart
}

// Aspect ratio to request from AI image models, matching where the image sits on the card.
export function imageAspect(format, pos) {
  if (pos === 'bg') return format === 'social' ? '4:5' : '16:9';
  if (pos === 'top') return format === 'document' ? '21:9' : '16:9';
  if (pos === 'start' || pos === 'end') return format === 'webpage' ? '4:5' : '3:4';
  return '16:9';
}
