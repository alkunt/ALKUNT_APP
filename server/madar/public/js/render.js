// Renders cards. Every card is laid out at a fixed base width (see FORMATS) and scaled
// to fit wherever it is shown, so the editor, present mode, thumbnails and exports match.

import { h, icon } from './ui.js';
import { FORMATS, LAYOUT_LABELS } from './schema.js';
import { getTheme, applyTheme } from './themes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function md(text = '') {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// contenteditable HTML back to our light markdown (bold + line breaks only).
export function htmlToMd(el) {
  let out = '';
  const walk = (node, bold) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue.replace(/ /g, ' ');
      else if (n.nodeType === 1) {
        const tag = n.tagName;
        if (tag === 'BR') out += '\n';
        else if (tag === 'STRONG' || tag === 'B') {
          const before = out.length;
          walk(n, true);
          const inner = out.slice(before);
          out = out.slice(0, before) + (bold || !inner.trim() ? inner : `**${inner}**`);
        } else if (tag === 'DIV' || tag === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(n, bold);
        } else walk(n, bold);
      }
    }
  };
  walk(el, false);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export const isFixed = (format) => FORMATS[format]?.h > 0;

const RTL_LANGS = new Set(['ar', 'ur']);
export function deckDir(deck) {
  if (deck.dir) return deck.dir;
  return RTL_LANGS.has(deck.settings?.lang || 'ar') ? 'rtl' : 'ltr';
}

// ---------- field helpers ----------

function field(tag, cls, f, value, ctx, { rich = false, ph = '' } = {}) {
  const has = value != null && String(value).trim() !== '';
  if (!has && !ctx.editable) return null;
  const el = h(tag, { class: cls, 'data-f': f, 'data-x': 'text' });
  if (rich) el.innerHTML = md(value || '');
  else el.textContent = value || '';
  if (ctx.editable) {
    el.setAttribute('contenteditable', rich ? 'true' : 'plaintext-only');
    el.setAttribute('data-ph', ph);
    el.setAttribute('spellcheck', 'false');
  }
  return el;
}

function header(card, ctx, { titleTag = 'h2', withBody = true } = {}) {
  return [
    field(titleTag, 'mc-title', 'title', card.title, ctx, { ph: 'العنوان' }),
    field('p', 'mc-sub', 'subtitle', card.subtitle, ctx, { ph: 'سطر فرعي (اختياري)' }),
    withBody ? field('div', 'mc-body', 'body', card.body, ctx, { rich: true, ph: 'نص (اختياري)' }) : null,
  ];
}

function itemIcon(it, i, ctx) {
  const wrap = h('span', { class: 'mc-icon', 'data-x': 'icon' }, icon(it.icon || 'sparkles', 26));
  if (ctx.editable) {
    wrap.classList.add('editable');
    wrap.title = 'تغيير الأيقونة';
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.hooks?.pickIcon?.(i, wrap);
    });
  }
  return wrap;
}

function removeBtn(i, ctx) {
  if (!ctx.editable) return null;
  return h(
    'button',
    { type: 'button', class: 'mc-x', 'data-noexport': '', title: 'حذف العنصر', 'aria-label': 'حذف العنصر', onClick: (e) => (e.stopPropagation(), ctx.hooks?.removeItem?.(i)) },
    icon('x', 16),
  );
}

function addBtn(ctx, label = 'إضافة عنصر') {
  if (!ctx.editable) return null;
  return h('button', { type: 'button', class: 'mc-add', 'data-noexport': '', onClick: (e) => (e.stopPropagation(), ctx.hooks?.addItem?.()) }, icon('plus', 16), label);
}

const itemField = (tag, cls, i, key, it, ctx, ph) => field(tag, cls, `items.${i}.${key}`, it[key], ctx, { ph });

// ---------- layouts ----------

const L = {};

L.cover = (card, ctx) => [
  h('div', { class: 'mc-kicker', 'data-x': 'box' }),
  field('h1', 'mc-title', 'title', card.title, ctx, { ph: 'عنوان العرض' }),
  field('p', 'mc-sub', 'subtitle', card.subtitle, ctx, { ph: 'وعد أو فكرة جذابة' }),
  field('div', 'mc-body', 'body', card.body, ctx, { rich: true, ph: 'سطر إضافي (اختياري)' }),
];

