import { h, icon, button, select, toast, loadScript, formatDate } from './ui.js';
import { FORMATS, LANGUAGES, DENSITY, TONES, IMAGE_SOURCES, IMAGE_STYLES, SOURCE_MODES, LIMITS, deckEstimate } from './schema.js';
import { state, BRAND } from './state.js';
import { config, canAfford } from './api.js';
import { openPlans } from './plans.js';
import { brandLink, creditsPill, demoPill } from './chrome.js';
import { listDecks, deleteDeck, loadDeck, saveDeck, getPref, setPref } from './store.js';
import { renderCard, scaled } from './render.js';
import { logoElement } from './logo.js';
import { uid } from './ui.js';

const EXAMPLES = [
  'خطة تسويق لمقهى مختص في الكويت',
  'درس تفاعلي عن الذكاء الاصطناعي لطلاب المرحلة الثانوية',
  'عرض استثماري لتطبيق توصيل طلبات منزلية',
  'ورشة عمل عن إدارة الوقت للموظفين',
  'دليل مختصر للحفاظ على صحة القلب',
  'تقرير ربع سنوي عن أداء فريق المبيعات',
  'صفحة تعريفية لدورة تصوير بالجوال',
  'كاروسيل إنستغرام: 7 أخطاء شائعة في كتابة السيرة الذاتية',
];

const MODES = {
  generate: { label: 'من فكرة', icon: 'sparkles' },
  text: { label: 'من نص', icon: 'file-text' },
  file: { label: 'من ملف', icon: 'folder' },
  url: { label: 'من رابط', icon: 'link' },
};

const FMT_SHAPES = { presentation: [34, 20], document: [22, 30], webpage: [34, 24], social: [24, 30] };

