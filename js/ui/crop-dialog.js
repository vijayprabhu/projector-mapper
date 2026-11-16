/* Crop dialog: pick a free-form, 1:1 or circular region of an image or video.
 * Works in source pixels; Apply stores the crop as 0–1 values via PM.Crop.apply.
 */
(function (PM) {
  'use strict';

  const { Crop, store } = PM;
  const { $ } = PM.util;
  const S = PM.state;

  const ui = { L: null, nw: 0, nh: 0, scale: 1, box: null, mode: 'free', drag: null };
  const dlg = $('#cropDlg'), area = $('#cropArea'), box = $('#cropBox');
  const MIN = 8; // source pixels

  async function open(L) {
    const m = store.media.get(L.mediaId);
    if (!m) return PM.ui.toast('This layer\'s media is missing, so it can\'t be cropped.');
    const isVideo = L.type === 'video';
    const [nw, nh] = await PM.layers.naturalSize(m.url, isVideo);
    area.querySelector('img,video')?.remove();
    const el = document.createElement(isVideo ? 'video' : 'img');
    if (isVideo) Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true });
    el.src = m.url;
    area.prepend(el);
    if (isVideo) el.play().catch(() => {});

    const c = Crop.of(L);
    Object.assign(ui, {
      L, nw, nh,
      mode: c.shape === 'circle' ? 'circle' : c.mode === 'square' ? 'square' : 'free',
      box: { x: c.x * nw, y: c.y * nh, w: c.w * nw, h: c.h * nh },
    });
    dlg.hidden = false;
    // Fit the picture into the dialog.
    const st = $('#cropStage');
    ui.scale = Math.min((st.clientWidth - 24) / nw, (st.clientHeight - 24) / nh);
    area.style.width = nw * ui.scale + 'px';
    area.style.height = nh * ui.scale + 'px';
    draw();
  }

  function close() {
    dlg.hidden = true;
    const v = area.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    area.querySelector('img,video')?.remove();
    ui.L = null;
  }

  const isOpen = () => !dlg.hidden;

  function setMode(mode) {
    ui.mode = mode;
    if (mode !== 'free') {
      // Largest square inside the current box, keeping its centre.
      const b = ui.box;
      const s = Math.min(b.w, b.h);
      ui.box = clampBox({ x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s });
    }
    draw();
  }

  function clampBox(b) {
    const { nw, nh } = ui;
    b.w = Math.min(b.w, nw); b.h = Math.min(b.h, nh);
    b.x = Math.min(Math.max(0, b.x), nw - b.w);
    b.y = Math.min(Math.max(0, b.y), nh - b.h);
    return b;
  }

  function draw() {
    const { box: b, scale: s, mode } = ui;
    Object.assign(box.style, { left: b.x * s + 'px', top: b.y * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px' });
    box.classList.toggle('circle', mode === 'circle');
    // Corner handles always; edge handles only for free form.
    const pts = [['nw', 0, 0], ['ne', 1, 0], ['se', 1, 1], ['sw', 0, 1]];
    if (mode === 'free') pts.push(['n', 0.5, 0], ['e', 1, 0.5], ['s', 0.5, 1], ['w', 0, 0.5]);
    box.querySelectorAll('.ch').forEach((h) => h.remove());
    for (const [id, u, v] of pts) {
      const h = document.createElement('div');
      h.className = 'ch' + (id.length === 1 ? ' e' : '');
      h.dataset.h = id;
      h.style.left = u * 100 + '%';
      h.style.top = v * 100 + '%';
      h.style.cursor = id + '-resize';
      box.appendChild(h);
    }
    document.querySelectorAll('[data-crop-mode]').forEach((btn) => btn.classList.toggle('on', btn.dataset.cropMode === mode));
    $('#cropSize').textContent = `${Math.round(b.w)} × ${Math.round(b.h)} px`;
  }

  const point = (e) => {
    const r = area.getBoundingClientRect();
    return [(e.clientX - r.left) / ui.scale, (e.clientY - r.top) / ui.scale];
  };

  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const h = e.target.closest('.ch');
    const inBox = e.target.closest('#cropBox');
    if (!h && !inBox) return;
    ui.drag = { h: h ? h.dataset.h : 'move', p0: point(e), b0: { ...ui.box } };
    area.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  area.addEventListener('pointermove', (e) => {
    const d = ui.drag;
    if (!d) return;
    const { nw, nh } = ui;
    const [px, py] = point(e);
    const b0 = d.b0;
    if (d.h === 'move') {
      ui.box = clampBox({ ...b0, x: b0.x + px - d.p0[0], y: b0.y + py - d.p0[1] });
      return draw();
    }
    const L = d.h.includes('w'), R = d.h.includes('e'), T = d.h.includes('n'), B = d.h.includes('s');
    const clampX = (x) => Math.min(Math.max(0, x), nw), clampY = (y) => Math.min(Math.max(0, y), nh);
    if (ui.mode === 'free') {
      let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
      if (L) x0 = Math.min(clampX(px), x1 - MIN);
      if (R) x1 = Math.max(clampX(px), x0 + MIN);
      if (T) y0 = Math.min(clampY(py), y1 - MIN);
      if (B) y1 = Math.max(clampY(py), y0 + MIN);
      ui.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else {
      // Square: anchor the opposite corner and grow along the larger drag direction.
      const ax = R ? b0.x : b0.x + b0.w, ay = B ? b0.y : b0.y + b0.h;
      const sx = R ? 1 : -1, sy = B ? 1 : -1;
      const avail = Math.min(sx > 0 ? nw - ax : ax, sy > 0 ? nh - ay : ay);
      const side = Math.min(Math.max(MIN, sx * (px - ax), sy * (py - ay)), avail);
      ui.box = { x: sx > 0 ? ax : ax - side, y: sy > 0 ? ay : ay - side, w: side, h: side };
    }
    draw();
  });
  const endDrag = () => { ui.drag = null; };
  area.addEventListener('pointerup', endDrag);
  area.addEventListener('pointercancel', endDrag);

  document.querySelectorAll('[data-crop-mode]').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.cropMode)));
  $('#cropReset').addEventListener('click', () => {
    const { nw, nh } = ui;
    if (ui.mode === 'free') ui.box = { x: 0, y: 0, w: nw, h: nh };
    else { const s = Math.min(nw, nh); ui.box = { x: (nw - s) / 2, y: (nh - s) / 2, w: s, h: s }; }
    draw();
  });
  $('#cropCancel').addEventListener('click', close);
  $('#cropApply').addEventListener('click', () => {
    const { L, nw, nh, box: b, mode } = ui;
    if (!L || !S.project.layers.includes(L)) return close();
    const r = (v) => Math.min(1, Math.max(0, +v.toFixed(6)));
    const next = { x: r(b.x / nw), y: r(b.y / nh), w: r(b.w / nw), h: r(b.h / nh), shape: mode === 'circle' ? 'circle' : 'rect', mode };
    const whole = next.shape === 'rect' && next.x === 0 && next.y === 0 && next.w === 1 && next.h === 1;
    Crop.apply(L, whole ? null : next);
    close();
    store.commit();
  });

  PM.cropDialog = { open, close, isOpen };
})(window.PM);