L.section = (card, ctx) => [
  h('div', { class: 'mc-num', 'data-x': 'text' }, String(ctx.sectionNo).padStart(2, '0')),
  ...header(card, ctx),
];

L.bullets = (card, ctx) => [
  ...header(card, ctx),
  h(
    'div',
    { class: `mc-items mc-list ${(card.items?.length || 0) >= 4 ? 'two' : ''}` },
    (card.items || []).map((it, i) =>
      h('div', { class: 'mc-item', 'data-x': 'box' }, itemIcon(it, i, ctx), h('div', { class: 'mc-item-txt' }, itemField('h3', 'mc-it', i, 'title', it, ctx, 'نقطة'), itemField('p', 'mc-ix', i, 'text', it, ctx, 'شرح قصير')), removeBtn(i, ctx)),
    ),
    addBtn(ctx),
  ),
];

L.image_text = (card, ctx) => [
  ...header(card, ctx),
  card.items?.length || ctx.editable
    ? h(
        'div',
        { class: 'mc-items mc-mini' },
        (card.items || []).map((it, i) => h('div', { class: 'mc-item' }, itemIcon(it, i, ctx), h('div', { class: 'mc-item-txt' }, itemField('h3', 'mc-it', i, 'title', it, ctx, 'نقطة'), itemField('p', 'mc-ix', i, 'text', it, ctx, '')), removeBtn(i, ctx))),
        addBtn(ctx),
      )
    : null,
];

L.columns = (card, ctx) => [
  ...header(card, ctx),
  h(
    'div',
    { class: `mc-items mc-grid n${Math.min(Math.max(card.items?.length || 3, 2), 4)}` },
    (card.items || []).map((it, i) =>
      h('div', { class: 'mc-item mc-box', 'data-x': 'box' }, itemIcon(it, i, ctx), itemField('h3', 'mc-it', i, 'title', it, ctx, 'عنوان'), itemField('p', 'mc-ix', i, 'text', it, ctx, 'وصف'), removeBtn(i, ctx)),
    ),
    addBtn(ctx),
  ),
];

L.stats = (card, ctx) => [
  ...header(card, ctx),
  h(
    'div',
    { class: `mc-items mc-grid mc-stats n${Math.min(Math.max(card.items?.length || 3, 2), 4)}` },
    (card.items || []).map((it, i) =>
      h('div', { class: 'mc-item mc-box', 'data-x': 'box' }, itemField('div', 'mc-val', i, 'value', it, ctx, '0%'), itemField('h3', 'mc-it', i, 'title', it, ctx, 'المؤشر'), itemField('p', 'mc-ix', i, 'text', it, ctx, 'سياق'), removeBtn(i, ctx)),
    ),
    addBtn(ctx),
  ),
];

L.timeline = (card, ctx) => [
  ...header(card, ctx),
  h(
    'div',
    { class: `mc-items mc-timeline n${card.items?.length || 0}` },
    h('div', { class: 'mc-track', 'data-x': 'box' }),
    (card.items || []).map((it, i) =>
      h('div', { class: 'mc-item' }, h('span', { class: 'mc-dot', 'data-x': 'box' }), itemField('h3', 'mc-it', i, 'title', it, ctx, 'المرحلة'), itemField('p', 'mc-ix', i, 'text', it, ctx, 'ما يحدث'), removeBtn(i, ctx)),
    ),
    addBtn(ctx),
  ),
];

L.steps = (card, ctx) => [
  ...header(card, ctx),
  h(
    'div',
    { class: `mc-items mc-grid mc-steps n${Math.min(Math.max(card.items?.length || 3, 2), 5)}` },
    (card.items || []).map((it, i) =>
      h('div', { class: 'mc-item mc-box', 'data-x': 'box' }, h('span', { class: 'mc-stepno', 'data-x': 'text' }, String(i + 1)), itemField('h3', 'mc-it', i, 'title', it, ctx, 'الخطوة'), itemField('p', 'mc-ix', i, 'text', it, ctx, 'كيف'), removeBtn(i, ctx)),
    ),
    addBtn(ctx, 'إضافة خطوة'),
  ),
];

