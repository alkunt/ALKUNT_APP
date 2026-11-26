import { h, icon, button, select, toast, popover, closePopover, modal, debounce, uid, clear } from './ui.js';
import { FORMATS, LAYOUTS, LAYOUT_LABELS, LAYOUT_ICONS, CARD_ICONS, IMAGE_STYLES, IMAGE_SOURCES, LANGUAGES, defaultImagePos, LIMITS, imageAspect } from './schema.js';
import { state } from './state.js';
import { config, postJSON, stream, turnstileToken, costLabel, pointsFor } from './api.js';
import { brandLink, creditsPill, demoPill } from './chrome.js';
import { loadDeck, saveDeck, History, setPref } from './store.js';
import { renderCard, scaled, fitCard, htmlToMd, isFixed, deckDir } from './render.js';
import { THEMES, FONT_CHOICES, customTheme, getTheme } from './themes.js';
import { themeTile } from './outline.js';
import { fillImages, searchImages, aiImage, uploadImage } from './images.js';
import { startPresent } from './present.js';
import { openShare } from './share.js';
import { exportPDF, exportPPTX, exportPNG, exportJSON } from './export.js';

const ITEM_NEEDS = { bullets: 3, columns: 3, stats: 3, timeline: 4, steps: 3, comparison: 2, chart: 4 };
const SINGLE_LINE = /^(title|subtitle|items\.\d+\.(title|value))$/;

const QUICK = [
  ['أعد الصياغة', 'أعد صياغة هذه البطاقة بأسلوب أقوى وأوضح.'],
  ['اختصر', 'اختصر نص البطاقة إلى النصف تقريباً مع الحفاظ على الفكرة.'],
  ['وسّع', 'أضف تفاصيل وأمثلة مفيدة لهذه البطاقة.'],
  ['بسّط', 'بسّط اللغة لتناسب جمهوراً مبتدئاً.'],
  ['أكثر إقناعاً', 'اجعل البطاقة أكثر إقناعاً وتأثيراً.'],
  ['أضف مثالاً', 'أضف مثالاً عملياً واقعياً.'],
  ['تخطيط أنسب', 'اختر تخطيطاً أنسب لهذا المحتوى وأعد ترتيبه.'],
  ['حوّل لنقاط', 'حوّل محتوى البطاقة إلى نقاط واضحة باستخدام تخطيط النقاط.'],
  ['للإنجليزية', 'Translate this card to English.'],
  ['للعربية', 'ترجم هذه البطاقة إلى العربية الفصحى.'],
];

const SUGGESTIONS = [
  'اجعل العرض أقصر وأكثر تركيزاً',
  'أضف بطاقة عن التحديات وكيف نتغلب عليها',
  'اجعل النبرة أكثر حماساً',
  'أضف أمثلة من منطقة الخليج',
  'ترجم العرض كاملاً إلى الإنجليزية',
  'نوّع التخطيطات أكثر',
];

function blankItems(n, layout) {
  return Array.from({ length: n }, (_, i) => ({ icon: layout === 'comparison' ? (i ? 'circle-check' : 'circle-x') : CARD_ICONS[(i * 7) % CARD_ICONS.length], title: '', text: '', value: layout === 'chart' ? String((i + 1) * 10) : '' }));
}

function fromAI(c, format, index, base = null) {
  const card = base ? { ...base } : { id: uid(), image: { pos: defaultImagePos(c.layout, format, index, c.items?.length || 0), url: '', query: '' } };
  Object.assign(card, {
    layout: LAYOUTS.includes(c.layout) ? c.layout : 'bullets',
    title: c.title || '',
    subtitle: c.subtitle || '',
    body: c.body || '',
    items: Array.isArray(c.items) ? c.items.map((it) => ({ icon: it.icon || 'sparkles', title: it.title || '', text: it.text || '', value: it.value || '' })) : [],
    notes: c.notes || '',
  });
  card.image = { ...(card.image || { pos: 'none', url: '' }), query: c.image_query || card.image?.query || '' };
  return card;
}

