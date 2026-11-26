// Present mode: fullscreen, keyboard / click / swipe navigation, speaker notes.
import { h, button } from './ui.js';
import { renderCard, scaled, isFixed, deckDir } from './render.js';

export function startPresent(deck, start = 0, { inline = null } = {}) {
  let i = Math.max(0, Math.min(start, deck.cards.length - 1));
  const fixed = isFixed(deck.format);
  const rtl = deckDir(deck) === 'rtl';
  const stage = h('div', { class: 'stage' });
  const barFill = h('i');
  const counter = h('span');
  const notes = h('div', { class: 'notes', 'aria-live': 'polite' });
  const timer = h('span', { class: 'timer' }, '00:00');
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);

  const prevBtn = button('', { icon: rtl ? 'chevron-right' : 'chevron-left', cls: 'btn-icon', title: 'السابق', onClick: () => go(-1) });
  const nextBtn = button('', { icon: rtl ? 'chevron-left' : 'chevron-right', cls: 'btn-icon', title: 'التالي', onClick: () => go(1) });
  const ctl = h(
    'div',
    { class: 'pctl' },
    prevBtn,
    counter,
    nextBtn,
    button('', { icon: 'sticky-note', cls: 'btn-icon', title: 'ملاحظات المتحدث (N)', onClick: () => wrap.classList.toggle('with-notes') }),
    inline ? null : button('', { icon: 'maximize', cls: 'btn-icon', title: 'ملء الشاشة (F)', onClick: () => toggleFs() }),
    inline ? null : button('', { icon: 'x', cls: 'btn-icon', title: 'خروج (Esc)', onClick: () => close() }),
  );
  // Click zones: the side the deck reads towards advances.
  const zoneBack = h('div', { class: 'zone', style: { [rtl ? 'right' : 'left']: 0 }, onClick: () => go(-1) });
  const zoneNext = h('div', { class: 'zone', style: { [rtl ? 'left' : 'right']: 0 }, onClick: () => go(1) });
  stage.append(zoneBack, zoneNext);

  const wrap = h('div', { class: `present ${fixed ? '' : 'flowfmt'}`, role: 'dialog', 'aria-label': 'وضع العرض', tabindex: '-1' }, stage, h('div', { class: 'bar' }, barFill), ctl, notes);
  if (inline) {
    wrap.style.position = 'absolute';
    inline.append(wrap);
  } else document.body.append(wrap);

  let current = null;
  function draw(dir = 0) {
    current?._dispose?.();
    stage.querySelector('.slide')?.remove();
    const card = renderCard(deck.cards[i], deck, { index: i, eager: true });
    const sc = fixed ? scaled(card, { fit: 'contain', maxH: () => stage.clientHeight }) : scaled(card);
    const slide = h('div', { class: `slide ${dir ? 'enter' : ''}` }, sc);
    if (!fixed) slide.style.maxWidth = Math.min(1100, card.style.width ? parseFloat(card.style.width) : 1100) + 'px';
    stage.prepend(slide);
    current = sc;
    if (!fixed) stage.scrollTop = 0;
    barFill.style.width = `${((i + 1) / deck.cards.length) * 100}%`;
    counter.textContent = `${i + 1} / ${deck.cards.length}`;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === deck.cards.length - 1;
    notes.replaceChildren(timer, h('b', {}, `ملاحظات البطاقة ${i + 1}: `), deck.cards[i].notes || 'لا توجد ملاحظات لهذه البطاقة.');
    // Preload the next card's image.
    const nxt = deck.cards[i + 1]?.image?.url;
    if (nxt) new Image().src = nxt;
  }
  function go(d) {
    const j = i + d;
    if (j < 0 || j >= deck.cards.length) return;
    i = j;
    draw(d);
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.requestFullscreen?.().catch(() => {});
  }
  const onKey = (e) => {
    const k = e.key;
    if (k === 'Escape' && !document.fullscreenElement && !inline) return close();
    if (k === ' ' || k === 'PageDown' || k === 'ArrowDown' || k === 'Enter') return e.preventDefault(), go(1);
    if (k === 'PageUp' || k === 'ArrowUp' || k === 'Backspace') return e.preventDefault(), go(-1);
    if (k === 'ArrowLeft') return e.preventDefault(), go(rtl ? 1 : -1);
    if (k === 'ArrowRight') return e.preventDefault(), go(rtl ? -1 : 1);
    if (k === 'Home') return (i = 0), draw(1);
    if (k === 'End') return (i = deck.cards.length - 1), draw(1);
    if (k === 'n' || k === 'N' || k === 'ن') return wrap.classList.toggle('with-notes');
    if ((k === 'f' || k === 'F') && !inline) return toggleFs();
  };
  const onResize = () => current?._update?.();
  let sx = null;
  wrap.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) < 50) return;
    go((dx < 0) === rtl ? -1 : 1);
  });
  let idle;
  const onMove = () => {
    wrap.classList.add('show-ctl');
    clearTimeout(idle);
    idle = setTimeout(() => wrap.classList.remove('show-ctl'), 2200);
  };
  wrap.addEventListener('pointermove', onMove);
  (inline ? wrap : document).addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  // Opening the notes panel shrinks the stage, so refit whenever it changes size.
  const ro = new ResizeObserver(onResize);
  ro.observe(stage);

  function close() {
    clearInterval(tick);
    ro.disconnect();
    current?._dispose?.();
    (inline ? wrap : document).removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (document.fullscreenElement) document.exitFullscreen?.();
    wrap.remove();
  }

  draw(0);
  if (!inline) {
    wrap.requestFullscreen?.().catch(() => {});
    document.addEventListener('fullscreenchange', () => setTimeout(onResize, 50));
  }
  wrap.focus();
  return { close };
}