export function mountHome(root) {
  const prefs = getPref('create', {});
  const f = {
    mode: 'generate',
    format: prefs.format || 'presentation',
    lang: prefs.lang || 'ar',
    density: prefs.density || 'medium',
    imageSource: config.demo ? 'none' : (prefs.imageSource || (config.aiImages ? 'ai' : 'stock')),
    imageStyle: prefs.imageStyle || 'photo',
    tone: prefs.tone || 'professional',
    cardCount: prefs.cardCount || 10,
    sourceMode: 'condense',
    audience: '',
    instructions: '',
    prompt: '',
    text: '',
    url: '',
    file: null,
  };

  const persist = () =>
    setPref('create', { format: f.format, lang: f.lang, density: f.density, imageSource: f.imageSource, imageStyle: f.imageStyle, tone: f.tone, cardCount: f.cardCount });

  const topbar = h('header', { class: 'topbar' }, brandLink(), h('div', { class: 'spacer' }), demoPill(), creditsPill());

  // ----- mode tabs -----
  const tabs = h('div', { class: 'seg', role: 'tablist' });
  const inputArea = h('div', { class: 'input-area' });
  const examples = h('div', { class: 'examples' });

  function renderTabs() {
    tabs.replaceChildren(
      ...Object.entries(MODES).map(([k, m]) =>
        h('button', { type: 'button', role: 'tab', 'aria-pressed': String(f.mode === k), 'aria-selected': String(f.mode === k), onClick: () => ((f.mode = k), renderTabs(), renderInput(), renderOpts()) }, icon(m.icon, 18), m.label),
      ),
    );
  }

  // ----- formats -----
  const formats = h('div', { class: 'formats', role: 'radiogroup', 'aria-label': 'نوع المحتوى' });
  function renderFormats() {
    formats.replaceChildren(
      ...Object.entries(FORMATS).map(([k, v]) => {
        const [w, hh] = FMT_SHAPES[k];
        return h(
          'button',
          { type: 'button', class: 'fmt', role: 'radio', 'aria-pressed': String(f.format === k), 'aria-checked': String(f.format === k), onClick: () => ((f.format = k), persist(), renderFormats()) },
          h('span', { class: 'shape', style: { width: w + 'px', height: hh + 'px' } }),
          v.label,
        );
      }),
    );
  }

  // ----- input per mode -----
  function renderInput() {
    inputArea.replaceChildren();
    examples.replaceChildren();
    if (f.mode === 'generate') {
      const ta = h('textarea', {
        class: 'field',
        rows: 4,
        maxlength: LIMITS.prompt,
        placeholder: 'صِف ما تريد إنشاءه… مثلاً: عرض عن فوائد العمل عن بعد للشركات الصغيرة، للمدراء، مع أمثلة عملية',
        'aria-label': 'فكرة العرض',
        value: f.prompt,
        onInput: (e) => (f.prompt = e.target.value),
        onKeydown: (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        },
      });
      inputArea.append(h('div', { class: 'prompt-box' }, ta));
      examples.append(
        h('span', { class: 'tiny', style: { alignSelf: 'center' } }, 'جرّب:'),
        ...EXAMPLES.map((ex) => h('button', { type: 'button', class: 'chip', onClick: () => ((f.prompt = ex), (ta.value = ex), ta.focus()) }, ex)),
      );
      setTimeout(() => ta.focus({ preventScroll: true }));
    } else if (f.mode === 'text') {
      inputArea.append(
        h('textarea', {
          class: 'field',
          rows: 8,
          maxlength: LIMITS.text,
          placeholder: 'الصق هنا ملاحظاتك أو مقالك أو أي نص تريد تحويله…',
          'aria-label': 'النص',
          value: f.text,
          onInput: (e) => (f.text = e.target.value),
        }),
      );
    } else if (f.mode === 'url') {
      inputArea.append(
        h('div', { class: 'row' }, h('input', { class: 'field grow', type: 'url', dir: 'ltr', placeholder: 'https://…', 'aria-label': 'الرابط', value: f.url, onInput: (e) => (f.url = e.target.value.trim()) })),
        h('textarea', { class: 'field', rows: 2, style: { marginTop: '10px', minHeight: '70px' }, placeholder: 'توجيه إضافي (اختياري): مثلاً ركّز على الأرقام، أو اجعله للطلاب', value: f.prompt, onInput: (e) => (f.prompt = e.target.value) }),
      );
    } else {
      const input = h('input', { type: 'file', accept: '.pdf,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,image/*', multiple: true, hidden: true, onChange: (e) => e.target.files.length && pickFile(e.target.files) });
      const name = h('span', { class: 'fname' }, f.file ? f.file.name : '');
      const drop = h(
        'div',
        {
          class: 'drop',
          role: 'button',
          tabindex: '0',
          onClick: () => input.click(),
          onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()),
          onDragover: (e) => (e.preventDefault(), drop.classList.add('over')),
          onDragleave: () => drop.classList.remove('over'),
          onDrop: (e) => {
            e.preventDefault();
            drop.classList.remove('over');
            if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files);
          },
        },
        icon('file-up', 34),
        h('b', {}, 'اسحب ملفك هنا أو اضغط للاختيار'),
        h('span', { class: 'tiny' }, 'PDF أو Word أو PowerPoint أو نص أو صور (حتى 5 صور) · حتى 8 ميغابايت'),
        name,
        input,
      );
      async function pickFile(list) {
        try {
          const files = [...list];
          const images = files.filter(isImageFile);
          if (images.length) {
            if (images.length > LIMITS.images) toast(`سنستخدم أول ${LIMITS.images} صور فقط.`, 'info');
            const picked = images.slice(0, LIMITS.images);
            name.textContent = 'جارٍ تجهيز الصور…';
            f.file = { kind: 'images', name: picked.length === 1 ? picked[0].name : `${picked.length} صور`, images: await Promise.all(picked.map(readImageFile)) };
          } else f.file = await readSourceFile(files[0]);
          name.textContent = `${f.file.name} ✓`;
        } catch (e) {
          f.file = null;
          name.textContent = '';
          toast(e.message, 'error');
        }
      }
      inputArea.append(drop, h('textarea', { class: 'field', rows: 2, style: { marginTop: '10px', minHeight: '70px' }, placeholder: 'توجيه إضافي (اختياري)', value: f.prompt, onInput: (e) => (f.prompt = e.target.value) }));
    }
  }

  // ----- options -----
  const opts = h('div', { class: 'opts' });
  const adv = h('div', { class: 'opts' });
  function renderOpts() {
    const counts = {};
    if (f.mode !== 'generate') counts.auto = 'تلقائي';
    for (let i = 3; i <= config.maxCards; i++) counts[i] = `${i} ${i > 10 ? 'بطاقة' : 'بطاقات'}`;
    if (f.mode === 'generate' && f.cardCount === 'auto') f.cardCount = 10;
    if (f.mode !== 'generate' && !f._touchedCount) f.cardCount = 'auto';
    opts.replaceChildren(
      h('label', { class: 'lbl' }, 'عدد البطاقات', select(counts, f.cardCount, (v) => ((f.cardCount = v === 'auto' ? 'auto' : +v), (f._touchedCount = true), persist()))),
      h('label', { class: 'lbl' }, 'اللغة', select(LANGUAGES, f.lang, (v) => ((f.lang = v), persist()))),
      h('label', { class: 'lbl' }, 'كمية النص', select(DENSITY, f.density, (v) => ((f.density = v), persist()))),
      h('label', { class: 'lbl' }, 'الصور', select(config.demo ? {none:IMAGE_SOURCES.none} : config.aiImages ? IMAGE_SOURCES : { stock: IMAGE_SOURCES.stock, none: IMAGE_SOURCES.none }, f.imageSource, (v) => ((f.imageSource = v), persist()))),
    );
    adv.replaceChildren(
      h('label', { class: 'lbl' }, 'النبرة', select(TONES, f.tone, (v) => ((f.tone = v), persist()))),
      h('label', { class: 'lbl' }, 'نمط الصور', select(IMAGE_STYLES, f.imageStyle, (v) => ((f.imageStyle = v), persist()))),
      f.mode === 'generate' ? null : h('label', { class: 'lbl' }, 'التعامل مع المصدر', select(SOURCE_MODES, f.sourceMode, (v) => (f.sourceMode = v))),
      h('label', { class: 'lbl' }, 'الجمهور', h('input', { class: 'field', placeholder: 'مثلاً: رواد أعمال مبتدئون', maxlength: 200, value: f.audience, onInput: (e) => (f.audience = e.target.value) })),
      h('label', { class: 'lbl', style: { gridColumn: '1 / -1' } }, 'تعليمات إضافية للكتابة', h('input', { class: 'field', placeholder: 'مثلاً: أضف أمثلة من الخليج، واختم بسؤال للنقاش', maxlength: LIMITS.instruction, value: f.instructions, onInput: (e) => (f.instructions = e.target.value) })),
    );
  }

  const costNote = h(
    'span',
    { class: 'tiny' },
    config.plan.unlimited
      ? 'القوالب والتحرير والتصدير مجانية لأعضاء الكونت. '
      : `الخطة ${config.plan.name}: ${config.plan.remaining} من ${config.plan.points} نقطة. عرض من 10 شرائح بالصور ≈ ${deckEstimate(10)} نقطة. `,
    h('button', { type: 'button', class: 'linkish', onClick: () => openPlans() }, 'معلومات الخطة'),
  );
  const go = button('أنشئ المخطط', { kind: 'primary', size: 'lg', icon: 'sparkles', onClick: () => submit() });

  function submit() {
    const settings = { format: f.format, lang: f.lang, density: f.density, tone: f.tone, audience: f.audience.trim(), imageStyle: f.imageStyle };
    const req = { mode: f.mode, settings, imageSource: f.imageSource, cardCount: f.cardCount, sourceMode: f.sourceMode, instructions: f.instructions.trim(), prompt: f.prompt.trim() };
    if (f.mode === 'generate') {
      if (req.prompt.length < 3) return toast('اكتب فكرة العرض أولاً', 'error');
    } else if (f.mode === 'text') {
      if (f.text.trim().length < 40) return toast('الصق نصاً أطول قليلاً', 'error');
      req.text = f.text.trim();
    } else if (f.mode === 'url') {
      if (!/^https?:\/\/\S+\.\S+/.test(f.url)) return toast('أدخل رابطاً صحيحاً يبدأ بـ https://', 'error');
      req.url = f.url;
    } else {
      if (!f.file) return toast('اختر ملفاً أولاً', 'error');
      if (f.file.kind === 'pdf') req.file = { type: 'pdf', data: f.file.data };
      else if (f.file.kind === 'images' || f.file.kind === 'pages') req.file = { type: f.file.kind, images: f.file.images };
      else req.text = f.file.text;
      req.sourceTitle = f.file.name;
    }
    if (!canAfford('outline', f.cardCount === 'auto' ? 8 : f.cardCount)) {
      toast('نقاطك لا تكفي لهذه العملية.', 'error');
      return openPlans();
    }
    state.request = req;
    state.outline = null;
    state.navigate('/outline');
  }

  const create = h(
    'section',
    { class: 'create', 'aria-label': 'إنشاء جديد' },
    h('div', { class: 'create-tabs' }, tabs),
    formats,
    inputArea,
    opts,
    h('details', { class: 'adv' }, h('summary', {}, icon('settings', 16), 'خيارات متقدمة'), adv),
    h('div', { class: 'create-foot' }, costNote, go),
    examples,
  );

  renderTabs();
  renderFormats();
  renderInput();
  renderOpts();

  const page = h(
    'main',
    { class: 'home', id: 'main' },
    h(
      'div',
      { class: 'hero' },
      orbitArt(),
      h('h1', {}, config.demo ? 'أفكارك في عرض ' : 'من فكرة إلى عرض مصمَّم ', h('span', { class: 'grad' }, config.demo ? 'بتصميمك' : 'خلال دقيقة')),
      h('p', {}, config.demo ? 'الصق نصك أو اختر موضوعًا لقالب قابل للتحرير. رتّب البطاقات وعدّل العناوين والنصوص والألوان، ثم صدّر عرضك أو مستندك أو منشوراتك.' : 'اكتب فكرتك أو الصق نصك أو ارفع ملفك، ويكتب لك مدار المحتوى ويصمّمه: عروض تقديمية ومستندات وصفحات ويب ومنشورات سوشيال، بالعربية وبلغات أخرى.'),
    ),
    config.aiPaused
      ? h('div', { class: 'demo-note', role: 'note' }, icon('clock', 20), h('span', {}, 'وصل الذكاء الاصطناعي المجاني إلى حده اليومي، ويعود تلقائياً الساعة 3 فجراً بتوقيت الكويت. يمكنك الآن تصفح عروضك وتعديلها يدوياً وعرضها وتصديرها.'))
      : null,
    config.demo
      ? h('div', { class: 'demo-note', role: 'note' }, icon('triangle-alert', 20), h('span', {}, 'وضع القوالب المجاني: رتّب نصك وعدّل البطاقات بنفسك. التوليد بالذكاء الاصطناعي غير مفعّل حاليًا. القوالب لا تنشئ معلومات أو أرقامًا عن موضوعك.'))
      : null,
    create,
    library(),
    features(),
    h(
      'footer',
      { class: 'site-foot' },
      h('span', {}, `${BRAND.name} ${BRAND.by}`),
      h('a', { href: BRAND.siteUrl, target: '_blank', rel: 'noopener' }, `تعلّم الذكاء الاصطناعي مع ${BRAND.siteLabel}`),
    ),
  );

  root.replaceChildren(topbar, page);
  document.title = 'مدار | استوديو العروض من الكونت';
  return () => topbar.querySelector('.credits')?._dispose?.();
}