export function mountEditor(root, deckId) {
  let deck = state.pendingDeck?.id === deckId ? state.pendingDeck : loadDeck(deckId);
  state.pendingDeck = null;
  if (!deck) {
    toast('لم نجد هذا العرض على هذا الجهاز.', 'error');
    state.navigate('/', { replace: true });
    return;
  }
  const gen = state.generation?.deckId === deckId ? state.generation : null;
  state.generation = null;
  deck.chat ||= [];
  deck.settings ||= { format: deck.format, lang: 'ar', density: 'medium', tone: 'professional' };
  for (const c of deck.cards) {
    if (c.image) c.image.loading = false;
    if (c.layout === 'skeleton' && !gen) c.layout = 'bullets';
  }

  const hist = new History();
  let panel = null;
  let active = 0;
  let generating = false;
  let genCtrl = null;
  let disposed = false;
  const scalers = new Map();

  // ---------- persistence ----------
  const save = () => {
    if (disposed && !deck) return;
    if (deck.cards.some((c) => c.layout === 'skeleton')) return;
    if (!saveDeck(deck)) toast('تعذّر الحفظ في هذا المتصفح (قد تكون المساحة ممتلئة).', 'error');
  };
  const saveSoon = debounce(save, 500);

  function snap() {
    hist.snapshot(deck);
    updateUndo();
  }
  function replaceDeck(d) {
    deck = d;
    titleIn.value = deck.title;
    renderAll();
    if (panel) renderPanel();
    saveSoon();
  }
  function undo() {
    const d = hist.undo(deck);
    if (d) replaceDeck(d);
    updateUndo();
  }
  function redo() {
    const d = hist.redo(deck);
    if (d) replaceDeck(d);
    updateUndo();
  }
  const indexOf = (id) => deck.cards.findIndex((c) => c.id === id);

  // ---------- top bar ----------
  const titleIn = h('input', {
    class: 'title-input',
    'aria-label': 'عنوان العرض',
    value: deck.title,
    onFocus: () => snap(),
    onInput: (e) => {
      deck.title = e.target.value;
      saveSoon();
    },
  });
  const undoBtn = button('', { icon: 'undo-2', cls: 'btn-icon', title: 'تراجع (Ctrl+Z)', onClick: undo });
  const redoBtn = button('', { icon: 'redo-2', cls: 'btn-icon', title: 'إعادة (Ctrl+Shift+Z)', onClick: redo });
  function updateUndo() {
    undoBtn.disabled = !hist.canUndo() || generating;
    redoBtn.disabled = !hist.canRedo() || generating;
  }
  const exportBtn = button('تصدير', { icon: 'download', onClick: (e) => exportMenu(e.currentTarget) });
  const topbar = h(
    'header',
    { class: 'topbar' },
    brandLink({ short: true }),
    titleIn,
    h('div', { class: 'spacer' }),
    demoPill(),
    creditsPill(),
    undoBtn,
    redoBtn,
    button('الثيم', { icon: 'palette', onClick: () => togglePanel('themes') }),
    button('المساعد', { disabled:config.demo, title:config.demo?'المساعد الذكي غير مفعّل':null, icon: 'wand-sparkles', cls: 'ai-btn', onClick: () => togglePanel('assistant') }),
    exportBtn,
    button('حفظ ورابط', { icon: 'lock', onClick: () => !generating && openShare(deck, { onChange: save }) }),
    button('اعرض', { icon: 'play', kind: 'primary', onClick: () => !generating && startPresent(deck, active) }),
  );

  // ---------- layout ----------
  const rail = h('nav', { class: 'rail', 'aria-label': 'قائمة البطاقات' });
  const cardsEl = h('div', { class: `cards f-${deck.format}` });
  const banner = h('div', { class: 'gen-banner', hidden: true });
  const addEnd = h(
    'div',
    { class: 'add-end' },
    button('بطاقة جديدة', { kind: 'soft', icon: 'plus', onClick: (e) => insertMenu(e.currentTarget, deck.cards.length) }),
  );
  const canvas = h('main', { class: 'canvas', id: 'main' }, banner, cardsEl, addEnd);
  const side = h('aside', { class: 'sidepanel', 'aria-label': 'لوحة جانبية' });
  const editor = h('div', { class: 'editor' }, rail, canvas);
  root.replaceChildren(topbar, editor);
  document.title = `${deck.title} | مدار`;

  // ---------- rendering ----------
  function updateCanvasTheme() {
    const t = getTheme(deck);
    canvas.style.setProperty('--deck-bg', t.dark ? t.bg : t.bg);
    canvas.classList.toggle('light', !t.dark);
  }

  function hooksFor(id) {
    return {
      removeItem: (i) => {
        const c = deck.cards[indexOf(id)];
        snap();
        c.items.splice(i, 1);
        renderSlot(indexOf(id));
      },
      addItem: () => {
        const idx = indexOf(id);
        const c = deck.cards[idx];
        snap();
        c.items.push(blankItems(1, c.layout)[0]);
        renderSlot(idx);
        requestAnimationFrame(() => cardsEl.querySelector(`.cslot[data-id="${id}"] [data-f="items.${c.items.length - 1}.title"]`)?.focus());
      },
      pickIcon: (i, anchor) => iconPicker(anchor, id, i),
      image: () => openPanel('image', id),
    };
  }

  function skeleton() {
    const fmt = FORMATS[deck.format];
    return h('div', { class: 'skel-card', style: { aspectRatio: fmt.h ? `${fmt.w} / ${fmt.h}` : null, height: fmt.h ? null : '420px' } });
  }

  function buildSlot(i) {
    const c = deck.cards[i];
    const slot = h('section', { class: 'cslot', 'data-id': c.id, 'aria-label': `بطاقة ${i + 1}` });
    if (c.layout === 'skeleton') {
      slot.append(skeleton());
      return slot;
    }
    const cardEl = renderCard(c, deck, { editable: !generating, index: i, hooks: hooksFor(c.id) });
    const sc = scaled(cardEl);
    scalers.set(c.id, sc);
    slot.append(h('span', { class: 'cnum' }, String(i + 1)));
    if (!generating) slot.append(toolbar(c.id, i));
    slot.append(sc);
    if (isFixed(deck.format)) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          slot.querySelector('.overflow-flag')?.remove();
          if (cardEl.classList.contains('overflowing'))
            slot.append(h('span', { class: 'overflow-flag badge warn', 'data-noexport': '' }, icon('triangle-alert', 14), 'النص أطول من البطاقة'));
        }),
      );
    }
    slot.addEventListener('pointerdown', () => setActive(indexOf(c.id)));
    return slot;
  }

  function insertRow(pos) {
    return h('div', { class: 'insert' }, button('', { icon: 'plus', size: 'sm', cls: 'btn-icon', title: 'إدراج بطاقة هنا', onClick: (e) => insertMenu(e.currentTarget, pos) }));
  }

  let io;
  function renderAll() {
    scalers.forEach((s) => s._dispose());
    scalers.clear();
    cardsEl.className = `cards f-${deck.format}`;
    const parts = [];
    deck.cards.forEach((c, i) => {
      parts.push(buildSlot(i));
      if (i < deck.cards.length - 1 && !generating) parts.push(insertRow(i + 1));
    });
    cardsEl.replaceChildren(...parts);
    addEnd.hidden = generating;
    updateCanvasTheme();
    renderRail();
    updateUndo();
    io?.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(indexOf(e.target.dataset.id));
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    cardsEl.querySelectorAll('.cslot').forEach((s) => io.observe(s));
  }

  function renderSlot(i) {
    const c = deck.cards[i];
    if (!c) return;
    const old = cardsEl.querySelector(`.cslot[data-id="${c.id}"]`);
    if (!old) return renderAll();
    if (old.contains(document.activeElement) && document.activeElement.isContentEditable) {
      old._pending = true;
      return;
    }
    scalers.get(c.id)?._dispose();
    const fresh = buildSlot(i);
    if (i === active) fresh.classList.add('active');
    old.replaceWith(fresh);
    io?.observe(fresh);
    renderThumb(i);
  }

  // ---------- rail ----------
  let dragFrom = -1;
  function thumb(i) {
    const c = deck.cards[i];
    const box = h('div', { class: 'tbox' });
    if (c.layout === 'skeleton') box.append(h('div', { class: 'skel-card', style: { aspectRatio: '16/9' } }));
    else box.append(scaled(renderCard(c, deck, { index: i, eager: true })));
    const t = h(
      'button',
      {
        type: 'button',
        class: `thumb ${i === active ? 'active' : ''} ${isFixed(deck.format) ? '' : 'flowfmt'}`,
        'data-id': c.id,
        'aria-label': `الانتقال إلى البطاقة ${i + 1}: ${c.title || ''}`,
        draggable: String(!generating),
        onClick: () => scrollToCard(indexOf(c.id)),
        onDragstart: (e) => {
          dragFrom = indexOf(c.id);
          t.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        },
        onDragend: () => t.classList.remove('dragging'),
        onDragover: (e) => (e.preventDefault(), t.classList.add('drop-target')),
        onDragleave: () => t.classList.remove('drop-target'),
        onDrop: (e) => {
          e.preventDefault();
          t.classList.remove('drop-target');
          const to = indexOf(c.id);
          if (dragFrom < 0 || dragFrom === to) return;
          snap();
          const [m] = deck.cards.splice(dragFrom, 1);
          deck.cards.splice(to, 0, m);
          dragFrom = -1;
          renderAll();
          saveSoon();
        },
      },
      h('span', {}, String(i + 1)),
      box,
    );
    return t;
  }
  function renderRail() {
    rail.replaceChildren(...deck.cards.map((_, i) => thumb(i)));
  }
  const thumbTimers = new Map();
  function renderThumb(i) {
    const c = deck.cards[i];
    if (!c) return;
    clearTimeout(thumbTimers.get(c.id));
    thumbTimers.set(
      c.id,
      setTimeout(() => {
        const old = rail.querySelector(`.thumb[data-id="${c.id}"]`);
        const idx = indexOf(c.id);
        if (old && idx >= 0) old.replaceWith(thumb(idx));
      }, 250),
    );
  }

  function setActive(i) {
    if (i < 0 || i === active) return;
    active = i;
    cardsEl.querySelectorAll('.cslot.active').forEach((s) => s.classList.remove('active'));
    const id = deck.cards[i]?.id;
    cardsEl.querySelector(`.cslot[data-id="${id}"]`)?.classList.add('active');
    rail.querySelectorAll('.thumb.active').forEach((t) => t.classList.remove('active'));
    const th = rail.querySelector(`.thumb[data-id="${id}"]`);
    if (th) {
      th.classList.add('active');
      // Scroll only the rail, never the page.
      if (th.offsetTop < rail.scrollTop) rail.scrollTop = th.offsetTop - 12;
      else if (th.offsetTop + th.offsetHeight > rail.scrollTop + rail.clientHeight) rail.scrollTop = th.offsetTop + th.offsetHeight - rail.clientHeight + 12;
    }
  }
  function scrollToCard(i) {
    const id = deck.cards[i]?.id;
    cardsEl.querySelector(`.cslot[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(i);
  }

  // ---------- inline text editing ----------
  let editSnap = null;
  let editDirty = false;
  const refit = debounce((slot) => {
    const card = slot.querySelector('.mcard');
    if (!card) return;
    fitCard(card);
    slot.querySelector('.overflow-flag')?.remove();
    if (card.classList.contains('overflowing')) slot.append(h('span', { class: 'overflow-flag badge warn', 'data-noexport': '' }, icon('triangle-alert', 14), 'النص أطول من البطاقة'));
  }, 250);

  function setField(c, path, value) {
    const parts = path.split('.');
    if (parts[0] === 'items') {
      const it = c.items[+parts[1]];
      if (it) it[parts[2]] = value;
    } else c[path] = value;
  }

  cardsEl.addEventListener('focusin', (e) => {
    if (e.target.matches?.('[data-f]')) {
      editSnap = JSON.stringify(deck);
      editDirty = false;
    }
  });
  cardsEl.addEventListener('input', (e) => {
    const el = e.target.closest?.('[data-f]');
    if (!el) return;
    const slot = el.closest('.cslot');
    const c = deck.cards[indexOf(slot.dataset.id)];
    if (!c) return;
    if (!editDirty && editSnap) {
      hist.snapshot(editSnap);
      editDirty = true;
      updateUndo();
    }
    const rich = el.getAttribute('contenteditable') === 'true';
    setField(c, el.dataset.f, rich ? htmlToMd(el) : el.innerText.replace(/\n+$/, ''));
    refit(slot);
    renderThumb(indexOf(c.id));
    saveSoon();
  });
  cardsEl.addEventListener('focusout', (e) => {
    const slot = e.target.closest?.('.cslot');
    if (!slot) return;
    setTimeout(() => {
      if (slot.contains(document.activeElement)) return;
      const i = indexOf(slot.dataset.id);
      const c = deck.cards[i];
      if (slot._pending || (c?.layout === 'chart' && /^items\.\d+\.value$/.test(e.target.dataset?.f || ''))) {
        slot._pending = false;
        renderSlot(i);
      }
    });
  });
  cardsEl.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[data-f]');
    if (!el) return;
    if (e.key === 'Enter' && SINGLE_LINE.test(el.dataset.f)) {
      e.preventDefault();
      el.blur();
    }
    if (e.key === 'Escape') el.blur();
  });
  cardsEl.addEventListener('paste', (e) => {
    const el = e.target.closest?.('[data-f]');
    if (!el) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, SINGLE_LINE.test(el.dataset.f) ? text.replace(/\s*\n\s*/g, ' ') : text);
  });

  // ---------- card toolbar ----------
  function toolbar(id, i) {
    const n = deck.cards.length;
    const tb = (label, ic, onClick, extra = {}) => button(label, { icon: ic, size: 'sm', cls: `${label ? '' : 'btn-icon'} ${extra.cls || ''}`, title: extra.title || label, onClick, disabled: extra.disabled });
    return h(
      'div',
      { class: 'ctool', role: 'toolbar', 'aria-label': 'أدوات البطاقة', 'data-noexport': '' },
      tb('عدّل بالذكاء', 'wand-sparkles', (e) => aiMenu(e.currentTarget, id), { cls: 'ai-btn', disabled:config.demo, title:config.demo?'التعديل بالذكاء غير مفعّل':null }),
      tb('', 'layout-template', (e) => layoutMenu(e.currentTarget, id), { title: 'التخطيط' }),
      tb('', 'image', () => openPanel('image', id), { title: 'الصورة' }),
      tb('', 'sticky-note', () => notesModal(id), { title: 'ملاحظات المتحدث' }),
      h('span', { class: 'sep' }),
      tb('', 'arrow-up', () => moveCard(id, -1), { title: 'تحريك لأعلى', disabled: i === 0 }),
      tb('', 'arrow-down', () => moveCard(id, 1), { title: 'تحريك لأسفل', disabled: i === n - 1 }),
      tb('', 'copy', () => duplicateCard(id), { title: 'تكرار' }),
      tb('', 'trash-2', () => deleteCard(id), { title: 'حذف', cls: 'btn-danger', disabled: n <= 1 }),
    );
  }

  function moveCard(id, d) {
    const i = indexOf(id);
    const j = i + d;
    if (j < 0 || j >= deck.cards.length) return;
    snap();
    const [m] = deck.cards.splice(i, 1);
    deck.cards.splice(j, 0, m);
    renderAll();
    scrollToCard(j);
    saveSoon();
  }
  function duplicateCard(id) {
    const i = indexOf(id);
    snap();
    const copy = { ...JSON.parse(JSON.stringify(deck.cards[i])), id: uid() };
    deck.cards.splice(i + 1, 0, copy);
    renderAll();
    scrollToCard(i + 1);
    saveSoon();
  }
  function deleteCard(id) {
    if (deck.cards.length <= 1) return;
    snap();
    deck.cards.splice(indexOf(id), 1);
    renderAll();
    saveSoon();
    toast('حُذفت البطاقة', 'info', 5000, { label: 'تراجع', onClick: undo });
  }

  function setLayout(id, layout) {
    const i = indexOf(id);
    const c = deck.cards[i];
    if (c.layout === layout) return;
    snap();
    c.layout = layout;
    const need = ITEM_NEEDS[layout];
    if (need && (c.items?.length || 0) < 2) c.items = [...(c.items || []), ...blankItems(need - (c.items?.length || 0), layout)];
    if (layout === 'comparison' && c.items.length > 2) c.items = c.items.slice(0, 2);
    c.image ||= { pos: 'none', url: '', query: c.title };
    if (c.image.pos === 'none') {
      const p = defaultImagePos(layout, deck.format, i, c.items.length);
      if (p !== 'none') c.image.pos = p;
    }
    renderSlot(i);
    saveSoon();
    fillImages(deck, onImage, { only: [i] });
  }

  function layoutMenu(anchor, id) {
    const c = deck.cards[indexOf(id)];
    popover(
      anchor,
      h(
        'div',
        { class: 'layout-grid' },
        LAYOUTS.map((l) =>
          h('button', { type: 'button', 'aria-pressed': String(c.layout === l), onClick: () => (closePopover(), setLayout(id, l)) }, icon(LAYOUT_ICONS[l], 22), LAYOUT_LABELS[l]),
        ),
      ),
    );
  }

  function iconPicker(anchor, id, itemIndex) {
    popover(
      anchor,
      h(
        'div',
        { class: 'icon-grid' },
        CARD_ICONS.map((name) =>
          h('button', {
            type: 'button',
            title: name,
            'aria-label': name,
            onClick: () => {
              closePopover();
              const i = indexOf(id);
              snap();
              deck.cards[i].items[itemIndex].icon = name;
              renderSlot(i);
              saveSoon();
            },
          }, icon(name, 20)),
        ),
      ),
      { width: 360 },
    );
  }

  function notesModal(id) {
    const c = deck.cards[indexOf(id)];
    const ta = h('textarea', { class: 'field', rows: 6, placeholder: 'ما الذي ستقوله أثناء عرض هذه البطاقة؟', value: c.notes || '' });
    const m = modal('ملاحظات المتحدث', [
      h('p', { class: 'tiny' }, 'تظهر لك وحدك في وضع العرض (اضغط N).'),
      ta,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button('حفظ', { kind: 'primary', icon: 'check', onClick: () => {
        snap();
        c.notes = ta.value.trim();
        saveSoon();
        m.close();
      } })),
    ]);
  }

  // ---------- AI on one card ----------
  function aiMenu(anchor, id) {
    const ta = h('textarea', { class: 'field', rows: 2, maxlength: LIMITS.instruction, placeholder: 'أو اكتب طلبك: مثلاً أضف رقماً عن السوق الخليجي', style: { minHeight: '64px' } });
    const run = (instruction) => {
      closePopover();
      aiEditCard(id, instruction);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (ta.value.trim()) run(ta.value.trim());
      }
    });
    popover(
      anchor,
      h(
        'div',
        { class: 'ai-pop' },
        h('div', { class: 'quick' }, QUICK.map(([label, ins]) => h('button', { type: 'button', class: 'menu-item', onClick: () => run(ins) }, icon('sparkles', 16), label))),
        ta,
        h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '8px' } }, h('span', { class: 'tiny' }, `${pointsFor('card')} نقطة لكل تعديل`), button('نفّذ', { kind: 'primary', size: 'sm', icon: 'send', onClick: () => ta.value.trim() && run(ta.value.trim()) })),
      ),
    );
    setTimeout(() => ta.focus(), 50);
  }

  function busy(id, on, label = 'يعدّل مدار البطاقة…') {
    const slot = cardsEl.querySelector(`.cslot[data-id="${id}"]`);
    if (!slot) return;
    slot.querySelector('.busy-ov')?.remove();
    if (on) slot.append(h('div', { class: 'busy-ov' }, h('span', { class: 'spinner' }), label));
  }

  async function aiEditCard(id, instruction) {
    const i = indexOf(id);
    const c = deck.cards[i];
    busy(id, true);
    try {
      const res = await postJSON('/madar/api/card', {
        card: c,
        instruction,
        deckTitle: deck.title,
        context: deck.cards.map((x) => x.title),
        position: i + 1,
        settings: deck.settings,
      });
      const j = indexOf(id);
      if (j < 0) return;
      snap();
      const prevLayout = deck.cards[j].layout;
      deck.cards[j] = fromAI(res.card, deck.format, j, deck.cards[j]);
      if (deck.cards[j].layout !== prevLayout && deck.cards[j].image.pos === 'none') deck.cards[j].image.pos = defaultImagePos(deck.cards[j].layout, deck.format, j, deck.cards[j].items.length);
      renderSlot(j);
      saveSoon();
      fillImages(deck, onImage, { only: [j] });
      if (res.demo) toast('وضع تجريبي: التعديل نموذجي.', 'info');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy(id, false);
    }
  }

  // ---------- inserting cards ----------
  function insertMenu(anchor, pos) {
    const input = h('input', { class: 'field', placeholder: 'موضوع البطاقة: مثلاً الأسعار والباقات', maxlength: LIMITS.instruction });
    const runAI = () => {
      const t = input.value.trim();
      if (!t) return input.focus();
      closePopover();
      insertAI(pos, t);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && runAI());
    popover(
      anchor,
      h(
        'div',
        { style: { width: '320px', maxWidth: 'calc(100vw - 32px)', display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px' } },
        h('button', { type: 'button', class: 'menu-item', onClick: () => (closePopover(), insertBlank(pos)) }, icon('plus', 18), 'بطاقة فارغة'),
        h('div', { class: 'menu-sep' }),
        h('b', { style: { fontSize: '15px', padding: '0 6px' } }, 'بطاقة يكتبها مدار'),
        input,
        button(`أنشئ${costLabel('card')}`, { kind: 'primary', size: 'sm', icon: 'wand-sparkles', disabled:config.demo, onClick: runAI }),
      ),
      { align: 'end' },
    );
    setTimeout(() => input.focus(), 50);
  }

  function insertBlank(pos) {
    snap();
    const c = { id: uid(), layout: 'bullets', title: '', subtitle: '', body: '', items: blankItems(3, 'bullets'), notes: '', image: { pos: 'none', url: '', query: '' } };
    deck.cards.splice(pos, 0, c);
    renderAll();
    scrollToCard(pos);
    requestAnimationFrame(() => cardsEl.querySelector(`.cslot[data-id="${c.id}"] [data-f="title"]`)?.focus());
    saveSoon();
  }

  async function insertAI(pos, instruction) {
    const placeholder = { id: uid(), layout: 'skeleton', title: '', items: [] };
    deck.cards.splice(pos, 0, placeholder);
    renderAll();
    scrollToCard(pos);
    try {
      const res = await postJSON('/madar/api/card', { card: null, instruction, deckTitle: deck.title, context: deck.cards.filter((c) => c !== placeholder).map((x) => x.title), position: pos + 1, settings: deck.settings });
      const at = deck.cards.indexOf(placeholder);
      deck.cards.splice(at, 1);
      snap();
      const card = fromAI(res.card, deck.format, at);
      deck.cards.splice(at, 0, card);
      renderAll();
      saveSoon();
      fillImages(deck, onImage, { only: [at] });
    } catch (e) {
      deck.cards.splice(deck.cards.indexOf(placeholder), 1);
      renderAll();
      toast(e.message, 'error');
    }
  }

  // ---------- images ----------
  function onImage(i) {
    renderSlot(i);
    saveSoon();
    if (panel?.type === 'image' && deck.cards[i]?.id === panel.id) renderPanel();
  }

  // ---------- side panels ----------
  function openPanel(type, id = null) {
    panel = { type, id };
    editor.classList.add('with-panel');
    if (!side.isConnected) editor.append(side);
    renderPanel();
  }
  function togglePanel(type) {
    if (panel?.type === type) closePanel();
    else openPanel(type);
  }
  function closePanel() {
    panel = null;
    side.remove();
    editor.classList.remove('with-panel');
    scalers.forEach((s) => s._update());
  }
  function renderPanel() {
    if (!panel) return;
    const titles = { themes: 'الثيم والتنسيق', assistant: 'المساعد الذكي', image: 'الصورة' };
    const body = h('div', { class: 'sp-body' });
    const foot = h('div', { class: 'sp-foot', hidden: true });
    side.replaceChildren(h('div', { class: 'sp-head' }, h('h2', {}, titles[panel.type]), button('', { icon: 'x', cls: 'btn-icon', title: 'إغلاق', onClick: closePanel })), body, foot);
    if (panel.type === 'themes') themesPanel(body);
    if (panel.type === 'assistant') assistantPanel(body, foot);
    if (panel.type === 'image') imagePanel(body);
    requestAnimationFrame(() => scalers.forEach((s) => s._update()));
  }

  function themesPanel(body) {
    const fmtSeg = h(
      'div',
      { class: 'seg', style: { width: '100%' } },
      Object.entries(FORMATS).map(([k, v]) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(deck.format === k),
          onClick: () => {
            if (deck.format === k) return;
            snap();
            deck.format = k;
            deck.settings.format = k;
            renderAll();
            renderPanel();
            saveSoon();
          },
        }, icon(v.icon, 16), v.label),
      ),
    );
    const grid = h('div', { class: 'theme-grid' });
    const drawGrid = () =>
      grid.replaceChildren(
        ...[...THEMES, customTheme(deck.customTheme || {})].map((t) =>
          themeTile(t, deck.theme === t.id, () => {
            snap();
            deck.theme = t.id;
            if (t.id === 'custom') deck.customTheme ||= {};
            setPref('theme', t.id);
            renderAll();
            drawGrid();
            drawCustom();
            saveSoon();
          }),
        ),
      );
    const customBox = h('div', { class: 'panel', style: { padding: '12px' } });
    const applyCustom = debounce(() => {
      deck.theme = 'custom';
      setPref('customTheme', deck.customTheme);
      setPref('theme', 'custom');
      renderAll();
      drawGrid();
      saveSoon();
    }, 200);
    function drawCustom() {
      const ct = deck.customTheme || {};
      const update = (patch) => {
        if (!deck.customTheme || deck.theme !== 'custom') snap();
        deck.customTheme = { ...ct, ...patch };
        applyCustom();
      };
      const logoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const up = await uploadImage(f);
          update({ logo: up.url });
          drawCustom();
        } catch (err) {
          toast(err.message, 'error');
        }
      } });
      clear(customBox).append(
        h('h3', {}, icon('palette', 18), 'ثيم بهويتك'),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
          h('label', { class: 'lbl' }, 'اللون الأساسي', h('input', { type: 'color', class: 'field', style: { padding: '4px', height: '44px' }, value: ct.accent || '#2F7BFF', onInput: (e) => update({ accent: e.target.value }) })),
          h('label', { class: 'lbl' }, 'اللون الثانوي', h('input', { type: 'color', class: 'field', style: { padding: '4px', height: '44px' }, value: ct.accent2 || '#29D3FF', onInput: (e) => update({ accent2: e.target.value }) })),
          h('label', { class: 'lbl' }, 'الخط', select(Object.fromEntries(FONT_CHOICES.map((f) => [f, f])), ct.font || 'Zain', (v) => update({ font: v }))),
          h('label', { class: 'lbl' }, 'الخلفية', select({ dark: 'داكنة', light: 'فاتحة' }, ct.dark === false ? 'light' : 'dark', (v) => update({ dark: v === 'dark' }))),
        ),
        h('div', { class: 'row', style: { marginTop: '10px' } }, button(ct.logo ? 'تغيير الشعار' : 'رفع شعارك', { kind: 'soft', size: 'sm', icon: 'upload', onClick: () => logoIn.click() }), ct.logo ? button('إزالة', { size: 'sm', cls: 'btn-danger', onClick: () => (update({ logo: '' }), drawCustom()) }) : null, logoIn),
      );
    }
    drawGrid();
    drawCustom();
    body.append(
      h('div', {}, h('h3', { style: { fontSize: '16px', marginBottom: '8px' } }, 'النوع'), fmtSeg),
      h('div', {}, h('h3', { style: { fontSize: '16px', marginBottom: '8px' } }, 'الثيمات'), grid),
      customBox,
      h(
        'div',
        { class: 'panel', style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('label', { class: 'lbl' }, 'لغة العرض (للاتجاه وتعديلات الذكاء)', select(LANGUAGES, deck.settings.lang || 'ar', (v) => {
          snap();
          deck.settings.lang = v;
          delete deck.dir;
          renderAll();
          saveSoon();
        })),
        h('label', { class: 'lbl' }, 'مصدر الصور الجديدة', select(config.demo ? {none:IMAGE_SOURCES.none} : config.aiImages ? IMAGE_SOURCES : { stock: IMAGE_SOURCES.stock, none: IMAGE_SOURCES.none }, deck.imageSource || 'stock', (v) => {
          deck.imageSource = v;
          saveSoon();
        })),
      ),
    );
  }

  function assistantPanel(body, foot) {
    foot.hidden = false;
    const chat = h('div', { class: 'chat' });
    const drawChat = () => {
      chat.replaceChildren(
        h('div', { class: 'msg ai' }, 'أهلاً! اطلب مني أي تعديل على العرض كاملاً: أختصره، أترجمه، أضيف بطاقات، أغيّر النبرة أو الترتيب.'),
        ...deck.chat.slice(-20).map((m) => h('div', { class: `msg ${m.role === 'user' ? 'user' : 'ai'}` }, m.text)),
      );
      body.scrollTop = body.scrollHeight;
    };
    drawChat();
    const chips = h('div', { class: 'examples', style: { marginTop: 0 } }, SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'chip', onClick: () => send(s) }, s)));
    body.append(chat, chips);
    const ta = h('textarea', { class: 'field', rows: 2, maxlength: LIMITS.instruction, placeholder: 'اكتب طلبك للمساعد…', style: { minHeight: '64px' } });
    const sendBtn = button(`أرسل${costLabel('assistant', deck.cards.length)}`, { kind: 'primary', icon: 'send', onClick: () => send(ta.value) });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(ta.value);
      }
    });
    foot.append(ta, sendBtn);

    async function send(text) {
      text = (text || '').trim();
      if (!text || generating) return;
      ta.value = '';
      deck.chat.push({ role: 'user', text });
      drawChat();
      chips.hidden = true;
      const pending = h('div', { class: 'msg ai' }, h('span', { class: 'spinner', style: { display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: '8px' } }), 'يعمل مدار على طلبك…');
      chat.append(pending);
      body.scrollTop = body.scrollHeight;
      sendBtn.disabled = true;
      let got = 0;
      try {
        const res = await stream(
          '/madar/api/assistant',
          {
            instruction: text,
            deck: { title: deck.title, cards: deck.cards },
            settings: deck.settings,
            history: deck.chat.slice(-7, -1),
            turnstile: await turnstileToken(),
          },
          {
            reply: ({ reply }) => (pending.lastChild.textContent = reply),
            card: () => (pending.lastChild.textContent = `يحدّث البطاقات… ${++got}`),
          },
        );
        if (!Array.isArray(res.cards) || !res.cards.length) throw new Error('لم يرجع المساعد أي بطاقات.');
        snap();
        const old = deck.cards;
        const used = new Set();
        deck.cards = res.cards.map((rc, k) => {
          const orig = rc.ref > 0 && rc.ref <= old.length && !used.has(rc.ref) ? old[rc.ref - 1] : null;
          if (orig) used.add(rc.ref);
          return fromAI(rc, deck.format, k, orig ? JSON.parse(JSON.stringify(orig)) : null);
        });
        if (res.title) {
          deck.title = res.title;
          titleIn.value = res.title;
        }
        deck.chat.push({ role: 'assistant', text: res.reply || 'تم.' });
        renderAll();
        saveSoon();
        fillImages(deck, onImage);
      } catch (e) {
        deck.chat.push({ role: 'assistant', text: `تعذّر التنفيذ: ${e.message}` });
      } finally {
        sendBtn.disabled = false;
        drawChat();
        saveSoon();
      }
    }
    setTimeout(() => ta.focus(), 50);
  }

  function imagePanel(body) {
    const i = indexOf(panel.id);
    const c = deck.cards[i];
    if (!c) return closePanel();
    c.image ||= { pos: 'none', url: '', query: c.title };
    const img = c.image;
    const set = (patch, { fill = false } = {}) => {
      snap();
      Object.assign(img, patch);
      renderSlot(indexOf(c.id));
      saveSoon();
      renderPanel();
      if (fill) fillImages(deck, onImage, { only: [indexOf(c.id)] });
    };
    const rtl = deckDir(deck) === 'rtl';
    const POS = [
      ['none', 'بدون', 'x'],
      ['start', rtl ? 'يمين' : 'يسار', rtl ? 'arrow-right' : 'arrow-left'],
      ['end', rtl ? 'يسار' : 'يمين', rtl ? 'arrow-left' : 'arrow-right'],
      ['top', 'أعلى', 'arrow-up'],
      ['bg', 'خلفية', 'image'],
    ];
    body.append(
      h('p', { class: 'tiny' }, `البطاقة ${i + 1}: ${c.title || ''}`),
      h('div', {}, h('b', { style: { fontSize: '15px' } }, 'موضع الصورة'), h('div', { class: 'pos-grid', style: { marginTop: '6px' } }, POS.map(([k, label, ic]) => h('button', { type: 'button', 'aria-pressed': String((img.pos || 'none') === k), onClick: () => set({ pos: k }, { fill: k !== 'none' && !img.url }) }, icon(ic, 18), label)))),
    );
    if (img.url) {
      body.append(
        h('div', { class: 'img-grid', style: { gridTemplateColumns: '1fr' } }, h('button', { type: 'button', style: { cursor: 'default' } }, h('img', { src: img.url, alt: img.alt || '', referrerpolicy: 'no-referrer' }))),
        img.credit ? h('p', { class: 'tiny', dir: 'ltr', style: { textAlign: 'start' } }, img.credit) : null,
        h(
          'div',
          { class: 'row' },
          h('label', { class: 'lbl grow' }, 'تركيز الصورة', select({ '50% 50%': 'الوسط', '50% 15%': 'الأعلى', '50% 85%': 'الأسفل', '15% 50%': 'اليسار', '85% 50%': 'اليمين' }, img.focus || '50% 50%', (v) => set({ focus: v }))),
          button('إزالة', { cls: 'btn-danger', icon: 'trash-2', onClick: () => set({ url: '', credit: '', pos: 'none' }) }),
        ),
      );
    }
    // search
    const q = h('input', { class: 'field grow', value: img.query || c.title || '', placeholder: 'ابحث بالإنجليزية لنتائج أفضل', 'aria-label': 'بحث عن صورة' });
    const results = h('div', { class: 'img-grid' });
    let page = 1;
    const more = button('المزيد', { kind: 'soft', size: 'sm', onClick: () => doSearch(page + 1) });
    more.hidden = true;
    async function doSearch(p = 1) {
      const term = q.value.trim();
      if (!term) return;
      page = p;
      if (p === 1) results.replaceChildren(h('span', { class: 'spinner' }));
      try {
        const list = await searchImages(term, p);
        if (p === 1) results.replaceChildren();
        if (!list.length && p === 1) results.append(h('p', { class: 'tiny' }, 'لا نتائج. جرّب كلمات أخرى بالإنجليزية.'));
        results.querySelector('.spinner')?.remove();
        for (const r of list)
          results.append(h('button', { type: 'button', title: r.credit, onClick: () => set({ url: r.url, alt: r.alt, credit: r.credit, source: 'stock', query: term, pos: img.pos === 'none' ? defaultImagePos('image_text', deck.format, 1) : img.pos }) }, h('img', { src: r.thumb, alt: r.alt, loading: 'lazy', referrerpolicy: 'no-referrer' })));
        more.hidden = list.length < 10;
      } catch (e) {
        results.replaceChildren(h('p', { class: 'tiny' }, e.message));
      }
    }
    q.addEventListener('keydown', (e) => e.key === 'Enter' && doSearch(1));
    body.append(h('div', { class: 'panel', style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } }, h('h3', {}, icon('search', 18), 'صور فوتوغرافية مجانية'), h('div', { class: 'row' }, q, button('', { icon: 'search', cls: 'btn-icon btn-soft', title: 'بحث', onClick: () => doSearch(1) })), results, more));
    doSearch(1);

    // AI
    if (config.aiImages) {
      const prompt = h('textarea', { class: 'field', rows: 2, style: { minHeight: '64px' }, value: img.query || c.title || '', placeholder: 'صِف الصورة التي تريدها' });
      let style = deck.settings.imageStyle || 'photo';
      const go = button(`ولّد صورة${costLabel('image')}`, { kind: 'primary', size: 'sm', icon: 'wand-sparkles', onClick: async () => {
        if (!prompt.value.trim()) return;
        go.disabled = true;
        go.lastChild.textContent = 'جارٍ التوليد…';
        try {
          const targetPos = img.pos === 'none' ? defaultImagePos('image_text', deck.format, 1) : img.pos;
          const r = await aiImage(prompt.value.trim(), style, imageAspect(deck.format, targetPos), deck.topic || deck.title);
          if (!r?.url) throw new Error('توليد الصور غير متاح الآن ولم نجد صورة مطابقة. حاول لاحقاً.');
          if (r.fallback) toast('توليد الصور غير متاح الآن، فاخترنا صورة فوتوغرافية مناسبة.', 'info');
          set({ url: r.url, alt: r.alt, credit: r.credit, source: r.source, pos: img.pos === 'none' ? defaultImagePos('image_text', deck.format, 1) : img.pos });
        } catch (e) {
          toast(e.message, 'error');
          go.disabled = false;
          go.lastChild.textContent = 'ولّد صورة';
        }
      } });
      body.append(h('div', { class: 'panel', style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } }, h('h3', {}, icon('wand-sparkles', 18), config.imageEngine === 'nano-banana' ? 'توليد بـ Nano Banana' : 'توليد بالذكاء الاصطناعي'), prompt, select(IMAGE_STYLES, style, (v) => (style = v)), go));
    }
    // upload
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const up = await uploadImage(f);
        set({ ...up, pos: img.pos === 'none' ? defaultImagePos('image_text', deck.format, 1) : img.pos });
      } catch (err) {
        toast(err.message, 'error');
      }
    } });
    body.append(h('div', { class: 'row' }, button('ارفع صورة من جهازك', { kind: 'soft', icon: 'upload', onClick: () => file.click() }), file));
  }

  // ---------- export ----------
  function exportMenu(anchor) {
    if (generating) return;
    const item = (ic, label, hint, fn) => h('button', { type: 'button', class: 'menu-item', onClick: () => (closePopover(), fn()) }, icon(ic, 18), label, hint ? h('small', {}, hint) : null);
    popover(
      anchor,
      h(
        'div',
        { style: { width: '280px' } },
        item('file-down', 'PDF', 'للطباعة والإرسال', () => exportPDF(deck)),
        item('presentation', 'PowerPoint', 'قابل للتعديل', () => exportPPTX(deck)),
        item('image', 'صورة PNG', 'البطاقة الحالية', () => exportPNG(deck, active)),
        h('div', { class: 'menu-sep' }),
        item('file-json', 'نسخة احتياطية', 'ملف مدار', () => exportJSON(deck)),
      ),
      { align: 'end' },
    );
  }

  // ---------- keyboard ----------
  const onKey = (e) => {
    const inField = e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y' && !inField) {
      e.preventDefault();
      redo();
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (!generating) startPresent(deck, active);
    }
  };
  document.addEventListener('keydown', onKey);

  // ---------- generation ----------
  async function runGeneration() {
    generating = true;
    genCtrl = new AbortController();
    const total = deck.cards.length;
    const setBanner = (n) => {
      banner.hidden = false;
      banner.replaceChildren(h('span', { class: 'spinner' }), h('span', { class: 'grow' }, n ? `يكتب مدار عرضك… البطاقة ${Math.min(n + 1, total)} من ${total}` : 'يفكّر مدار في عرضك…'), button('إيقاف', { size: 'sm', onClick: () => genCtrl.abort() }));
    };
    setBanner(0);
    renderAll();
    let k = 0;
    const apply = (c, i) => {
      if (i >= deck.cards.length) deck.cards.push({ id: uid(), layout: 'skeleton', items: [] });
      deck.cards[i] = fromAI(c, deck.format, i, { id: deck.cards[i].id, image: { pos: defaultImagePos(c.layout, deck.format, i, c.items?.length || 0), url: '', query: '' } });
      renderSlot(i);
      fillImages(deck, onImage, { only: [i] });
    };
    try {
      const done = await stream(
        '/madar/api/generate',
        {
          outline: gen.outline,
          settings: deck.settings,
          sourceNotes: gen.sourceNotes,
          topic: gen.topic,
          sourceTitle: gen.sourceTitle,
          sourceMode: gen.sourceMode,
          sourceText: gen.sourceText,
          sourceFile: gen.sourceFile,
          instructions: gen.instructions,
          turnstile: await turnstileToken(),
        },
        {
          card: (c) => {
            apply(c, k++);
            setBanner(k);
          },
        },
        { signal: genCtrl.signal },
      );
      done.cards.forEach((c, i) => i >= k && apply(c, i));
      deck.cards = deck.cards.slice(0, Math.max(done.cards.length, 1));
      toast(done.demo ? 'القالب جاهز. راجع النص وعدّل البطاقات بما يناسب عرضك.' : 'عرضك جاهز! عدّل أي نص بالنقر عليه.', 'ok', 5000);
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error', 7000);
      else toast('أوقفت الإنشاء.', 'info');
    } finally {
      generating = false;
      deck.cards = deck.cards.filter((c) => c.layout !== 'skeleton');
      banner.hidden = true;
      if (!deck.cards.length) {
        toast('لم تُنشأ أي بطاقة. حاول مرة أخرى.', 'error');
        state.navigate('/outline', { replace: true });
        return;
      }
      renderAll();
      save();
      history.replaceState({}, '', '/edit/' + deck.id);
    }
  }

  renderAll();
  if (gen) runGeneration();
  else {
    save();
    fillImages(deck, onImage);
  }

  return () => {
    disposed = true;
    genCtrl?.abort();
    io?.disconnect();
    scalers.forEach((s) => s._dispose());
    document.removeEventListener('keydown', onKey);
    topbar.querySelector('.credits')?._dispose?.();
    closePopover();
    if (!generating) save();
  };
}
