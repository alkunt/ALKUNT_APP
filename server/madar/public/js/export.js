// Exports: PDF (browser print), PowerPoint (editable, mapped from the rendered layout), PNG, JSON.
import { toast, loadScript, h, modal } from './ui.js';
import { FORMATS } from './schema.js';
import { renderCard, fitCard, isFixed, deckDir } from './render.js';
import { getTheme } from './themes.js';

const PPTX_URL = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
const H2I_URL = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';

const safeName = (s) => (s || 'madar').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'madar';

async function download(blob, name) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('The export is empty.');
  // Keep a self-contained file link available until the member closes the dialog.
  // A completed generation does not tell us whether the browser saved the file.
  const href = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the export.'));
    reader.readAsDataURL(blob);
  });
  const link = h('a', { class: 'btn btn-primary', href, download: name }, 'تنزيل الملف');
  const body = h('div', { style: { display: 'grid', gap: '14px' } },
    h('strong', { dir: 'auto', style: { overflowWrap: 'anywhere' } }, name),
    h('p', { class: 'tiny' }, `${Math.max(1, Math.ceil(blob.size / 1024))} كيلوبايت`),
    h('p', {}, 'ملفك جاهز. اضغط لتنزيله إلى جهازك. يمكنك استخدام الرابط مرة أخرى ما دامت هذه النافذة مفتوحة.'),
    link);
  modal('الملف جاهز للتنزيل', body, { width: 540 });
  link.focus();
}

function offscreenHost() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  return host;
}

function imagesLoaded(root, ms = 9000) {
  const imgs = [...root.querySelectorAll('img')];
  return Promise.race([
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r)))))),
    new Promise((r) => setTimeout(r, ms)),
  ]);
}

