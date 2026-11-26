import { h, icon, button, select, toast, uid } from './ui.js';
import { FORMATS, LANGUAGES, DENSITY, IMAGE_SOURCES, defaultImagePos } from './schema.js';
import { state } from './state.js';
import { config, stream, turnstileToken, costLabel, canAfford } from './api.js';
import { openPlans } from './plans.js';
import { brandLink, creditsPill } from './chrome.js';
import { THEMES, customTheme } from './themes.js';
import { getPref, setPref } from './store.js';

export function themeTile(theme, selected, onPick) {
  return h(
    'button',
    { type: 'button', class: 'theme-tile', 'aria-pressed': String(selected), onClick: onPick, title: theme.name },
    h(
      'span',
      { class: 'sw', style: { background: `linear-gradient(135deg, ${theme.bg}, ${theme.bg2})`, color: theme.text, fontFamily: `'${theme.heading}', Zain` } },
      h('b', { style: { fontWeight: theme.hw } }, 'عنوان'),
      h('i', { style: { background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})` } }),
      h('span', { style: { color: theme.muted } }, 'نص تجريبي'),
    ),
    theme.name,
  );
}

export function mountOutline(root) {
  const req = state.request;
  if (!req) {
    state.navigate('/', { replace: true });
    return;
  }
  const ctrl = new AbortController();
  let streaming = false;
  const o = state.outline || { title: '', cards: [], source_notes: '', sourceText: '' };
  state.outline = o;
  let theme = getPref('theme', 'alkunt');
  let custom = getPref('customTheme', null);

  const titleIn = h('input', { class: 'field ol-title', 'aria-label': 'عنوان العرض', placeholder: 'عنوان العرض', value: o.title, onInput: (e) => (o.title = e.target.value) });
  const list = h('div', { class: 'ol-list' });
  const status = h('p', { class: 'muted' }, 'راجع البطاقات وعدّلها قبل الإنشاء. اسحب الرقم لإعادة الترتيب.');
  const goBtn = button('أنشئ العرض', { kind: 'primary', size: 'lg', icon: 'sparkles', onClick: () => generate() });
  const addBtn = button('إضافة بطاقة', { kind: 'soft', icon: 'plus', onClick: () => (o.cards.push({ title: '', points: [] }), renderList(true)) });

  let dragFrom = -1;
  function renderList(focusLast = false) {
    list.replaceChildren(
      ...o.cards.map((c, i) => {
        const pts = h('textarea', {
          'aria-label': `نقاط البطاقة ${i + 1}`,
          rows: Math.max(1, c.points.length),
          placeholder: 'نقاط البطاقة، كل نقطة في سطر',
          value: c.points.join('\n'),
          onInput: (e) => {
            c.points = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            autosize(e.target);
          },
        });
        const item = h(
          'div',
          {
            class: 'ol-item',
            draggable: 'true',
            onDragstart: (e) => {
              dragFrom = i;
              item.classList.add('dragging');
              e.dataTransfer.effectAllowed = 'move';
            },
            onDragend: () => item.classList.remove('dragging'),
            onDragover: (e) => (e.preventDefault(), item.classList.add('drop-target')),
            onDragleave: () => item.classList.remove('drop-target'),
            onDrop: (e) => {
              e.preventDefault();
              item.classList.remove('drop-target');
              if (dragFrom < 0 || dragFrom === i) return;
              const [m] = o.cards.splice(dragFrom, 1);
              o.cards.splice(i, 0, m);
              dragFrom = -1;
              renderList();
            },
          },
          h('span', { class: 'ol-num', title: 'اسحب لإعادة الترتيب' }, String(i + 1)),
          h('div', { class: 'ol-fields' }, h('input', { 'aria-label': `عنوان البطاقة ${i + 1}`, placeholder: 'عنوان البطاقة', value: c.title, onInput: (e) => (c.title = e.target.value) }), pts),
          h(
            'div',
            { class: 'ol-tools' },
            button('', { icon: 'arrow-up', size: 'sm', cls: 'btn-icon', title: 'تحريك لأعلى', disabled: i === 0, onClick: () => (o.cards.splice(i - 1, 0, o.cards.splice(i, 1)[0]), renderList()) }),
            button('', { icon: 'arrow-down', size: 'sm', cls: 'btn-icon', title: 'تحريك لأسفل', disabled: i === o.cards.length - 1, onClick: () => (o.cards.splice(i + 1, 0, o.cards.splice(i, 1)[0]), renderList()) }),
            button('', { icon: 'trash-2', size: 'sm', cls: 'btn-icon btn-danger', title: 'حذف البطاقة', onClick: () => (o.cards.splice(i, 1), renderList()) }),
          ),
        );
        requestAnimationFrame(() => autosize(pts));
        return item;
      }),
    );
    if (streaming) list.append(h('div', { class: 'ol-skel' }), h('div', { class: 'ol-skel' }));
    if (focusLast) list.lastElementChild?.querySelector('input')?.focus();
    goBtn.disabled = streaming || !o.cards.length;
    goBtn.lastChild.textContent = `أنشئ العرض${costLabel('generate', o.cards.length)}`;
    addBtn.disabled = streaming || o.cards.length >= config.maxCards;
  }

  // ----- side: settings + theme -----
  const s = req.settings;
  const settingsPanel = h(
    'div',
    { class: 'panel' },
    h('h3', {}, icon('settings', 18), 'الإعدادات'),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('label', { class: 'lbl' }, 'النوع', select(Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label])), s.format, (v) => (s.format = v))),
      h('label', { class: 'lbl' }, 'اللغة', select(LANGUAGES, s.lang, (v) => (s.lang = v))),
      h('label', { class: 'lbl' }, 'كمية النص', select(DENSITY, s.density, (v) => (s.density = v))),
      h('label', { class: 'lbl' }, 'الصور', select(config.demo ? {none:IMAGE_SOURCES.none} : config.aiImages ? IMAGE_SOURCES : { stock: IMAGE_SOURCES.stock, none: IMAGE_SOURCES.none }, req.imageSource, (v) => (req.imageSource = v))),
    ),
  );
  const themeGrid = h('div', { class: 'theme-grid' });
  function renderThemes() {
    const all = [...THEMES, customTheme(custom || {})];
    themeGrid.replaceChildren(
      ...all.map((t) =>
        themeTile(t, theme === t.id, () => {
          theme = t.id;
          setPref('theme', theme);
          renderThemes();
        }),
      ),
    );
  }
  renderThemes();
  const themePanel = h('div', { class: 'panel' }, h('h3', {}, icon('palette', 18), 'الثيم'), themeGrid, h('p', { class: 'tiny', style: { marginTop: '10px' } }, 'يمكنك تغيير الثيم وإنشاء ثيم بهويتك من داخل المحرر.'));

  const topbar = h(
    'header',
    { class: 'topbar' },
    brandLink(),
    h('div', { class: 'spacer' }),
    creditsPill(),
    button('رجوع', { icon: 'arrow-right', onClick: () => (ctrl.abort(), state.navigate('/')) }),
  );

  const page = h(
    'main',
    { class: 'outline-page', id: 'main' },
    h('div', { class: 'outline-main' }, h('h1', {}, 'المخطط'), status, titleIn, list, h('div', { style: { marginTop: '12px' } }, addBtn)),
    h('aside', { class: 'outline-side' }, settingsPanel, themePanel),
  );
  const cta = h('div', { class: 'sticky-cta' }, goBtn);
  root.replaceChildren(topbar, page, cta);
  document.title = 'المخطط | مدار';

  renderList();
  if (!o.cards.length) runOutline();

  async function runOutline() {
    streaming = true;
    o.cards = [];
    renderList();
    status.textContent = 'يخطط مدار لعرضك…';
    try {
      const body = {
        mode: req.mode,
        prompt: req.prompt,
        text: req.text,
        url: req.url,
        file: req.file,
        sourceTitle: req.sourceTitle,
        sourceMode: req.sourceMode,
        cardCount: req.cardCount,
        settings: req.settings,
        turnstile: await turnstileToken(),
      };
      const done = await stream(
        '/madar/api/outline',
        body,
        {
          title: ({ title }) => {
            o.title = title;
            titleIn.value = title;
          },
          card: (c) => {
            o.cards.push({ title: c.title, points: c.points || [] });
            renderList();
          },
          notice: ({ message }) => { status.textContent = message; },
        },
        { signal: ctrl.signal },
      );
      o.title = done.title || o.title;
      titleIn.value = o.title;
      o.cards = done.cards.map((c) => ({ title: c.title, points: c.points || [] }));
      o.source_notes = done.source_notes || '';
      o.sourceText = done.sourceText || '';
      status.textContent = done.demo
        ? 'قالب قابل للتحرير: راجع النص والعناوين ورتّب البطاقات قبل إنشاء العرض.'
        : 'راجع البطاقات وعدّلها قبل الإنشاء. اسحب الرقم لإعادة الترتيب.';
    } catch (e) {
      if (e.name === 'AbortError') return;
      status.textContent = '';
      toast(e.message, 'error', 6000);
      if (!o.cards.length) {
        list.replaceChildren(h('div', { class: 'empty' }, h('p', {}, e.message), h('div', { style: { marginTop: '12px' } }, button('حاول مرة أخرى', { kind: 'primary', icon: 'refresh-cw', onClick: () => runOutline() }))));
      }
    } finally {
      streaming = false;
      if (o.cards.length) renderList();
    }
  }

  function generate() {
    const cards = o.cards.filter((c) => c.title.trim() || c.points.length);
    if (!cards.length) return toast('أضف بطاقة واحدة على الأقل', 'error');
    if (cards.length > config.maxCards) {
      toast(`الخطة ${config.plan.name} تسمح حتى ${config.maxCards} ${config.maxCards > 10 ? 'شريحة' : 'شرائح'}. احذف بعض البطاقات للمتابعة.`, 'error');
      return openPlans();
    }
    if (!canAfford('generate', cards.length)) return openPlans(), toast('نقاطك لا تكفي لكتابة هذا العرض.', 'error');
    const deck = {
      id: uid(),
      title: o.title.trim() || cards[0].title || 'عرض جديد',
      topic: (req.prompt || req.sourceTitle || '').slice(0, 400),
      format: s.format,
      theme,
      customTheme: theme === 'custom' ? custom || {} : null,
      settings: { ...s },
      imageSource: req.imageSource,
      cards: cards.map((c, i) => ({ id: uid(), layout: 'skeleton', title: c.title, subtitle: '', body: '', items: [], notes: '', image: { pos: defaultImagePos(i === 0 ? 'cover' : 'bullets', s.format, i), url: '', query: '' } })),
      createdAt: Date.now(),
      chat: [],
    };
    state.generation = {
      deckId: deck.id,
      outline: { title: deck.title, cards },
      sourceNotes: o.source_notes,
      // The original request and the full source go to the writer so the deck stays on them.
      topic: req.prompt || '',
      sourceTitle: req.sourceTitle || '',
      sourceMode: req.sourceMode,
      sourceText: o.sourceText || req.text || '',
      sourceFile: req.file || null,
      instructions: req.instructions,
    };
    state.pendingDeck = deck;
    state.navigate('/edit/' + deck.id);
  }

  return () => {
    ctrl.abort();
    topbar.querySelector('.credits')?._dispose?.();
  };
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
