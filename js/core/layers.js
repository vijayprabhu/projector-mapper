/* Layers: the layer factory (shapes, text, media) and layer operations
 * (reorder, duplicate, delete, nudge, flip, rotate, reset warp, fit, …).
 */
(function (PM) {
  'use strict';

  const { Geo, DB, store, events } = PM;
  const { uid, clone } = PM.util;
  const S = PM.state;

  const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', hexagon: 'Hexagon' };
  const PALETTE = ['#4f8cff', '#2fbf8f', '#ff6b6b', '#ffb020', '#b07cff', '#ffffff', '#ff4fa3'];

  /** Defaults for every layer. New layer fields need a default here, and older
   *  saved projects won't have them, so read them tolerantly. */
  function baseLayer(extra) {
    return {
      id: uid(), name: 'Layer', visible: true, locked: false,
      opacity: 1, blend: 'normal', spin: 0, spinCcw: false, w: 400, h: 400, corners: null, ...extra,
    };
  }

  function placeCorners(L, at) {
    const { project } = S;
    const n = project.layers.length % 8;
    const cx = at ? at[0] : project.width / 2 + (n - 4) * 24;
    const cy = at ? at[1] : project.height / 2 + (n - 4) * 24;
    L.corners = Geo.rect(cx, cy, L.w, L.h);
  }

  function addLayer(L, at) {
    if (!L.corners) placeCorners(L, at);
    S.project.layers.push(L);
    store.select(L.id);
    store.commit();
  }

  function addShape(shape) {
    const color = PALETTE[S.project.layers.length % PALETTE.length];
    addLayer(baseLayer({
      type: 'shape', shape, name: SHAPE_NAMES[shape] || 'Shape',
      fill: color, fillOn: true, stroke: '#ffffff', strokeWidth: 0, radius: 0,
    }));
  }

  function addText() {
    addLayer(baseLayer({
      type: 'text', name: 'Text', text: 'Hello wall', w: 800, h: 200,
      color: '#ffffff', fontSize: 110, fontFamily: 'system-ui, sans-serif', bold: true,
    }));
  }

  async function addMediaFile(file, at) {
    const isVideo = file.type.startsWith('video/');
    if (!isVideo && !file.type.startsWith('image/')) return;
    const id = uid();
    const blob = file.slice(0, file.size, file.type);
    await DB.put('media', id, { blob, type: file.type, name: file.name }).catch(() => PM.ui.toast('Could not store media; it will be lost on reload'));
    const url = URL.createObjectURL(blob);
    store.media.set(id, { url, type: file.type });

    const [nw, nh] = await naturalSize(url, isVideo);
    const maxW = S.project.width * 0.6, maxH = S.project.height * 0.6;
    const k = Math.min(1, maxW / nw, maxH / nh);
    addLayer(baseLayer({
      type: isVideo ? 'video' : 'image',
      name: file.name.replace(/\.[^.]+$/, '') || (isVideo ? 'Video' : 'Image'),
      mediaId: id, w: Math.round(nw * k), h: Math.round(nh * k),
    }), at);
  }

  function naturalSize(url, isVideo) {
    return new Promise((res) => {
      if (isVideo) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => res([v.videoWidth || 1280, v.videoHeight || 720]);
        v.onerror = () => res([1280, 720]);
        v.src = url;
      } else {
        const i = new Image();
        i.onload = () => res([i.naturalWidth || 800, i.naturalHeight || 600]);
        i.onerror = () => res([800, 600]);
        i.src = url;
      }
    });
  }

  // ---------- operations on the selected layer ----------
  function moveLayer(delta) {
    const layers = S.project.layers;
    const i = layers.findIndex((l) => l.id === S.selectedId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const [L] = layers.splice(i, 1);
    layers.splice(j, 0, L);
    store.commit();
  }

  function duplicate() {
    const L = store.sel();
    if (!L) return;
    const c = clone(L);
    c.id = uid();
    c.name = L.name + ' copy';
    c.corners = c.corners.map((p) => [p[0] + 30, p[1] + 30]);
    S.project.layers.splice(S.project.layers.indexOf(L) + 1, 0, c);
    S.selectedId = c.id;
    store.commit();
  }

  function remove() {
    const layers = S.project.layers;
    const i = layers.findIndex((l) => l.id === S.selectedId);
    if (i < 0) return;
    layers.splice(i, 1);
    store.select(layers[Math.min(i, layers.length - 1)]?.id || null);
    store.commit();
  }

  /** Move the selected layer (or, in warp mode, its active corner). Commits after a pause. */
  let nudgeTimer = null;
  function nudge(dx, dy) {
    const L = store.sel();
    if (!L || L.locked) return;
    if (S.mode === 'warp' && S.activeCorner !== null) {
      L.corners[S.activeCorner] = [L.corners[S.activeCorner][0] + dx, L.corners[S.activeCorner][1] + dy];
    } else {
      L.corners = L.corners.map((c) => [c[0] + dx, c[1] + dy]);
    }
    events.emit('preview');
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(store.commit, 300);
  }

  /** Corner-editing actions for the side panel's buttons (data-act). */
  const ACTIONS = {
    flipX(L) { const c = L.corners; L.corners = [c[1], c[0], c[3], c[2]]; },
    flipY(L) { const c = L.corners; L.corners = [c[3], c[2], c[1], c[0]]; },
    rotL(L) { const o = Geo.centroid(L.corners); L.corners = L.corners.map((c) => Geo.rotate(c, o, -Math.PI / 2)); },
    rotR(L) { const o = Geo.centroid(L.corners); L.corners = L.corners.map((c) => Geo.rotate(c, o, Math.PI / 2)); },
    unwarp(L, keepAspect) {
      const c = L.corners;
      const o = Geo.centroid(c);
      const w = (Geo.dist(c[0], c[1]) + Geo.dist(c[3], c[2])) / 2;
      let h = (Geo.dist(c[0], c[3]) + Geo.dist(c[1], c[2])) / 2;
      if (keepAspect) h = (w * L.h) / L.w;
      const top = [c[1][0] - c[0][0], c[1][1] - c[0][1]];
      const bot = [c[2][0] - c[3][0], c[2][1] - c[3][1]];
      const ang = Math.atan2(top[1] + bot[1], top[0] + bot[0]);
      L.corners = Geo.rect(o[0], o[1], w, h).map((p) => Geo.rotate(p, o, ang));
    },
    aspect(L) { ACTIONS.unwarp(L, true); },
    fill(L) { const W = S.project.width, H = S.project.height; L.corners = [[0, 0], [W, 0], [W, H], [0, H]]; },
    fit(L) {
      const { width, height } = S.project;
      const k = Math.min(width / L.w, height / L.h);
      L.corners = Geo.rect(width / 2, height / 2, L.w * k, L.h * k);
    },
    center(L) {
      const o = Geo.centroid(L.corners);
      const dx = S.project.width / 2 - o[0], dy = S.project.height / 2 - o[1];
      L.corners = L.corners.map((c) => [c[0] + dx, c[1] + dy]);
    },
  };

  PM.layers = {
    SHAPE_NAMES, baseLayer, addShape, addText, addMediaFile, naturalSize,
    moveLayer, duplicate, remove, nudge, ACTIONS,
  };
})(window.PM);
