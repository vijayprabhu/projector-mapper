/* Editor: the stage in the main window, its selection overlay and handles,
 * pointer interaction (move, resize, rotate, corner warp) and snapping.
 */
(function (PM) {
  'use strict';

  const { Geo, Renderer, fitStage, store, events } = PM;
  const { $, clone } = PM.util;
  const S = PM.state;

  const viewport = $('#viewport');
  const stageEl = $('#stage');
  stageEl.classList.add('editor');
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  stageEl.appendChild(overlay);
  const renderer = new Renderer(stageEl);

  let scale = 1; // stage pixels → screen pixels

  function fitEditor() {
    const presenting = document.body.classList.contains('presenting');
    scale = fitStage(stageEl, viewport.clientWidth, viewport.clientHeight, presenting ? 0 : 24);
    overlay.style.setProperty('--inv', 1 / scale);
    drawOverlay();
  }

  /** Update everything that tracks layer geometry (the fast path while dragging). */
  function renderStage() {
    renderer.sync();
    events.emit('render');
    drawOverlay();
    $('#emptyHint').style.display = S.project.layers.length ? 'none' : '';
  }

  function renderToolbar() {
    document.querySelectorAll('[data-cmd^="mode:"]').forEach((b) => b.classList.toggle('on', b.dataset.cmd === 'mode:' + S.mode));
    $('#gridBtn').classList.toggle('on', !!S.project.grid);
  }

  // ---------- selection overlay ----------
  function drawOverlay() {
    const { project, mode, activeCorner } = S;
    overlay.style.width = project.width + 'px';
    overlay.style.height = project.height + 'px';
    overlay.className = mode === 'warp' ? 'warp' : '';
    const L = store.sel();
    if (!L || !L.visible) { overlay.innerHTML = ''; return; }
    const c = L.corners;
    let html = `<svg width="${project.width}" height="${project.height}"><polygon points="${c.map((p) => p.join(',')).join(' ')}"/>`;
    let handles = '';
    if (mode === 'transform' && !L.locked) {
      const top = Geo.mid(c[0], c[1]);
      const ctr = Geo.centroid(c);
      const d = Geo.dist(top, ctr) || 1;
      const off = 36 / scale;
      const rot = [top[0] + ((top[0] - ctr[0]) / d) * off, top[1] + ((top[1] - ctr[1]) / d) * off];
      html += `<line x1="${top[0]}" y1="${top[1]}" x2="${rot[0]}" y2="${rot[1]}"/>`;
      for (let k = 0; k < 4; k++) {
        const m = Geo.mid(c[k], c[(k + 1) % 4]);
        handles += `<div class="handle edge e${k}" data-kind="edge" data-i="${k}" style="left:${m[0]}px;top:${m[1]}px"></div>`;
      }
      handles += `<div class="handle rotate" data-kind="rotate" style="left:${rot[0]}px;top:${rot[1]}px" title="Rotate (Shift snaps to 15°)"></div>`;
    }
    html += '</svg>';
    if (!L.locked) {
      for (let k = 0; k < 4; k++) {
        handles += `<div class="handle corner c${k}${activeCorner === k && mode === 'warp' ? ' active' : ''}" data-kind="corner" data-i="${k}" style="left:${c[k][0]}px;top:${c[k][1]}px"></div>`;
      }
    }
    overlay.innerHTML = html + handles;
  }

  // ---------- pointer interaction ----------
  let drag = null;

  /** Screen event → stage coordinates. */
  function toStage(e) {
    const r = stageEl.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('presenting') || e.button !== 0) return;
    const p = toStage(e);
    const h = e.target.closest('.handle');
    let L;
    if (h) {
      L = store.sel();
      drag = { kind: h.dataset.kind, i: +h.dataset.i };
      if (drag.kind === 'corner') S.activeCorner = drag.i;
    } else {
      const el = e.target.closest('.layer');
      L = el && store.findLayer(el.dataset.id);
      if (!L) {
        if (S.selectedId) { store.select(null); events.emit('change'); }
        return;
      }
      if (S.selectedId !== L.id) { store.select(L.id); events.emit('change'); }
      drag = { kind: 'move' };
    }
    if (!L) { drag = null; return; }
    Object.assign(drag, { id: L.id, p0: p, c0: clone(L.corners), moved: false });
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
    drawOverlay();
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const L = store.findLayer(drag.id);
    if (!L) return;
    const p = toStage(e);
    const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
    if (!drag.moved && Math.hypot(dx, dy) * scale < 2) return;
    drag.moved = true;
    const c0 = drag.c0;

    switch (drag.kind) {
      case 'move':
        L.corners = c0.map((c) => [c[0] + dx, c[1] + dy]);
        break;

      case 'rotate': {
        const o = Geo.centroid(c0);
        let a = Math.atan2(p[1] - o[1], p[0] - o[0]) - Math.atan2(drag.p0[1] - o[1], drag.p0[0] - o[0]);
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        L.corners = c0.map((c) => Geo.rotate(c, o, a));
        break;
      }

      case 'edge': {
        const i = drag.i, j = (i + 1) % 4;
        const m = Geo.mid(c0[i], c0[j]);
        const om = Geo.mid(c0[(i + 2) % 4], c0[(i + 3) % 4]);
        const len = Geo.dist(m, om) || 1;
        const dir = [(m[0] - om[0]) / len, (m[1] - om[1]) / len];
        let t = dx * dir[0] + dy * dir[1];
        const sym = e.altKey;
        t = Math.max(t, -(len - 4) / (sym ? 2 : 1));
        L.corners = c0.map((c, k) => {
          if (k === i || k === j) return [c[0] + dir[0] * t, c[1] + dir[1] * t];
          if (sym) return [c[0] - dir[0] * t, c[1] - dir[1] * t];
          return c.slice();
        });
        break;
      }

      case 'corner': {
        const i = drag.i;
        if (S.mode === 'warp') {
          let np = [c0[i][0] + dx, c0[i][1] + dy];
          if (!e.altKey) np = snapPoint(np, L.id);
          L.corners = c0.map((c, k) => (k === i ? np : c.slice()));
        } else {
          const a = e.altKey ? Geo.centroid(c0) : c0[(i + 2) % 4];
          const v = [c0[i][0] - a[0], c0[i][1] - a[1]];
          const vv = v[0] * v[0] + v[1] * v[1] || 1;
          const s = Math.max(0.02, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / vv);
          L.corners = c0.map((c) => [a[0] + (c[0] - a[0]) * s, a[1] + (c[1] - a[1]) * s]);
        }
        break;
      }
    }
    renderStage();
  });

  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) store.commit(); else drawOverlay();
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  /** Snap a point to other layers' corners and to the stage edges/corners. */
  function snapPoint(p, skipId) {
    const tol = 12 / scale;
    let best = null, bd = tol;
    const W = S.project.width, H = S.project.height;
    const targets = [[0, 0], [W, 0], [W, H], [0, H]];
    for (const L of S.project.layers) {
      if (L.id !== skipId && L.visible) targets.push(...L.corners);
    }
    for (const t of targets) {
      const d = Geo.dist(p, t);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) return best.slice();
    const q = p.slice();
    if (Math.abs(q[0]) < tol) q[0] = 0; else if (Math.abs(q[0] - W) < tol) q[0] = W;
    if (Math.abs(q[1]) < tol) q[1] = 0; else if (Math.abs(q[1] - H) < tol) q[1] = H;
    return q;
  }

  PM.editor = { viewport, stageEl, fitEditor, renderStage, renderToolbar, drawOverlay, toStage };
})(window.PM);
