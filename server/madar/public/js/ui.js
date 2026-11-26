// Small DOM helpers shared by every screen.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

// Inline SVG icon from lucide (loaded globally in index.html).
export function icon(name, size = 18, cls = '') {
  const node = window.lucide?.icons?.[pascal(name)];
  if (!node) return h('span', { class: `ic ${cls}`, style: { width: size + 'px', height: size + 'px' } });
  const svg = window.lucide.createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ic ${cls}`);
  return svg;
}

export function button(label, opts = {}) {
  const { icon: ic, kind = 'ghost', onClick, title, size, disabled, cls = '' } = opts;
  return h(
    'button',
    { type: 'button', class: `btn btn-${kind} ${size ? 'btn-' + size : ''} ${cls}`, title: title || null, 'aria-label': title || null, onClick, disabled },
    ic ? icon(ic, size === 'sm' ? 16 : 18) : null,
    label ? h('span', {}, label) : null,
  );
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function toast(message, kind = 'info', ms = 3800, action = null) {
  const box = document.getElementById('toasts');
  const t = h(
    'div',
    { class: `toast toast-${kind}` },
    icon(kind === 'error' ? 'circle-x' : kind === 'ok' ? 'circle-check' : 'info', 18),
    h('span', {}, message),
    action ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', onClick: () => (action.onClick(), t.remove()) }, action.label) : null,
  );
  box.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// Modal dialog. Returns { el, close }.
export function modal(title, body, { width = 560, onClose } = {}) {
  const prev = document.activeElement;
  const close = () => {
    wrap.classList.remove('in');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 200);
    onClose?.();
    prev?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { maxWidth: width + 'px' } },
    h('div', { class: 'modal-head' }, h('h2', {}, title), button('', { icon: 'x', title: 'إغلاق', onClick: close, cls: 'btn-icon' })),
    h('div', { class: 'modal-body' }, body),
  );
  const wrap = h('div', { class: 'modal-wrap', onClick: (e) => e.target === wrap && close() }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    panel.querySelector('input,textarea,button:not(.modal-head button)')?.focus();
  });
  return { el: panel, close };
}

// Popover anchored to an element. Closes on outside click / Escape.
let openPop = null;
export function popover(anchor, content, { align = 'start', width } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover', role: 'menu' }, content);
  if (width) pop.style.width = width + 'px';
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = align === 'end' ? r.left : r.right - pw;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => e.key === 'Escape' && closePopover();
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
  });
  openPop = { pop, onDown, onKey };
  requestAnimationFrame(() => pop.classList.add('in'));
  return pop;
}

export function closePopover() {
  if (!openPop) return;
  document.removeEventListener('pointerdown', openPop.onDown, true);
  document.removeEventListener('keydown', openPop.onKey);
  openPop.pop.remove();
  openPop = null;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function select(options, value, onChange, attrs = {}) {
  const s = h('select', { class: 'field', ...attrs, onChange: (e) => onChange(e.target.value) });
  for (const [v, label] of Object.entries(options)) s.append(h('option', { value: v, selected: v === String(value) }, label));
  return s;
}

export function loadScript(src) {
  if (!loadScript.cache) loadScript.cache = new Map();
  if (!loadScript.cache.has(src)) {
    loadScript.cache.set(
      src,
      new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => {
          loadScript.cache.delete(src);
          rej(new Error('تعذّر تحميل مكتبة ' + src));
        };
        document.head.append(s);
      }),
    );
  }
  return loadScript.cache.get(src);
}

export function formatDate(ts) {
  try {
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(
    () => toast('تم النسخ', 'ok', 1800),
    () => toast('تعذّر النسخ، انسخه يدوياً', 'error'),
  );
}