function orbitArt() {
  const wrap = h('div', { class: 'orbit-art', 'aria-hidden': 'true' });
  wrap.append(logoElement({ size: 168, tile: false, animate: true }));
  return wrap;
}

function library() {
  const decks = listDecks();
  const sec = h('section', { 'aria-label': 'عروضي' });
  if (!decks.length) return sec;
  const grid = h('div', { class: 'lib' });
  const draw = () => {
    const list = listDecks();
    grid.replaceChildren(
      ...list.map((d) => {
        const full = loadDeck(d.id);
        const thumb = h('div', { class: 'lib-thumb' });
        if (full?.cards?.[0]) {
          const card = renderCard(full.cards[0], full, { index: 0, eager: true });
          thumb.append(scaled(card));
        }
        const open = () => state.navigate('/edit/' + d.id);
        return h(
          'article',
          { class: 'lib-card', tabindex: '0', onClick: open, onKeydown: (e) => e.key === 'Enter' && open() },
          thumb,
          h('div', { class: 'lib-meta' }, h('b', {}, d.title), h('span', { class: 'tiny' }, `${FORMATS[d.format]?.label || ''} · ${d.cards} بطاقة · ${formatDate(d.updatedAt)}`)),
          h(
            'div',
            { class: 'lib-actions' },
            button('', {
              icon: 'copy', size: 'sm', cls: 'btn-icon', title: 'نسخة مكررة',
              onClick: (e) => {
                e.stopPropagation();
                if (!full) return;
                const copy = { ...JSON.parse(JSON.stringify(full)), id: uid(), title: full.title + ' (نسخة)', share: null, createdAt: Date.now() };
                saveDeck(copy);
                draw();
              },
            }),
            button('', {
              icon: 'trash-2', size: 'sm', cls: 'btn-icon btn-danger', title: 'حذف من هذا الجهاز',
              onClick: (e) => {
                e.stopPropagation();
                if (!confirm(`حذف «${d.title}» من هذا الجهاز؟ لا يمكن التراجع.`)) return;
                deleteDeck(d.id);
                draw();
                if (!listDecks().length) sec.replaceChildren();
              },
            }),
          ),
        );
      }),
    );
  };
  draw();
  sec.append(h('div', { class: 'section-head' }, h('h2', {}, 'عروضي'), h('span', { class: 'tiny' }, 'محفوظة في هذا المتصفح')), grid);
  return sec;
}

