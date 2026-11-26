// The Madar mark: a glossy 3D orb with an orbit ring that passes behind and in front of it,
// and a satellite riding the ring. One drawing serves the app icon, the top bar and the hero.

let seq = 0;

// Ring geometry, in the ring's own (rotated) coordinates centred on the orb.
const RX = 25;
const RY = 8.5;
const TILT = -20;
const RING_PATH = `M${RX},0 A${RX},${RY} 0 1,1 -${RX},0 A${RX},${RY} 0 1,1 ${RX},0`;

/**
 * @param {object} o
 * @param {number} o.size     rendered size in px
 * @param {boolean} o.tile    draw the rounded app-icon tile behind the orb
 * @param {boolean} o.animate let the satellite travel around the orbit
 */
export function logoMarkup({ size = 34, tile = true, animate = false } = {}) {
  const id = `mdr${++seq}`;
  const u = (name) => `${id}-${name}`;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const moving = animate && !reduce;
  // The orb sits a little low on the tile so the tilted ring reads as perspective.
  const cx = 32;
  const cy = tile ? 33 : 32;

  const satellite = (clip) =>
    moving
      ? `<g clip-path="url(#${u(clip)})"><g><circle r="5.2" fill="#29D3FF" opacity=".35" filter="url(#${u('soft')})"/><circle r="3.3" fill="url(#${u('moon')})"/>` +
        `<animateMotion dur="7s" repeatCount="indefinite" path="${RING_PATH}" rotate="0"/></g></g>`
      : clip === 'front'
        ? `<circle cx="21.6" cy="4.3" r="5.2" fill="#29D3FF" opacity=".4" filter="url(#${u('soft')})"/><circle cx="21.6" cy="4.3" r="3.3" fill="url(#${u('moon')})"/>`
        : '';

  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="مدار" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="${u('tile')}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#16295C"/><stop offset="1" stop-color="#070E22"/></linearGradient>
  <radialGradient id="${u('tileGlow')}" cx=".5" cy=".52" r=".5"><stop offset="0" stop-color="#2F7BFF" stop-opacity=".42"/><stop offset="1" stop-color="#2F7BFF" stop-opacity="0"/></radialGradient>
  <linearGradient id="${u('bevel')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".1"/><stop offset=".35" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  <radialGradient id="${u('orb')}" cx=".36" cy=".3" r=".78">
    <stop offset="0" stop-color="#F2FDFF"/><stop offset=".16" stop-color="#8AE8FF"/><stop offset=".46" stop-color="#2F9BFF"/>
    <stop offset=".8" stop-color="#1C4BD6"/><stop offset="1" stop-color="#0B2470"/>
  </radialGradient>
  <radialGradient id="${u('rim')}" cx=".5" cy=".5" r=".5"><stop offset=".78" stop-color="#29D3FF" stop-opacity="0"/><stop offset="1" stop-color="#29D3FF" stop-opacity=".6"/></radialGradient>
  <radialGradient id="${u('shade')}" cx=".7" cy=".78" r=".6"><stop offset="0" stop-color="#050B1E" stop-opacity=".55"/><stop offset="1" stop-color="#050B1E" stop-opacity="0"/></radialGradient>
  <linearGradient id="${u('ring')}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#29D3FF" stop-opacity=".35"/><stop offset=".55" stop-color="#FFFFFF"/><stop offset="1" stop-color="#7FE3FF" stop-opacity=".55"/>
  </linearGradient>
  <radialGradient id="${u('moon')}" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#A6EEFF"/><stop offset="1" stop-color="#1FA6E0"/></radialGradient>
  <filter id="${u('soft')}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="1.4"/></filter>
  <filter id="${u('glow')}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="2.6"/></filter>
  <clipPath id="${u('back')}"><rect x="-40" y="-40" width="80" height="40"/></clipPath>
  <clipPath id="${u('front')}"><rect x="-40" y="0" width="80" height="40"/></clipPath>
</defs>
${tile ? `<rect width="64" height="64" rx="15" fill="url(#${u('tile')})"/><circle cx="${cx}" cy="${cy}" r="30" fill="url(#${u('tileGlow')})"/><rect x=".6" y=".6" width="62.8" height="62.8" rx="14.4" fill="url(#${u('bevel')})" stroke="#7FB4FF" stroke-opacity=".18" stroke-width="1.2"/>` : ''}
${tile ? '' : `<ellipse cx="${cx}" cy="${cy + 21}" rx="13" ry="2.4" fill="#000" opacity=".35" filter="url(#${u('soft')})"/>`}
<g transform="translate(${cx} ${cy}) rotate(${TILT})">
  <ellipse rx="${RX}" ry="${RY}" fill="none" stroke="url(#${u('ring')})" stroke-width="2.2" stroke-opacity=".5" clip-path="url(#${u('back')})"/>
  ${satellite('back')}
</g>
<circle cx="${cx}" cy="${cy}" r="15" fill="#2F7BFF" opacity=".45" filter="url(#${u('glow')})"/>
<circle cx="${cx}" cy="${cy}" r="13" fill="url(#${u('orb')})"/>
<circle cx="${cx}" cy="${cy}" r="13" fill="url(#${u('shade')})"/>
<circle cx="${cx}" cy="${cy}" r="13" fill="url(#${u('rim')})"/>
<ellipse cx="${cx - 4.6}" cy="${cy - 5.8}" rx="5.2" ry="3" fill="#FFFFFF" opacity=".6" transform="rotate(-32 ${cx - 4.6} ${cy - 5.8})"/>
<g transform="translate(${cx} ${cy}) rotate(${TILT})">
  <ellipse rx="${RX}" ry="${RY}" fill="none" stroke="url(#${u('ring')})" stroke-width="2.6" stroke-linecap="round" clip-path="url(#${u('front')})"/>
  ${satellite('front')}
</g>
</svg>`;
}

export function logoElement(opts) {
  const tpl = document.createElement('template');
  tpl.innerHTML = logoMarkup(opts).trim();
  const svg = tpl.content.firstElementChild;
  svg.classList.add('brand-mark');
  return svg;
}
