// Card themes. Each theme is a set of CSS variables consumed by cards.css.

const FONT_WEIGHTS = {
  Zain: '400;700;800',
  Cairo: '400;600;800',
  'El Messiri': '400;600;700',
  Amiri: '400;700',
  'IBM Plex Sans Arabic': '400;500;700',
  'Noto Kufi Arabic': '400;600;800',
  'Noto Naskh Arabic': '400;600;700',
  'Readex Pro': '400;500;700',
  Tajawal: '400;500;800',
  'Reem Kufi': '400;600;700',
  Alexandria: '400;500;700',
};

export const FONT_CHOICES = Object.keys(FONT_WEIGHTS);

export const THEMES = [
  {
    id: 'alkunt', name: 'الكونت', dark: true,
    bg: '#0A1226', bg2: '#101D3E', card: '#0E1832', text: '#F1ECE3', muted: '#A9B4CC',
    accent: '#2F7BFF', accent2: '#29D3FF', surface: 'rgba(41,211,255,.07)', border: 'rgba(169,180,204,.16)',
    heading: 'Zain', body: 'Zain', hw: 800,
    deco: 'radial-gradient(60% 80% at 100% 0%, rgba(47,123,255,.28), transparent 60%), radial-gradient(50% 60% at 0% 100%, rgba(41,211,255,.14), transparent 60%)',
  },
  {
    id: 'raml', name: 'رمل', dark: false,
    bg: '#EFE6D8', bg2: '#F6EFE4', card: '#FBF7F0', text: '#2B2118', muted: '#6E5E4E',
    accent: '#C4572E', accent2: '#E0A458', surface: '#F3E9DA', border: '#E5D6C1',
    heading: 'El Messiri', body: 'Cairo', hw: 700,
    deco: 'radial-gradient(70% 70% at 100% 100%, rgba(224,164,88,.22), transparent 60%)',
  },
  {
    id: 'najd', name: 'نجد', dark: true,
    bg: '#120F0C', bg2: '#1B1611', card: '#1A1511', text: '#F3E9D7', muted: '#BFAE92',
    accent: '#D4A84B', accent2: '#F0D58C', surface: 'rgba(212,168,75,.08)', border: 'rgba(212,168,75,.22)',
    heading: 'Amiri', body: 'IBM Plex Sans Arabic', hw: 700,
    deco: 'radial-gradient(55% 70% at 0% 0%, rgba(212,168,75,.16), transparent 60%)',
  },
  {
    id: 'waha', name: 'واحة', dark: false,
    bg: '#E4F3ED', bg2: '#F2FAF7', card: '#FFFFFF', text: '#0F2A24', muted: '#4F6B63',
    accent: '#0E9F7E', accent2: '#2FB8D1', surface: '#EAF6F1', border: '#D2E8E0',
    heading: 'IBM Plex Sans Arabic', body: 'IBM Plex Sans Arabic', hw: 700,
    deco: 'radial-gradient(60% 60% at 100% 0%, rgba(14,159,126,.12), transparent 60%)',
  },
  {
    id: 'hibr', name: 'حبر', dark: false,
    bg: '#ECECE7', bg2: '#F5F5F1', card: '#FFFFFF', text: '#111111', muted: '#555555',
    accent: '#111111', accent2: '#E4402F', surface: '#F2F2EE', border: '#E0E0DA',
    heading: 'Noto Kufi Arabic', body: 'Noto Naskh Arabic', hw: 800,
    deco: 'none',
  },
  {
    id: 'murjan', name: 'مرجان', dark: false,
    bg: '#FFE3DC', bg2: '#FFD6E6', card: '#FFFFFF', text: '#2A1020', muted: '#7A4E62',
    accent: '#F2545B', accent2: '#FF9F43', surface: '#FFF0EC', border: '#F6D2D7',
    heading: 'Readex Pro', body: 'Readex Pro', hw: 700,
    deco: 'radial-gradient(60% 70% at 0% 0%, rgba(255,159,67,.16), transparent 60%), radial-gradient(50% 60% at 100% 100%, rgba(242,84,91,.12), transparent 60%)',
  },
  {
    id: 'fajr', name: 'فجر', dark: false,
    bg: '#FBE4D3', bg2: '#E3DEFA', card: 'rgba(255,255,255,.82)', text: '#2A2340', muted: '#6C6488',
    accent: '#6E4FF0', accent2: '#F27A54', surface: 'rgba(110,79,240,.07)', border: 'rgba(110,79,240,.16)',
    heading: 'Tajawal', body: 'Tajawal', hw: 800,
    deco: 'linear-gradient(135deg, rgba(242,122,84,.10), rgba(110,79,240,.10))',
  },
  {
    id: 'zumurrud', name: 'زمرّد', dark: true,
    bg: '#082119', bg2: '#0D3026', card: '#0D2E25', text: '#F2EBDD', muted: '#B2C5BA',
    accent: '#E2B65C', accent2: '#5CC99B', surface: 'rgba(226,182,92,.08)', border: 'rgba(242,235,221,.14)',
    heading: 'Reem Kufi', body: 'IBM Plex Sans Arabic', hw: 700,
    deco: 'radial-gradient(60% 80% at 100% 100%, rgba(92,201,155,.14), transparent 60%)',
  },
  {
    id: 'ufuq', name: 'أفق', dark: false,
    bg: '#E8EEF8', bg2: '#F3F6FC', card: '#FFFFFF', text: '#0F1E3A', muted: '#52617D',
    accent: '#1F5EFF', accent2: '#00A6C8', surface: '#F1F5FC', border: '#DCE4F2',
    heading: 'Cairo', body: 'Cairo', hw: 800,
    deco: 'linear-gradient(180deg, rgba(31,94,255,.06), transparent 40%)',
  },
  {
    id: 'neon', name: 'نيون', dark: true,
    bg: '#05060A', bg2: '#0B0E16', card: '#0B0D14', text: '#EDF2F7', muted: '#8B96A8',
    accent: '#B6FF3B', accent2: '#3BE1FF', surface: 'rgba(182,255,59,.06)', border: 'rgba(255,255,255,.10)',
    heading: 'Readex Pro', body: 'Readex Pro', hw: 700,
    deco: 'radial-gradient(50% 60% at 100% 0%, rgba(59,225,255,.14), transparent 60%), radial-gradient(40% 50% at 0% 100%, rgba(182,255,59,.10), transparent 60%)',
  },
  {
    id: 'lailak', name: 'ليلك', dark: true,
    bg: '#140D27', bg2: '#1E1440', card: '#1B1235', text: '#F4EEFF', muted: '#B7A9D9',
    accent: '#A879FF', accent2: '#FF79C6', surface: 'rgba(168,121,255,.09)', border: 'rgba(183,169,217,.18)',
    heading: 'Alexandria', body: 'Alexandria', hw: 700,
    deco: 'radial-gradient(60% 70% at 0% 0%, rgba(255,121,198,.14), transparent 60%), radial-gradient(60% 70% at 100% 100%, rgba(168,121,255,.18), transparent 60%)',
  },
];