function features() {
  const list = [
    ['sparkles', 'خطّط وصمّم', 'راجع المخطط ثم عدّل بطاقاتك: نقاط وأعمدة وأرقام وخطوط زمنية ومقارنات.'],
    ['palette', 'ثيمات بهوية عربية', 'أحد عشر ثيماً بخطوط عربية أنيقة، أو ثيم بهويتك: لونك وخطك وشعارك.'],
    ['pencil', 'حرّر محتواك', 'عدّل النصوص مباشرة داخل البطاقات، وأضف بطاقات جديدة ورتّبها بما يناسب فكرتك.'],
    ['image', 'صورك داخل العرض', 'ارفع صورك وأضفها إلى البطاقات، واضبط حجمها وموضعها لتناسب المحتوى.'],
    ['presentation', 'اعرض من المتصفح', 'وضع عرض بملء الشاشة مع ملاحظات المتحدث وتنقل بلوحة المفاتيح أو اللمس.'],
    ['share-2', 'شارك وصدّر', 'رابط مشاركة وكود تضمين، وتصدير إلى PDF وPowerPoint وصورة PNG.'],
  ];
  return h(
    'section',
    { 'aria-label': 'المزايا' },
    h('div', { class: 'section-head' }, h('h2', {}, 'كل ما تحتاجه لعرض مقنع')),
    h('div', { class: 'features' }, list.map(([ic, t, d]) => h('div', { class: 'feature' }, icon(ic, 28), h('h3', {}, t), h('p', {}, d)))),
  );
}

