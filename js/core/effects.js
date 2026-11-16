/* Per-layer effects: Spin and Crop. Pure logic, no DOM.
 * The DOM preview (render/renderer.js) and the exporter (export/pipeline.js)
 * both read these, so the editor, output window and exports stay identical.
 */
(function (PM) {
  'use strict';

  const { Geo } = PM;

  // ----------------------------------------------------------------------
  // Spin: a layer's content can rotate continuously inside its mapped area.
  // The phase comes from the wall clock, so the editor and the output window
  // stay in step.
  // ----------------------------------------------------------------------
  const Spin = {
    rpm: (L) => Math.max(0, +L.spin || 0),
    period: (L) => 60 / Spin.rpm(L),
    /** Angle in radians at time `t` seconds (wall clock or elapsed). */
    angle(L, t) {
      const rpm = Spin.rpm(L);
      if (!rpm) return 0;
      const turns = ((t * rpm) / 60) % 1;
      return turns * Math.PI * 2 * (L.spinCcw ? -1 : 1);
    },
    /** CSS animation for the DOM preview (uses the `pm-spin` keyframes). */
    css(L) {
      if (!Spin.rpm(L)) return '';
      const p = Spin.period(L);
      const delay = -((Date.now() / 1000) % p);
      return `pm-spin ${p.toFixed(4)}s linear ${delay.toFixed(4)}s infinite ${L.spinCcw ? 'reverse' : 'normal'}`;
    },
  };

  // ----------------------------------------------------------------------
  // Crop: L.crop = { x, y, w, h } in 0–1 of the source picture, plus a shape
  // ('rect' | 'circle') and the mode the crop editor used. The layer's base
  // size (L.w × L.h) is the size of the cropped part.
  // ----------------------------------------------------------------------
  const FULL = Object.freeze({ x: 0, y: 0, w: 1, h: 1, shape: 'rect', mode: 'free' });
  const Crop = {
    FULL,
    of: (L) => L.crop || FULL,
    canCrop: (L) => L.type === 'image' || L.type === 'video',
    active: (L) => {
      const c = L.crop;
      return !!c && (c.shape === 'circle' || c.x > 1e-6 || c.y > 1e-6 || c.w < 1 - 1e-6 || c.h < 1 - 1e-6);
    },
    /** Change a layer's crop (null removes it), keeping the part that stays
     *  visible where it is on the wall. */
    apply(L, next) {
      const c0 = Crop.of(L);
      const c1 = next || FULL;
      // Where the new crop sits inside the old one (0–1 of the current layer box).
      const u0 = (c1.x - c0.x) / c0.w, v0 = (c1.y - c0.y) / c0.h;
      const u1 = (c1.x + c1.w - c0.x) / c0.w, v1 = (c1.y + c1.h - c0.y) / c0.h;
      const q = L.corners;
      L.corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => Geo.map(q, u, v));
      L.w = +(L.w * (c1.w / c0.w)).toFixed(3);
      L.h = +(L.h * (c1.h / c0.h)).toFixed(3);
      if (next) L.crop = { ...next }; else delete L.crop;
    },
  };

  PM.Spin = Spin;
  PM.Crop = Crop;
})(window.PM);