L.comparison = (card, ctx) => {
  const items = (card.items || []).slice(0, 2);
  while (ctx.editable && items.length < 2) items.push({ icon: 'circle-check', title: '', text: '', value: '' });
  return [
    ...header(card, ctx),
    h(
      'div',
      { class: 'mc-items mc-compare' },
      items.map((it, i) =>
        h(
          'div',
          { class: `mc-item mc-box side${i}`, 'data-x': 'box' },
          h('div', { class: 'mc-side-head' }, itemIcon(it, i, ctx), itemField('h3', 'mc-it', i, 'title', it, ctx, i ? 'الجانب الثاني' : 'الجانب الأول')),
          itemField('p', 'mc-ix mc-lines', i, 'text', it, ctx, 'نقطة في كل سطر'),
        ),
      ),
      items.length === 2 ? h('span', { class: 'mc-vs', 'data-x': 'text' }, ctx.dir === 'rtl' ? 'مقابل' : 'vs') : null,
    ),
  ];
};

L.quote = (card, ctx) => [
  h('div', { class: 'mc-qmark', 'aria-hidden': 'true' }, '”'),
  field('blockquote', 'mc-quote', 'body', card.body, ctx, { rich: true, ph: 'نص الاقتباس' }),
  field('p', 'mc-author', 'subtitle', card.subtitle, ctx, { ph: 'القائل (اختياري)' }),
  ctx.editable ? field('p', 'mc-qtitle', 'title', card.title, ctx, { ph: 'عنوان البطاقة (لا يظهر في العرض)' }) : null,
];

L.chart = (card, ctx) => {
  const items = card.items || [];
  const nums = items.map((it) => parseFloat(String(it.value).replace(/[^\d.\-]/g, '')) || 0);
  const max = Math.max(1, ...nums);
  return [
    ...header(card, ctx, { withBody: false }),
    h(
      'div',
      { class: 'mc-items mc-chart' },
      items.map((it, i) =>
        h(
          'div',
          { class: 'mc-bar-col' },
          itemField('div', 'mc-bar-val', i, 'value', it, ctx, '0'),
          h('div', { class: 'mc-bar-wrap' }, h('div', { class: `mc-bar b${i % 2}`, 'data-x': 'box', style: { height: `${Math.max(3, (nums[i] / max) * 100)}%` } })),
          itemField('div', 'mc-bar-label', i, 'title', it, ctx, 'التسمية'),
          removeBtn(i, ctx),
        ),
      ),
      addBtn(ctx, 'إضافة عمود'),
    ),
    field('div', 'mc-body', 'body', card.body, ctx, { rich: true, ph: 'تعليق على البيانات (اختياري)' }),
  ];
};

L.closing = (card, ctx) => [
  ...header(card, ctx, { titleTag: 'h1' }),
  card.items?.length || ctx.editable
    ? h(
        'div',
        { class: 'mc-items mc-chips' },
        (card.items || []).map((it, i) => h('div', { class: 'mc-item mc-box', 'data-x': 'box' }, itemIcon(it, i, ctx), h('div', { class: 'mc-item-txt' }, itemField('h3', 'mc-it', i, 'title', it, ctx, 'خطوة تالية'), itemField('p', 'mc-ix', i, 'text', it, ctx, '')), removeBtn(i, ctx))),
        addBtn(ctx),
      )
    : null,
];

// ---------- card ----------

function effectivePos(card, format) {
  const pos = card.image?.pos || 'none';
  if (pos === 'none') return 'none';
  if (format === 'social' && (pos === 'start' || pos === 'end')) return 'top';
  if (card.layout === 'quote' && pos === 'top') return 'start';
  return pos;
}

function media(card, ctx, pos) {
  const img = card.image || {};
  const fig = h('figure', { class: 'mc-media' });
  if (img.url) {
    const el = h('img', {
      src: img.url,
      alt: img.alt || '',
      loading: ctx.eager ? 'eager' : 'lazy',
      decoding: 'async',
      draggable: 'false',
      referrerpolicy: 'no-referrer',
      'data-x': 'img',
      style: { objectPosition: img.focus || '50% 50%' },
    });
    el.addEventListener('error', () => fig.classList.add('broken'), { once: true });
    fig.append(el);
    if (img.credit && pos !== 'bg') fig.append(h('figcaption', { class: 'mc-credit', 'data-noexport': '' }, img.credit));
  } else {
    fig.classList.add(img.loading ? 'loading' : 'empty');
    fig.append(h('div', { class: 'mc-media-ph' }, icon(img.loading ? 'sparkles' : 'image', 34), img.loading ? h('span', {}, 'جارٍ تجهيز الصورة…') : ctx.editable ? h('span', {}, 'أضف صورة') : null));
  }
  if (ctx.editable) {
    fig.classList.add('editable');
    fig.title = 'تغيير الصورة';
    fig.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.hooks?.image?.();
    });
  }
  return fig;
}

