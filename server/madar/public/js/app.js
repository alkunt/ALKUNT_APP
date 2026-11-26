// Entry point: loads config, routes between screens.
import { loadConfig, config, checkSession } from './api.js';
import { state } from './state.js';
import { mountHome } from './home.js';
import { mountOutline } from './outline.js';
import { mountEditor } from './editor.js';
import { mountView } from './share.js';
import { refitAllWhenFontsLoad } from './render.js';
import { toast, closePopover, h } from './ui.js';
import { openPlans } from './plans.js';

const root = document.getElementById('app');
let dispose = null;

function navigate(path, { replace = false } = {}) {
  path = '/madar' + (path.startsWith('/') ? path : '/' + path);
  if (path !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
state.navigate = navigate;

function route() {
  closePopover();
  try {
    dispose?.();
  } catch (e) {
    console.error(e);
  }
  dispose = null;
  document.body.classList.remove('embed-body');
  window.scrollTo(0, 0);
  const p = location.pathname.replace(/^\/madar(?=\/|$)/, '') || '/';
  const params = new URLSearchParams(location.search);
  let m;
  if ((m = p.match(/^\/d\/([a-z0-9]{6,20})\/?$/))) dispose = mountView(root, m[1], { embed: params.get('embed') === '1' });
  else if ((m = p.match(/^\/edit\/([a-z0-9]+)\/?$/))) dispose = mountEditor(root, m[1]);
  else if (p === '/outline') dispose = mountOutline(root);
  else {
    if (p !== '/') history.replaceState({}, '', '/madar/');
    dispose = mountHome(root);
  }
}

window.addEventListener('popstate', route);

// Out of points or over a plan limit: show the plans (once at a time).
let plansOpen = null;
window.addEventListener('madar:upgrade', () => {
  if (plansOpen?.el?.isConnected) return;
  setTimeout(() => (plansOpen = openPlans()), 300);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (e.reason?.message) toast(e.reason.message, 'error');
});

refitAllWhenFontsLoad();
loadConfig().then(route).catch(error => { root.replaceChildren(h('main', { class: 'home' }, h('p', {role:'alert'}, error.message), h('a', {href:'/?view=madar',target:'_top'}, 'العودة إلى الكونت'))); });

setInterval(() => { if (document.visibilityState === 'visible') checkSession(); }, 60000);
window.addEventListener('pageshow', checkSession);
window.addEventListener('focus', checkSession);