// ---------- reading source files in the browser ----------

async function readSourceFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.size > LIMITS.pdfBytes) throw new Error('الملف أكبر من 8 ميغابايت.');
  if (ext === 'pdf') {
    // Clean text is read here for free; scanned or broken-text PDFs become page images. Every engine
    // (Claude, ChatGPT, the free models) can then use the result, so a fallback never meets a raw PDF.
    return readPdfFree(file);
  }
  if (ext === 'txt' || ext === 'md') {
    return { kind: 'text', name: file.name, text: checkText(await file.text()) };
  }
  if (ext === 'docx') {
    await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
    const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { kind: 'text', name: file.name, text: checkText(res.value) };
  }
  if (ext === 'pptx') {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const slides = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const parts = [];
    for (const [i, n] of slides.entries()) {
      const xml = await zip.file(n).async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const paras = [...doc.getElementsByTagNameNS('*', 'p')].map((p) => [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('')).filter((t) => t.trim());
      if (paras.length) parts.push(`--- شريحة ${i + 1} ---\n${paras.join('\n')}`);
    }
    return { kind: 'text', name: file.name, text: checkText(parts.join('\n\n')) };
  }
  throw new Error('نوع الملف غير مدعوم. استخدم PDF أو Word أو PowerPoint أو ملف نصي.');
}

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38';