const dataCache = new Map();
async function toDataURL(src) {
  if (!src || src.startsWith('data:')) return src;
  if (dataCache.has(src)) return dataCache.get(src);
  const p = (async () => {
    const abs = new URL(src, location.href);
    const url = abs.origin === location.origin ? abs.href : `/madar/api/proxy?u=${encodeURIComponent(abs.href)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('image ' + res.status);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  })();
  dataCache.set(src, p);
  p.catch(() => dataCache.delete(src));
  return p;
}

async function inlineImages(root) {
  await Promise.all(
    [...root.querySelectorAll('img')].map(async (img) => {
      try {
        const d = await toDataURL(img.getAttribute('src'));
        if (d) img.src = d;
      } catch {
        img.remove();
      }
    }),
  );
  await imagesLoaded(root);
}

// ---------- PDF ----------

export async function exportPDF(deck) {
  toast('جارٍ تجهيز ملف PDF… اختر «حفظ بصيغة PDF» من نافذة الطباعة.', 'info', 5000);
  const fmt = FORMATS[deck.format];
  const root = document.getElementById('print-root');
  root.replaceChildren();
  root.className = isFixed(deck.format) ? '' : 'flowfmt';
  const pageH = fmt.h || Math.round(fmt.w * 1.414);
  let style = document.getElementById('print-page');
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page';
    document.head.append(style);
  }
  style.textContent = `@page{size:${fmt.w}px ${pageH}px;margin:0}`;
  root.style.cssText = 'display:block;position:fixed;left:-100000px;top:0';
  deck.cards.forEach((c, i) => {
    const page = document.createElement('div');
    page.className = 'pcard';
    page.style.width = fmt.w + 'px';
    page.append(renderCard(c, deck, { index: i, eager: true }));
    root.append(page);
  });
  await document.fonts?.ready;
  await imagesLoaded(root);
  root.querySelectorAll('.mcard').forEach(fitCard);
  root.style.cssText = '';
  const cleanup = () => {
    root.replaceChildren();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  const prevTitle = document.title;
  document.title = safeName(deck.title);
  window.print();
  document.title = prevTitle;
}

// ---------- PNG ----------

export async function exportPNG(deck, index = 0) {
  try {
    toast('جارٍ تجهيز الصورة…', 'info', 2500);
    await loadScript(H2I_URL);
    const host = offscreenHost();
    const card = renderCard(deck.cards[index], deck, { index, eager: true });
    host.append(card);
    await document.fonts?.ready;
    await inlineImages(card);
    fitCard(card);
    card.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
    const blob = await window.htmlToImage.toBlob(card, { pixelRatio: 2, width: card.offsetWidth, height: card.offsetHeight, cacheBust: false });
    host.remove();
    await download(blob, `${safeName(deck.title)}-${index + 1}.png`);
  } catch (e) {
    console.error(e);
    toast('تعذّر تصدير الصورة. جرّب PDF بدلاً منها.', 'error');
  }
}

// ---------- JSON ----------

export async function exportJSON(deck) {
  const data = { madar: 1, deck: { ...deck, share: null } };
  await download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${safeName(deck.title)}.madar.json`);
}

// ---------- PowerPoint ----------

function parseColor(str) {
  if (!str) return null;
  let m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  let r, g, b, a;
  if (m) {
    [r, g, b] = [+m[1], +m[2], +m[3]];
    a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  } else if ((m = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/))) {
    [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(+v * 255));
    a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  } else if ((m = str.match(/#([\da-f]{6})/i))) {
    const n = parseInt(m[1], 16);
    [r, g, b, a] = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  } else return null;
  if (a === 0) return null;
  const hex = [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, a };
}

function firstColor(bgImage) {
  const m = bgImage && bgImage.match(/(rgba?\([^)]+\)|color\(srgb[^)]+\)|#[\da-f]{6})/i);
  return m ? parseColor(m[1]) : null;
}

function blend(fg, bgHex) {
  if (!fg || fg.a >= 0.999) return fg?.hex;
  const b = parseInt(bgHex, 16);
  const f = parseInt(fg.hex, 16);
  const ch = (s) => Math.round(((f >> s) & 255) * fg.a + ((b >> s) & 255) * (1 - fg.a));
  return [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function svgToPng(svg, color, sizePx) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('stroke', color);
  clone.setAttribute('width', sizePx);
  clone.setAttribute('height', sizePx);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = sizePx * 2;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function pptAlign(ta, rtl) {
  if (ta === 'center' || ta === 'left' || ta === 'right') return ta;
  if (ta === 'end') return rtl ? 'left' : 'right';
  return rtl ? 'right' : 'left'; // start, justify, and anything else
}

function runsFor(node, base, accentHex) {
  const runs = [];
  const walk = (n, bold) => {
    for (const ch of n.childNodes) {
      if (ch.nodeType === 3) {
        if (ch.nodeValue) runs.push({ text: ch.nodeValue, options: { ...base, bold: bold || base.bold, color: bold ? accentHex : base.color } });
      } else if (ch.tagName === 'BR') {
        if (runs.length) runs[runs.length - 1].options.breakLine = true;
        else runs.push({ text: '', options: { ...base, breakLine: true } });
      } else if (ch.nodeType === 1) walk(ch, bold || ch.tagName === 'STRONG' || ch.tagName === 'B');
    }
  };
  walk(node, false);
  return runs;
}

export async function exportPPTX(deck) {
  toast('جارٍ تجهيز ملف PowerPoint…', 'info', 4000);
  try {
    await loadScript(PPTX_URL);
    // PowerPoint slides are fixed-size: flowing formats are laid out as 16:9 slides.
    const xdeck = { ...deck, format: deck.format === 'social' ? 'social' : 'presentation' };
    const fmt = FORMATS[xdeck.format];
    const theme = getTheme(deck);
    const rtl = deckDir(deck) === 'rtl';
    const pptx = new window.PptxGenJS();
    let slideW;
    if (xdeck.format === 'social') {
      pptx.defineLayout({ name: 'SOCIAL', width: 7.5, height: 9.375 });
      pptx.layout = 'SOCIAL';
      slideW = 7.5;
    } else {
      pptx.layout = 'LAYOUT_WIDE';
      slideW = 13.333;
    }
    pptx.rtlMode = rtl;
    pptx.title = deck.title;
    pptx.company = 'مدار';
    const k = slideW / fmt.w; // inches per px
    const pt = k * 72; // points per px
    const lang = deck.settings?.lang && deck.settings.lang !== 'auto' ? deck.settings.lang : 'ar';
    const host = offscreenHost();
    await document.fonts?.ready;

    for (let i = 0; i < xdeck.cards.length; i++) {
      const card = renderCard(xdeck.cards[i], xdeck, { index: i, eager: true });
      host.replaceChildren(card);
      await inlineImages(card);
      fitCard(card);
      const slide = pptx.addSlide();
      const cs0 = getComputedStyle(card);
      const bgHex = blend(parseColor(cs0.backgroundColor), parseColor(theme.bg)?.hex || '000000') || '000000';
      slide.background = { color: bgHex };
      const base = card.getBoundingClientRect();
      const accentHex = (parseColor(theme.dark ? theme.accent2 : theme.accent) || { hex: '2F7BFF' }).hex;

      const nodes = [...card.querySelectorAll('[data-x]')].filter((n) => !n.closest('[data-noexport]'));
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const box = { x: (r.left - base.left) * k, y: (r.top - base.top) * k, w: r.width * k, h: r.height * k };
        const cs = getComputedStyle(node);
        const kind = node.dataset.x;

        // shape behind the element (boxes, dots, gradient bars, number circles)
        const fill = parseColor(cs.backgroundColor) || firstColor(cs.backgroundImage);
        const border = parseFloat(cs.borderTopWidth) > 0 ? parseColor(cs.borderTopColor) : null;
        if (kind !== 'img' && (fill || border)) {
          const radius = parseFloat(cs.borderTopLeftRadius) || 0;
          const round = radius >= Math.min(r.width, r.height) / 2 - 1;
          slide.addShape(round ? pptx.ShapeType.ellipse : radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
            ...box,
            fill: fill ? { color: fill.hex, transparency: Math.round((1 - fill.a) * 100) } : { type: 'none' },
            line: border ? { color: border.hex, width: Math.max(0.5, parseFloat(cs.borderTopWidth) * pt), transparency: Math.round((1 - border.a) * 100) } : { type: 'none' },
            rectRadius: !round && radius ? Math.min(radius * k, Math.min(box.w, box.h) / 2) : undefined,
          });
        }

        if (kind === 'img') {
          const src = node.getAttribute('src');
          if (!src?.startsWith('data:') || !node.naturalWidth) continue;
          const ar = node.naturalHeight / node.naturalWidth;
          const contain = node.classList.contains('mc-logo');
          slide.addImage({ data: src, x: box.x, y: box.y, w: box.w, h: box.w * ar, sizing: { type: contain ? 'contain' : 'cover', w: box.w, h: box.h } });
          if (node.closest('.img-bg') && node.closest('.mc-media')) {
            const ov = parseColor(getComputedStyle(card).getPropertyValue('--t-overlay'));
            if (ov) slide.addShape(pptx.ShapeType.rect, { ...box, fill: { color: ov.hex, transparency: Math.round((1 - ov.a) * 100) }, line: { type: 'none' } });
          }
        } else if (kind === 'icon') {
          const svg = node.querySelector('svg');
          if (!svg) continue;
          const sr = svg.getBoundingClientRect();
          const color = cs.color;
          try {
            const png = await svgToPng(svg, color, Math.round(sr.width));
            slide.addImage({ data: png, x: (sr.left - base.left) * k, y: (sr.top - base.top) * k, w: sr.width * k, h: sr.height * k });
          } catch {
            /* skip icon */
          }
        } else if (kind === 'text') {
          const text = node.innerText.trim();
          if (!text) continue;
          let color = parseColor(cs.color);
          if (!color) color = parseColor(cs.webkitTextStrokeColor) || { hex: accentHex, a: 1 };
          const fs = parseFloat(cs.fontSize);
          const lh = parseFloat(cs.lineHeight) || fs * 1.5;
          const align = pptAlign(cs.textAlign, rtl);
          const opts = {
            fontFace: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
            fontSize: Math.max(6, Math.round(fs * pt * 10) / 10),
            color: blend(color, bgHex),
            bold: parseInt(cs.fontWeight, 10) >= 600,
          };
          const slack = box.w * 0.06;
          const runs = node.querySelector('strong, b, br') ? runsFor(node, opts, accentHex) : text;
          slide.addText(runs, {
            ...opts,
            x: align === 'right' ? box.x - slack : align === 'center' ? box.x - slack / 2 : box.x,
            y: box.y,
            w: box.w + slack,
            h: box.h + (lh - fs) * k * 0.5,
            align,
            valign: 'top',
            margin: 0,
            rtlMode: rtl,
            lang,
            lineSpacingMultiple: Math.min(2.2, Math.max(0.9, lh / fs)),
            paraSpaceAfter: 0,
            fit: 'none',
          });
        }
      }
      if (xdeck.cards[i].notes) slide.addNotes(xdeck.cards[i].notes);
    }
    host.remove();
    const archive = await pptx.write({ outputType: 'blob' });
    const blob = new Blob([archive], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    await download(blob, `${safeName(deck.title)}.pptx`);
    toast('ملف PowerPoint جاهز. إذا لم تكن الخطوط العربية مثبّتة لديك، فقد يستبدلها PowerPoint بخط مشابه.', 'ok', 6500);
  } catch (e) {
    console.error(e);
    toast('تعذّر إنشاء ملف PowerPoint. حاول مرة أخرى أو صدّر PDF.', 'error');
  }
}