// ---------- custom brand theme ----------

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [47, 123, 255];
}
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(',')},${a})`;
function mix(hex, target, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function customTheme(c = {}) {
  const accent = c.accent || '#2F7BFF';
  const accent2 = c.accent2 || mix(accent, '#ffffff', 0.35);
  const font = FONT_CHOICES.includes(c.font) ? c.font : 'Zain';
  const dark = c.dark !== false;
  return dark
    ? {
        id: 'custom', name: 'هويتي', dark: true,
        bg: mix(accent, '#05070d', 0.88), bg2: mix(accent, '#05070d', 0.8), card: mix(accent, '#07090f', 0.86),
        text: '#F3F1EC', muted: '#A9B0C0', accent, accent2,
        surface: rgba(accent, 0.09), border: 'rgba(255,255,255,.12)', heading: font, body: font, hw: 800,
        deco: `radial-gradient(60% 80% at 100% 0%, ${rgba(accent, 0.26)}, transparent 60%)`, logo: c.logo || '',
      }
    : {
        id: 'custom', name: 'هويتي', dark: false,
        bg: mix(accent, '#ffffff', 0.86), bg2: mix(accent, '#ffffff', 0.93), card: '#FFFFFF',
        text: '#16181D', muted: '#5B6270', accent, accent2,
        surface: mix(accent, '#ffffff', 0.93), border: mix(accent, '#ffffff', 0.82), heading: font, body: font, hw: 800,
        deco: `radial-gradient(60% 80% at 100% 0%, ${rgba(accent, 0.1)}, transparent 60%)`, logo: c.logo || '',
      };
}

export function getTheme(deck) {
  if (deck?.theme === 'custom') return customTheme(deck.customTheme);
  return THEMES.find((t) => t.id === deck?.theme) || THEMES[0];
}

// ---------- applying ----------

const loaded = new Set(['Zain']);
export function loadFonts(theme) {
  const fams = [theme.heading, theme.body].filter((f) => f && !loaded.has(f) && FONT_WEIGHTS[f]);
  if (!fams.length) return;
  fams.forEach((f) => loaded.add(f));
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${FONT_WEIGHTS[f]}`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.crossOrigin = 'anonymous'; // lets PNG export read and embed the fonts
  link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
  document.head.append(link);
}

export function loadAllFonts() {
  THEMES.forEach(loadFonts);
}

export function themeStyle(theme) {
  loadFonts(theme);
  return {
    '--t-bg': theme.bg,
    '--t-bg2': theme.bg2,
    '--t-card': theme.card,
    '--t-text': theme.text,
    '--t-muted': theme.muted,
    '--t-accent': theme.accent,
    '--t-accent2': theme.accent2,
    '--t-surface': theme.surface,
    '--t-border': theme.border,
    '--t-heading': `'${theme.heading}', 'Zain', system-ui, sans-serif`,
    '--t-body': `'${theme.body}', 'Zain', system-ui, sans-serif`,
    '--t-hw': String(theme.hw || 700),
    '--t-deco': theme.deco || 'none',
    '--t-overlay': theme.dark ? 'rgba(5,8,16,.62)' : 'rgba(255,255,255,.70)',
    '--t-on-accent': readableOn(theme.accent),
  };
}

export function applyTheme(el, theme) {
  const vars = themeStyle(theme);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.classList.toggle('t-dark', !!theme.dark);
  el.classList.toggle('t-light', !theme.dark);
}

function readableOn(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#111111' : '#FFFFFF';
}
