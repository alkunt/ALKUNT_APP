// Pieces of the top bar shared by every screen.
import { h, icon } from './ui.js';
import { state, brandMark, BRAND } from './state.js';
import { config, onCredits } from './api.js';
import { openPlans } from './plans.js';

export function brandLink({ short = false } = {}) {
  return h(
    'a',
    {
      class: 'brand',
      href: '/',
      onClick: (e) => {
        e.preventDefault();
        state.navigate('/');
      },
    },
    brandMark(34),
    h('span', {}, BRAND.name),
    short ? null : h('small', {}, BRAND.by),
  );
}

// Plan badge: "الخطة المجانية · 180 / 200". Opens the plans window.
export function creditsPill() {
  const name = h('span', { class: 'hide-sm' });
  const b = h('b');
  const draw = () => {
    const p = config.plan || {};
    if (config.demo) { name.textContent = 'القوالب ·'; b.textContent = 'مجاني'; } else if (p.unlimited) {
      name.textContent = 'المالك ·';
      b.textContent = 'بلا حدود';
    } else {
      name.textContent = `الخطة ${p.name || ''} ·`;
      b.textContent = `${p.remaining ?? 0} / ${p.points ?? 0}`;
    }
    pill.classList.toggle('paid', p.id !== 'free');
  };
  const pill = h('button', { type: 'button', class: 'credits plan-pill', title: 'نقاطك المتبقية. اضغط لعرض الخطط', onClick: () => openPlans() }, icon(config.plan?.id === 'free' ? 'zap' : 'crown', 16), name, b);
  draw();
  pill._dispose = onCredits(draw);
  return pill;
}

export function demoPill() {
  if (!config.demo) return null;
  return h('span', { class: 'credits demo-pill', title: 'قوالب محلية قابلة للتحرير. التوليد بالذكاء الاصطناعي غير مفعّل.' }, icon('info', 16), 'وضع القوالب');
}