export function renderCard(card, deck, opts = {}) {
  const format = deck.format || 'presentation';
  const fmt = FORMATS[format] || FORMATS.presentation;
  const theme = getTheme(deck);
  const dir = deckDir(deck);
  const index = opts.index ?? deck.cards.indexOf(card);
  const sectionNo = deck.cards.slice(0, index + 1).filter((c) => c.layout === 'section').length || 1;
  const ctx = { editable: !!opts.editable, hooks: opts.hooks, dir, sectionNo, format, eager: !!opts.eager };
  const pos = effectivePos(card, format);
  const layout = L[card.layout] ? card.layout : 'bullets';

  const el = h('article', {
    class: `mcard f-${format} l-${layout} img-${pos} ${isFixed(format) ? 'fixed' : 'flow'}`,
    dir,
    lang: deck.settings?.lang && deck.settings.lang !== 'auto' ? deck.settings.lang : null,
    'data-id': card.id,
    'aria-label': `${LAYOUT_LABELS[layout] || ''}: ${card.title || ''}`,
    style: { width: fmt.w + 'px', height: fmt.h ? fmt.h + 'px' : null },
  });
  applyTheme(el, theme);
  el.append(h('div', { class: 'mc-deco', 'aria-hidden': 'true' }));
  if (pos !== 'none') el.append(media(card, ctx, pos));
  const main = h('div', { class: 'mc-main' }, h('div', { class: 'mc-content' }, L[layout](card, ctx)));
  // Presentation slides carry a quiet footer (deck title + slide number), like a professionally built deck.
  if (format === 'presentation' && layout !== 'cover') {
    main.append(h('div', { class: 'mc-foot', 'aria-hidden': 'true' }, h('span', { class: 'mc-foot-t', 'data-x': 'text' }, deck.title || ''), h('span', { class: 'mc-foot-n', 'data-x': 'text' }, String(index + 1).padStart(2, '0'))));
  }
  el.append(main);
  if (theme.logo) el.append(h('img', { class: 'mc-logo', src: theme.logo, alt: '', 'data-x': 'img' }));
  return el;
}

// Shrinks the type of fixed-size cards until the content fits.
export function fitCard(el) {
  if (!el.classList.contains('fixed')) return;
  const main = el.querySelector('.mc-main');
  if (!main) return;
  let fit = 1;
  el.style.setProperty('--fit', '1');
  let guard = 0;
  while (main.scrollHeight > main.clientHeight + 1 && fit > 0.56 && guard++ < 12) {
    fit = Math.round((fit - 0.06) * 100) / 100;
    el.style.setProperty('--fit', String(fit));
  }
  el.classList.toggle('overflowing', main.scrollHeight > main.clientHeight + 1);
}

// Wraps a card in a box that scales it to the available width (or to fit a box).
export function scaled(cardEl, { fit = 'width', maxH } = {}) {
  const inner = h('div', { class: 'scaler-inner' }, cardEl);
  const wrap = h('div', { class: 'scaler' }, inner);
  const baseW = parseFloat(cardEl.style.width);
  const update = () => {
    const w = wrap.clientWidth;
    if (!w) return;
    const ch = cardEl.offsetHeight;
    let s = w / baseW;
    if (fit === 'contain' && maxH) s = Math.min(s, maxH() / ch);
    inner.style.transform = `scale(${s})`;
    inner.style.width = baseW + 'px';
    wrap.style.height = ch * s + 'px';
    if (fit === 'contain') inner.style.left = `${(w - baseW * s) / 2}px`;
  };
  const ro = new ResizeObserver(update);
  ro.observe(wrap);
  ro.observe(cardEl);
  wrap._update = update;
  wrap._dispose = () => ro.disconnect();
  requestAnimationFrame(() => {
    fitCard(cardEl);
    update();
  });
  return wrap;
}

let fontsHooked = false;
export function refitAllWhenFontsLoad() {
  if (fontsHooked || !document.fonts) return;
  fontsHooked = true;
  const refit = () => document.querySelectorAll('.mcard.fixed').forEach(fitCard);
  document.fonts.addEventListener?.('loadingdone', refit);
  document.fonts.ready.then(refit);
}
