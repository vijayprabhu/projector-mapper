/* Geometry: quads, homographies and point helpers.
 *
 * Every layer has a base size (w × h) and four output-space corners
 * (TL, TR, BR, BL). It is drawn at its base size and mapped onto those corners
 * with a CSS matrix3d homography. Move, resize, rotate and corner-warp all edit
 * the corners, so every layer type supports perspective warping.
 */
(function (PM) {
  'use strict';

  const Geo = {
    centroid(c) {
      return [(c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4];
    },
    rotate(p, o, a) {
      const s = Math.sin(a), k = Math.cos(a), x = p[0] - o[0], y = p[1] - o[1];
      return [o[0] + x * k - y * s, o[1] + x * s + y * k];
    },
    dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); },
    mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; },
    bbox(c) {
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    },
    rect(cx, cy, w, h) {
      return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    },
    /** Coefficients [a,b,c,d,e,f,g,h] mapping the unit square onto quad q:
     *  X = (a·u + b·v + c) / (g·u + h·v + 1), Y = (d·u + e·v + f) / (g·u + h·v + 1). */
    coeffs(q) {
      const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
      const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
      const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
      let g = 0, hh = 0;
      if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
        const den = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(den) < 1e-12) return null;
        g = (sx * dy2 - dx2 * sy) / den;
        hh = (dx1 * sy - sx * dy1) / den;
      }
      const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
      const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
      return [a, b, c, d, e, f, g, hh];
    },
    /** Map point (u, v) of the unit square onto quad q. */
    map(q, u, v) {
      const k = Geo.coeffs(q);
      if (!k) return [q[0][0] + u * (q[1][0] - q[0][0]), q[0][1] + v * (q[3][1] - q[0][1])];
      const [a, b, c, d, e, f, g, h] = k;
      const z = g * u + h * v + 1;
      return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
    },
    /** CSS matrix3d that maps the rectangle (0,0)-(w,h) onto quad q [TL,TR,BR,BL]. */
    homography(w, h, q) {
      const k = Geo.coeffs(q);
      if (!k) return null;
      const [a, b, c, d, e, f, g, hh] = k;
      // Unit square → quad; pre-scale input by (1/w, 1/h). Column-major.
      const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
      return `matrix3d(${m.map((v) => +v.toFixed(10)).join(',')})`;
    },
  };

  PM.Geo = Geo;
})(window.PM);
