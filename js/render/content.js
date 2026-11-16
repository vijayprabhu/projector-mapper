/* Content builders: what goes inside a layer's box, before it is warped.
 * Shared by the editor and the output window (and shapeSVG by the exporter).
 */
(function (PM) {
  'use strict';

  const { esc } = PM.util;
  const { media } = PM.store;

  function shapeSVG(L) {
    const { w, h } = L;
    const sw = Math.max(0, +L.strokeWidth || 0);
    const i = sw / 2;
    const fill = L.fillOn === false ? 'none' : L.fill;
    const attrs = `fill="${esc(fill)}" stroke="${esc(L.stroke)}" stroke-width="${sw}" stroke-linejoin="round"`;
    let body;
    const poly = (pts) => `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" ${attrs}/>`;
    const regular = (n, inner, rot) => {
      const pts = [];
      const steps = inner ? n * 2 : n;
      for (let k = 0; k < steps; k++) {
        const a = rot + (k * Math.PI * 2) / steps;
        const r = inner && k % 2 ? inner : 1;
        pts.push([w / 2 + Math.cos(a) * r * (w / 2 - i), h / 2 + Math.sin(a) * r * (h / 2 - i)]);
      }
      return pts;
    };
    switch (L.shape) {
      case 'ellipse': body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - i)}" ry="${Math.max(0, h / 2 - i)}" ${attrs}/>`; break;
      case 'triangle': body = poly([[w / 2, i], [w - i, h - i], [i, h - i]]); break;
      case 'star': body = poly(regular(5, 0.45, -Math.PI / 2)); break;
      case 'hexagon': body = poly(regular(6, 0, 0)); break;
      default: {
        const r = Math.min(+L.radius || 0, w / 2, h / 2);
        body = `<rect x="${i}" y="${i}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="${r}" ry="${r}" ${attrs}/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
  }

  /** Changes when the content element must be rebuilt (not for geometry or effects). */
  function contentKey(L) {
    switch (L.type) {
      case 'shape': return ['s', L.shape, L.fill, L.fillOn, L.stroke, L.strokeWidth, L.radius, L.w, L.h].join('|');
      case 'text': return ['t', L.text, L.color, L.fontSize, L.fontFamily, L.bold].join('|');
      default: return [L.type, L.mediaId, media.has(L.mediaId)].join('|');
    }
  }

  /** Fill `el` (a .layer element in document `doc`) with the layer's content. */
  function buildContent(el, L, doc) {
    el.innerHTML = '';
    if (L.type === 'shape') {
      el.innerHTML = shapeSVG(L);
    } else if (L.type === 'text') {
      const d = doc.createElement('div');
      d.className = 'text';
      d.textContent = L.text;
      Object.assign(d.style, {
        color: L.color, fontSize: L.fontSize + 'px', fontFamily: L.fontFamily, fontWeight: L.bold ? '700' : '400',
      });
      el.appendChild(d);
    } else {
      const m = media.get(L.mediaId);
      if (!m) {
        el.innerHTML = `<svg viewBox="0 0 ${L.w} ${L.h}" preserveAspectRatio="none"><rect width="100%" height="100%" fill="#400"/><text x="50%" y="50%" fill="#fff" font-size="${Math.max(12, L.h / 10)}" text-anchor="middle" dominant-baseline="middle">missing media</text></svg>`;
        return;
      }
      if (L.type === 'video') {
        const v = doc.createElement('video');
        Object.assign(v, { src: m.url, autoplay: true, loop: true, muted: true, playsInline: true });
        v.setAttribute('muted', '');
        el.appendChild(v);
        v.play().catch(() => {});
      } else {
        const img = doc.createElement('img');
        img.src = m.url;
        img.draggable = false;
        img.alt = '';
        el.appendChild(img);
      }
    }
  }

  /** Alignment test pattern: grid, diagonals, centre circle, border and resolution label. */
  function gridSVG(W, H) {
    const step = 100;
    let lines = '';
    for (let x = step; x < W; x += step) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke-opacity="${x % 500 ? 0.35 : 0.8}"/>`;
    for (let y = step; y < H; y += step) lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke-opacity="${y % 500 ? 0.35 : 0.8}"/>`;
    const r = Math.min(W, H) / 2 - 4;
    return `<svg class="grid-overlay" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#fff" stroke-width="1">${lines}
        <line x1="0" y1="0" x2="${W}" y2="${H}" stroke="#0ff" stroke-opacity=".6"/>
        <line x1="${W}" y1="0" x2="0" y2="${H}" stroke="#0ff" stroke-opacity=".6"/>
        <circle cx="${W / 2}" cy="${H / 2}" r="${r}" fill="none" stroke="#0ff" stroke-opacity=".6"/>
        <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#f0f" stroke-width="3"/>
      </g>
      <text x="${W / 2}" y="${H / 2}" fill="#fff" font-family="monospace" font-size="${Math.round(H / 30)}" text-anchor="middle" dominant-baseline="middle">${W} × ${H}</text>
    </svg>`;
  }

  PM.content = { shapeSVG, contentKey, buildContent, gridSVG };
})(window.PM);