// Renders PDF pages to JPEG in the browser with pdf.js, so a vision model can read them.
async function openPdf(file) {
  const pdfjs = await import(`${PDFJS}/build/pdf.min.mjs`);
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    const boot = URL.createObjectURL(new Blob([`import "${PDFJS}/build/pdf.worker.min.mjs";`], { type: 'text/javascript' }));
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(boot, { type: 'module' });
  }
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: `${PDFJS}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    }).promise;
  } catch {
    throw new Error('تعذّر فتح ملف PDF. تأكد أنه غير محمي بكلمة مرور.');
  }
}

// The text layer of a PDF, in reading order. pdf.js hands Arabic lines over word by word in visual
// (left-to-right) order, so right-to-left lines are flipped back.
async function pdfText(doc, maxPages = 60) {
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    const lines = [];
    let line = [];
    let y = null;
    for (const it of items) {
      const iy = Math.round(it.transform[5]);
      if (y !== null && Math.abs(iy - y) > 3) {
        lines.push(line);
        line = [];
      }
      line.push(it);
      y = iy;
    }
    if (line.length) lines.push(line);
    pages.push(
      lines
        .map((l) => {
          const words = l.filter((it) => it.str.trim());
          const rtl = words.filter((it) => it.dir === 'rtl').length > words.length / 2;
          return (rtl ? [...l].reverse() : l).map((it) => it.str).join('').replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean)
        .join('\n'),
    );
  }
  return pages.join('\n\n').normalize('NFKC');
}

// Is the extracted text good enough to use as is? Scanned PDFs have (almost) none, and some Arabic fonts
// come out with swapped letters (e.g. "املدير" for "المدير"): those are read as images instead.
function usableText(text, pages) {
  const letters = text.replace(/\s/g, '').length;
  if (letters < 60 * Math.min(pages, 3)) return false;
  const words = text.match(/[ء-ي]+/g) || [];
  if (words.length < 20) return true;
  const broken = (text.match(/(?:^|[^؀-ۿ])ا(?!ل)[ء-ي]ل[ء-ي]/g) || []).length;
  return broken / words.length < 0.04;
}

// Free engine: use the PDF's own text when it is clean (costs no AI), otherwise send page images for the vision model.
async function readPdfFree(file) {
  const doc = await openPdf(file);
  try {
    const text = await pdfText(doc);
    if (usableText(text, doc.numPages)) {
      if (text.length > LIMITS.text) toast('الملف طويل، فاستخدمنا الجزء الأول منه.', 'info', 5000);
      await doc.destroy();
      return { kind: 'text', name: file.name, text: text.slice(0, LIMITS.text) };
    }
  } catch {
    /* fall back to reading the pages as images */
  }
  return renderPdfPages(doc, file.name);
}

async function renderPdfPages(doc, name) {
  const n = Math.min(doc.numPages, LIMITS.pdfPages);
  if (doc.numPages > n) toast(`الملف ${doc.numPages} صفحة، وسنقرأ أول ${n} صفحة.`, 'info', 5000);
  const images = [];
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.2, 1400 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push({ media_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] });
  }
  await doc.destroy();
  return { kind: 'pages', name, images };
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
function isImageFile(file) {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

// Shrinks a photo in the browser (max 1600px, JPEG) so it uploads fast and stays readable.
async function readImageFile(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`تعذّر فتح الصورة «${file.name}». استخدم JPG أو PNG.`);
  }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  if (data.length > LIMITS.imageChars) throw new Error(`الصورة «${file.name}» كبيرة جداً.`);
  return { media_type: 'image/jpeg', data };
}

function checkText(t) {
  t = (t || '').trim();
  if (t.length < 40) throw new Error('لم نجد نصاً كافياً في الملف.');
  if (t.length > LIMITS.text) throw new Error(`النص أطول من ${LIMITS.text.toLocaleString('ar')} حرف. اختصره أو قسّمه إلى أكثر من ملف.`);
  return t;
}
