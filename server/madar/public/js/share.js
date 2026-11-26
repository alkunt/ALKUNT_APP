// A saved account-only copy. Knowing its link never grants another account access.
import { h, icon, button, toast, modal, copyText, uid } from './ui.js';
import { request } from './api.js';
import { state, BRAND } from './state.js';
import { brandLink } from './chrome.js';
import { renderCard, scaled, isFixed } from './render.js';
import { getTheme } from './themes.js';
import { saveDeck } from './store.js';
import { startPresent } from './present.js';

function publicCopy(deck) {
  const d = JSON.parse(JSON.stringify(deck));
  delete d.chat;
  delete d.share;
  for (const c of d.cards) if (c.image) delete c.image.loading;
  return d;
}

export function openShare(deck, { onChange } = {}) {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const m = modal('رابط خاص بحسابك', body, { width: 600 });

  function draw() {
    body.replaceChildren();
    if (!deck.share?.id) {
      body.append(
        h('p', { class: 'muted' }, 'احفظ نسخة خاصة لفتح العرض برابط من حسابك نفسه. العروض والصور لا تظهر لأي حساب آخر، حتى لو وصل إليه الرابط. لمشاركة ملف خارج حسابك، استخدم التصدير.'),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button('حفظ نسخة خاصة', { kind: 'primary', icon: 'lock', onClick: publish })),
      );
      return;
    }
    const link = `${location.origin}/madar/d/${deck.share.id}`;
    body.append(
      h('label', { class: 'lbl' }, 'الرابط الخاص', h('div', { class: 'copy-row' }, h('input', { class: 'field', readonly: true, value: link, onFocus: (e) => e.target.select() }), button('نسخ', { kind: 'soft', icon: 'copy', onClick: () => copyText(link) }))),
      h('p', { class: 'muted' }, 'هذا الرابط يفتح بحسابك فقط. لا يمنح أي مستخدم آخر صلاحية عرض أعمالك أو صورك.'),
      h('p', { class: 'tiny' }, deck.share.updatedAt && (deck.updatedAt || 0) - deck.share.updatedAt > 3000 ?'لديك تعديلات لم تُحفظ في هذه النسخة.' : 'النسخة الخاصة محدّثة.'),
      h(
        'div',
        { class: 'row', style: { justifyContent: 'space-between' } },
        button('حذف النسخة المحفوظة', { cls: 'btn-danger', icon: 'trash-2', onClick: unpublish }),
        h('div', { class: 'row' }, button('فتح', { kind: 'soft', icon: 'external-link', onClick: () => window.open(link, '_blank', 'noopener') }), button('تحديث النسخة الخاصة', { kind: 'primary', icon: 'refresh-cw', onClick: update })),
      ),
    );
  }

  async function publish() {
    try {
      const r = await request('POST', '/madar/api/decks', { deck: publicCopy(deck) });
      deck.share = { id: r.id, editKey: r.editKey, updatedAt: Date.now() };
      onChange?.();
      draw();
      toast('حُفظت نسخة خاصة بحسابك.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function update() {
    try {
      await request('PUT', `/madar/api/decks/${deck.share.id}`, { editKey: deck.share.editKey, deck: publicCopy(deck) });
      deck.share.updatedAt = Date.now();
      onChange?.();
      draw();
      toast('تم تحديث النسخة الخاصة.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function unpublish() {
    if (!confirm('حذف النسخة المحفوظة وتعطيل رابطها؟ تبقى مسودة العرض في هذا المتصفح.')) return;
    try {
      await request('DELETE', `/madar/api/decks/${deck.share.id}`, { editKey: deck.share.editKey });
      deck.share = null;
      onChange?.();
      draw();
      toast('حُذفت النسخة المحفوظة.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  draw();
  return m;
}

export function mountView(root, id, { embed = false } = {}) {
  root.replaceChildren(h('div', { style: { display: 'grid', placeItems: 'center', minHeight: '60vh' } }, h('span', { class: 'spinner' })));
  let presenter = null;
  const scalers = [];
  (async () => {
    let got;
    try {
      got = await request('GET', `/madar/api/decks/${id}?view=1`);
    } catch (e) {
      root.replaceChildren(
        h('header', { class: 'topbar' }, brandLink()),
        h('main', { class: 'home' }, h('div', { class: 'empty' }, h('p', {}, e.message), h('div', { style: { marginTop: '14px' } }, button('أنشئ عرضك مع مدار', { kind: 'primary', icon: 'sparkles', onClick: () => state.navigate('/') })))),
      );
      return;
    }
    const deck = got.deck;
    document.title = `${deck.title} | مدار`;
    if (embed) {
      document.body.classList.add('embed-body');
      const box = h('div', { class: 'embed-view' });
      root.replaceChildren(box);
      presenter = startPresent(deck, 0, { inline: box });
      return;
    }
    const theme = getTheme(deck);
    const cardsEl = h('div', { class: `cards f-${deck.format}` });
    deck.cards.forEach((c, i) => {
      const sc = scaled(renderCard(c, deck, { index: i }));
      scalers.push(sc);
      cardsEl.append(h('section', { class: 'cslot', 'aria-label': `بطاقة ${i + 1}` }, sc));
    });
    const canvas = h(
      'main',
      { class: `canvas ${theme.dark ? '' : 'light'}`, id: 'main', style: { '--deck-bg': theme.bg } },
      cardsEl,
      h('div', { class: 'made-with' }, h('a', { href: '/', onClick: (e) => (e.preventDefault(), state.navigate('/')) }, icon('sparkles', 18), `صُنع باستخدام ${BRAND.name}. أنشئ عرضك مجاناً`)),
    );
    canvas.style.setProperty('--deck-bg', theme.bg);
    const remix = () => {
      const copy = { ...JSON.parse(JSON.stringify(deck)), id: uid(), share: null, chat: [], createdAt: Date.now() };
      saveDeck(copy);
      state.navigate('/edit/' + copy.id);
      toast('أُضيفت نسخة إلى عروضك. عدّلها كما تشاء.', 'ok');
    };
    root.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        brandLink({ short: true }),
        h('b', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, deck.title),
        h('div', { class: 'spacer' }),
        button('انسخه وعدّله', { icon: 'copy', onClick: remix }),
        button('اعرض', { kind: 'primary', icon: 'play', onClick: () => startPresent(deck, 0) }),
      ),
      h('div', { class: 'view-page' }, canvas),
    );
    if (!isFixed(deck.format)) cardsEl.style.gap = deck.format === 'webpage' ? '0' : '';
  })();
  return () => {
    presenter?.close();
    scalers.forEach((s) => s._dispose());
    document.body.classList.remove('embed-body');
  };
}
