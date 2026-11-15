/* Projector Mapper: a browser-based projection mapping tool.
 *
 * Every layer has a base size (w × h) and four output-space corners
 * (TL, TR, BR, BL). It is drawn at its base size and mapped onto those corners
 * with a CSS matrix3d homography. Move, resize, rotate and corner-warp all edit
 * the corners, so every layer type supports perspective warping.
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

  // ======================================================================
  // Geometry
  // ======================================================================
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

  // ======================================================================
  // Storage (IndexedDB): project JSON + media blobs
  // ======================================================================
  const DB = {
    db: null,
    open() {
      return new Promise((res) => {
        let req;
        try { req = indexedDB.open('projector-mapper', 1); } catch { return res(null); }
        req.onupgradeneeded = () => {
          req.result.createObjectStore('kv');
          req.result.createObjectStore('media');
        };
        req.onsuccess = () => { this.db = req.result; res(this.db); };
        req.onerror = () => res(null);
      });
    },
    tx(store, mode, fn) {
      if (!this.db) return Promise.resolve(null);
      return new Promise((res, rej) => {
        const t = this.db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => res(r && r.result);
        t.onerror = () => rej(t.error);
      });
    },
    get: (store, key) => DB.tx(store, 'readonly', (s) => s.get(key)),
    put: (store, key, val) => DB.tx(store, 'readwrite', (s) => s.put(val, key)),
    del: (store, key) => DB.tx(store, 'readwrite', (s) => s.delete(key)),
    keys: (store) => DB.tx(store, 'readonly', (s) => s.getAllKeys()),
    clear: (store) => DB.tx(store, 'readwrite', (s) => s.clear()),
  };

  // ======================================================================
  // State
  // ======================================================================
  const defaultProject = () => ({ version: 1, width: 1920, height: 1080, background: '#000000', grid: false, layers: [] });

  let project = defaultProject();
  let selectedId = null;
  let mode = 'transform';           // 'transform' | 'warp'
  let activeCorner = null;          // corner index chosen for keyboard nudging in warp mode
  let editorScale = 1;
  const media = new Map();          // mediaId -> { url, type }

  const sel = () => project.layers.find((l) => l.id === selectedId) || null;

  // ---------- history ----------
  let undoStack = [], redoStack = [], committed = JSON.stringify(project);
  function commit() {
    const s = JSON.stringify(project);
    if (s === committed) return;
    undoStack.push(committed);
    if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    committed = s;
    scheduleSave();
    renderAll();
  }
  function restore(s) {
    committed = s;
    project = JSON.parse(s);
    if (!sel()) selectedId = null;
    scheduleSave();
    syncOutputInputs();
    renderAll();
  }
  function undo() { if (undoStack.length) { redoStack.push(committed); restore(undoStack.pop()); } }
  function redo() { if (redoStack.length) { undoStack.push(committed); restore(redoStack.pop()); } }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.put('kv', 'project', committed).catch(() => {});
      gcMedia();
    }, 400);
  }
  // Delete media blobs that no layer, undo state or redo state uses any more.
  async function gcMedia() {
    const used = new Set();
    for (const s of [committed, ...undoStack, ...redoStack]) {
      for (const m of s.matchAll(/"mediaId":"([^"]+)"/g)) used.add(m[1]);
    }
    for (const id of [...media.keys()]) {
      if (!used.has(id)) {
        URL.revokeObjectURL(media.get(id).url);
        media.delete(id);
        DB.del('media', id).catch(() => {});
      }
    }
  }

  // ======================================================================
  // Layer factory
  // ======================================================================
  const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', hexagon: 'Hexagon' };
  const PALETTE = ['#4f8cff', '#2fbf8f', '#ff6b6b', '#ffb020', '#b07cff', '#ffffff', '#ff4fa3'];

  function baseLayer(extra) {
    return {
      id: uid(), name: 'Layer', visible: true, locked: false,
      opacity: 1, blend: 'normal', w: 400, h: 400, corners: null, ...extra,
    };
  }

  function placeCorners(L, at) {
    const n = project.layers.length % 8;
    const cx = at ? at[0] : project.width / 2 + (n - 4) * 24;
    const cy = at ? at[1] : project.height / 2 + (n - 4) * 24;
    L.corners = Geo.rect(cx, cy, L.w, L.h);
  }

  function addLayer(L, at) {
    if (!L.corners) placeCorners(L, at);
    project.layers.push(L);
    selectedId = L.id;
    activeCorner = null;
    commit();
  }

  function addShape(shape) {
    const color = PALETTE[project.layers.length % PALETTE.length];
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
    await DB.put('media', id, { blob, type: file.type, name: file.name }).catch(() => toast('Could not store media; it will be lost on reload'));
    const url = URL.createObjectURL(blob);
    media.set(id, { url, type: file.type });

    const [nw, nh] = await naturalSize(url, isVideo);
    const maxW = project.width * 0.6, maxH = project.height * 0.6;
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

  // ======================================================================
  // Rendering (shared by the editor and the output window)
  // ======================================================================
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

  function contentKey(L) {
    switch (L.type) {
      case 'shape': return ['s', L.shape, L.fill, L.fillOn, L.stroke, L.strokeWidth, L.radius, L.w, L.h].join('|');
      case 'text': return ['t', L.text, L.color, L.fontSize, L.fontFamily, L.bold].join('|');
      default: return [L.type, L.mediaId, media.has(L.mediaId)].join('|');
    }
  }

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

  class Renderer {
    constructor(stage) {
      this.stage = stage;
      this.doc = stage.ownerDocument;
      this.els = new Map();
      this.gridKey = null;
      this.grid = null;
    }
    sync() {
      const { stage, doc } = this;
      stage.style.width = project.width + 'px';
      stage.style.height = project.height + 'px';
      stage.style.background = project.background;

      const live = new Set();
      project.layers.forEach((L, i) => {
        live.add(L.id);
        let rec = this.els.get(L.id);
        if (!rec) {
          const el = doc.createElement('div');
          el.className = 'layer';
          el.dataset.id = L.id;
          stage.appendChild(el);
          rec = { el, key: null };
          this.els.set(L.id, rec);
        }
        const key = contentKey(L);
        if (rec.key !== key) { buildContent(rec.el, L, doc); rec.key = key; }
        const s = rec.el.style;
        s.width = L.w + 'px';
        s.height = L.h + 'px';
        const m = Geo.homography(L.w, L.h, L.corners);
        s.transform = m || 'scale(0)';
        s.opacity = L.opacity;
        s.mixBlendMode = L.blend || 'normal';
        s.zIndex = i + 1;
        s.display = L.visible ? '' : 'none';
        s.pointerEvents = L.locked ? 'none' : '';
      });
      for (const [id, rec] of this.els) {
        if (!live.has(id)) { rec.el.remove(); this.els.delete(id); }
      }

      const gk = project.grid ? `${project.width}x${project.height}` : null;
      if (gk !== this.gridKey) {
        this.grid?.remove();
        this.grid = null;
        if (gk) {
          const t = doc.createElement('div');
          t.innerHTML = gridSVG(project.width, project.height);
          this.grid = t.firstElementChild;
          stage.appendChild(this.grid);
        }
        this.gridKey = gk;
      }
    }
  }

  function fitStage(stage, vw, vh, pad) {
    const s = Math.min((vw - pad * 2) / project.width, (vh - pad * 2) / project.height);
    const x = (vw - project.width * s) / 2, y = (vh - project.height * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    return s;
  }

  // ======================================================================
  // Editor DOM
  // ======================================================================
  const viewport = $('#viewport');
  const stageEl = $('#stage');
  stageEl.classList.add('editor');
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  stageEl.appendChild(overlay);
  const editor = new Renderer(stageEl);

  let output = null; // { win, renderer, fit }

  function fitEditor() {
    const presenting = document.body.classList.contains('presenting');
    editorScale = fitStage(stageEl, viewport.clientWidth, viewport.clientHeight, presenting ? 0 : 24);
    overlay.style.setProperty('--inv', 1 / editorScale);
    drawOverlay();
  }

  /** Update everything that tracks layer geometry (fast path while dragging). */
  function renderStage() {
    editor.sync();
    if (output) {
      if (output.win.closed) output = null;
      else { output.renderer.sync(); output.fit(); }
    }
    drawOverlay();
    $('#emptyHint').style.display = project.layers.length ? 'none' : '';
  }

  function renderAll() {
    renderStage();
    renderLayerList();
    renderProps();
    renderToolbar();
  }

  function renderToolbar() {
    document.querySelectorAll('[data-cmd^="mode:"]').forEach((b) => b.classList.toggle('on', b.dataset.cmd === 'mode:' + mode));
    $('#gridBtn').classList.toggle('on', !!project.grid);
  }

  // ---------- selection overlay ----------
  function drawOverlay() {
    overlay.style.width = project.width + 'px';
    overlay.style.height = project.height + 'px';
    overlay.className = mode === 'warp' ? 'warp' : '';
    const L = sel();
    if (!L || !L.visible) { overlay.innerHTML = ''; return; }
    const c = L.corners;
    let html = `<svg width="${project.width}" height="${project.height}"><polygon points="${c.map((p) => p.join(',')).join(' ')}"/>`;
    let handles = '';
    if (mode === 'transform' && !L.locked) {
      const top = Geo.mid(c[0], c[1]);
      const ctr = Geo.centroid(c);
      const d = Geo.dist(top, ctr) || 1;
      const off = 36 / editorScale;
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

  function toStage(e) {
    const r = stageEl.getBoundingClientRect();
    return [(e.clientX - r.left) / editorScale, (e.clientY - r.top) / editorScale];
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('presenting') || e.button !== 0) return;
    const p = toStage(e);
    const h = e.target.closest('.handle');
    let L;
    if (h) {
      L = sel();
      drag = { kind: h.dataset.kind, i: +h.dataset.i };
      if (drag.kind === 'corner') activeCorner = drag.i;
    } else {
      const el = e.target.closest('.layer');
      L = el && project.layers.find((l) => l.id === el.dataset.id);
      if (!L) {
        if (selectedId) { selectedId = null; activeCorner = null; renderAll(); }
        return;
      }
      if (selectedId !== L.id) { selectedId = L.id; activeCorner = null; renderAll(); }
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
    const L = project.layers.find((l) => l.id === drag.id);
    if (!L) return;
    const p = toStage(e);
    const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
    if (!drag.moved && Math.hypot(dx, dy) * editorScale < 2) return;
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
        if (mode === 'warp') {
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
    if (moved) commit(); else drawOverlay();
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  /** Snap a point to other layers' corners and to the stage edges/corners. */
  function snapPoint(p, skipId) {
    const tol = 12 / editorScale;
    let best = null, bd = tol;
    const W = project.width, H = project.height;
    const targets = [[0, 0], [W, 0], [W, H], [0, H]];
    for (const L of project.layers) {
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

  // ======================================================================
  // Layer operations
  // ======================================================================
  function moveLayer(delta) {
    const i = project.layers.findIndex((l) => l.id === selectedId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= project.layers.length) return;
    const [L] = project.layers.splice(i, 1);
    project.layers.splice(j, 0, L);
    commit();
  }
  function duplicate() {
    const L = sel();
    if (!L) return;
    const c = clone(L);
    c.id = uid();
    c.name = L.name + ' copy';
    c.corners = c.corners.map((p) => [p[0] + 30, p[1] + 30]);
    project.layers.splice(project.layers.indexOf(L) + 1, 0, c);
    selectedId = c.id;
    commit();
  }
  function remove() {
    const i = project.layers.findIndex((l) => l.id === selectedId);
    if (i < 0) return;
    project.layers.splice(i, 1);
    selectedId = project.layers[Math.min(i, project.layers.length - 1)]?.id || null;
    activeCorner = null;
    commit();
  }
  function nudge(dx, dy) {
    const L = sel();
    if (!L || L.locked) return;
    if (mode === 'warp' && activeCorner !== null) {
      L.corners[activeCorner] = [L.corners[activeCorner][0] + dx, L.corners[activeCorner][1] + dy];
    } else {
      L.corners = L.corners.map((c) => [c[0] + dx, c[1] + dy]);
    }
    renderStage();
    clearTimeout(nudge.t);
    nudge.t = setTimeout(commit, 300);
  }

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
    fill(L) { const W = project.width, H = project.height; L.corners = [[0, 0], [W, 0], [W, H], [0, H]]; },
    fit(L) {
      const k = Math.min(project.width / L.w, project.height / L.h);
      L.corners = Geo.rect(project.width / 2, project.height / 2, L.w * k, L.h * k);
    },
    center(L) {
      const o = Geo.centroid(L.corners);
      const dx = project.width / 2 - o[0], dy = project.height / 2 - o[1];
      L.corners = L.corners.map((c) => [c[0] + dx, c[1] + dy]);
    },
  };

  // ======================================================================
  // Side panel
  // ======================================================================
  const ICON = { image: '🖼', video: '🎞', text: 'T', shape: '◆' };

  function renderLayerList() {
    const ul = $('#layerList');
    if (!project.layers.length) { ul.innerHTML = '<li class="empty">No layers yet</li>'; return; }
    ul.innerHTML = [...project.layers].reverse().map((L) => `
      <li data-id="${L.id}" class="${L.id === selectedId ? 'sel' : ''} ${L.visible ? '' : 'hidden'}">
        <span class="ico">${L.type === 'shape' ? `<span style="color:${esc(L.fill)}">◆</span>` : ICON[L.type]}</span>
        <span class="name" title="${esc(L.name)}">${esc(L.name)}</span>
        <button class="tog ${L.visible ? 'on' : ''}" data-tog="visible" title="Show / hide">${L.visible ? '👁' : '—'}</button>
        <button class="tog ${L.locked ? 'on' : ''}" data-tog="locked" title="Lock">${L.locked ? '🔒' : '🔓'}</button>
      </li>`).join('');
  }

  $('#layerList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const L = project.layers.find((l) => l.id === li.dataset.id);
    const tog = e.target.closest('[data-tog]');
    if (tog) { L[tog.dataset.tog] = !L[tog.dataset.tog]; commit(); return; }
    selectedId = L.id;
    activeCorner = null;
    renderAll();
  });

  $('#layerList').addEventListener('dblclick', (e) => {
    const li = e.target.closest('li[data-id]');
    const L = li && project.layers.find((l) => l.id === li.dataset.id);
    if (!L) return;
    const name = prompt('Layer name', L.name);
    if (name != null && name.trim()) { L.name = name.trim(); commit(); }
  });

  function renderProps() {
    const box = $('#props');
    const L = sel();
    if (!L) {
      box.innerHTML = '<h3>Properties</h3><p class="muted">Select a layer to edit it.</p>';
      return;
    }
    const bb = Geo.bbox(L.corners);
    const r = (v) => Math.round(v);
    const blends = ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'difference', 'color-dodge', 'hard-light', 'soft-light'];
    let html = `<h3>Properties: ${esc(L.type)}</h3>
      <div class="row"><label>Name</label><input type="text" data-prop="name" value="${esc(L.name)}"></div>
      <div class="row"><label>Position</label>
        X <input type="number" data-bbox="x" value="${r(bb.x)}"> Y <input type="number" data-bbox="y" value="${r(bb.y)}"></div>
      <div class="row"><label>Size</label>
        W <input type="number" min="1" data-bbox="w" value="${r(bb.w)}"> H <input type="number" min="1" data-bbox="h" value="${r(bb.h)}"></div>
      <div class="row"><label>Opacity</label><input type="range" min="0" max="1" step="0.01" data-prop="opacity" data-num value="${L.opacity}"></div>
      <div class="row"><label>Blend</label><select data-prop="blend">${blends.map((b) => `<option ${b === L.blend ? 'selected' : ''}>${b}</option>`).join('')}</select></div>`;

    if (L.type === 'shape') {
      html += `
      <div class="row"><label>Shape</label><select data-prop="shape">${Object.entries(SHAPE_NAMES).map(([k, v]) => `<option value="${k}" ${k === L.shape ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="row"><label>Fill</label><input type="color" data-prop="fill" value="${esc(L.fill)}">
        <label style="width:auto"><input type="checkbox" data-prop="fillOn" data-bool ${L.fillOn !== false ? 'checked' : ''}> filled</label></div>
      <div class="row"><label>Outline</label><input type="color" data-prop="stroke" value="${esc(L.stroke)}">
        <input type="number" min="0" max="200" data-prop="strokeWidth" data-num value="${L.strokeWidth}"> px</div>
      ${L.shape === 'rect' ? `<div class="row"><label>Corner radius</label><input type="number" min="0" data-prop="radius" data-num value="${L.radius || 0}"></div>` : ''}`;
    }
    if (L.type === 'text') {
      html += `
      <div class="row"><label>Text</label><textarea data-prop="text">${esc(L.text)}</textarea></div>
      <div class="row"><label>Colour</label><input type="color" data-prop="color" value="${esc(L.color)}">
        <label style="width:auto"><input type="checkbox" data-prop="bold" data-bool ${L.bold ? 'checked' : ''}> bold</label></div>
      <div class="row"><label>Font size</label><input type="number" min="4" data-prop="fontSize" data-num value="${L.fontSize}"></div>
      <div class="row"><label>Font</label><select data-prop="fontFamily">${['system-ui, sans-serif', 'Georgia, serif', 'Impact, sans-serif', '"Courier New", monospace', '"Comic Sans MS", cursive', 'Arial Black, sans-serif']
        .map((f) => `<option value='${esc(f)}' ${f === L.fontFamily ? 'selected' : ''}>${esc(f.split(',')[0].replace(/"/g, ''))}</option>`).join('')}</select></div>`;
    }
    if (L.type === 'video') {
      html += `<div class="row"><label>Video</label><button class="btn sm" data-act="restart">Restart</button></div>`;
    }

    html += `
      <div class="row tight">
        <button class="btn sm" data-act="rotL" title="Rotate 90° left">⟲ 90°</button>
        <button class="btn sm" data-act="rotR" title="Rotate 90° right">⟳ 90°</button>
        <button class="btn sm" data-act="flipX">Flip H</button>
        <button class="btn sm" data-act="flipY">Flip V</button>
      </div>
      <div class="row tight">
        <button class="btn sm" data-act="unwarp" title="Make rectangular again">Reset warp</button>
        <button class="btn sm" data-act="aspect" title="Restore original proportions">Original aspect</button>
        <button class="btn sm" data-act="center">Centre</button>
      </div>
      <div class="row tight">
        <button class="btn sm" data-act="fit" title="Fit inside the output, keeping proportions">Fit output</button>
        <button class="btn sm" data-act="fill" title="Stretch to fill the whole output">Fill output</button>
      </div>`;
    box.innerHTML = html;
  }

  const props = $('#props');
  function readProp(t) {
    if (t.hasAttribute('data-bool')) return t.checked;
    if (t.hasAttribute('data-num')) return parseFloat(t.value) || 0;
    return t.value;
  }
  props.addEventListener('input', (e) => {
    const t = e.target, L = sel();
    if (!L || !t.dataset.prop) return;
    L[t.dataset.prop] = readProp(t);
    renderStage();
  });
  props.addEventListener('change', (e) => {
    const t = e.target, L = sel();
    if (!L) return;
    if (t.dataset.prop) {
      L[t.dataset.prop] = readProp(t);
      if (t.dataset.prop === 'name' && !L.name.trim()) L.name = 'Layer';
      commit();
    } else if (t.dataset.bbox) {
      const bb = Geo.bbox(L.corners);
      const nb = { ...bb, [t.dataset.bbox]: parseFloat(t.value) };
      if (!(nb[t.dataset.bbox] === nb[t.dataset.bbox])) return renderProps();
      nb.w = Math.max(1, nb.w); nb.h = Math.max(1, nb.h);
      L.corners = L.corners.map(([x, y]) => [
        nb.x + (bb.w ? ((x - bb.x) / bb.w) * nb.w : 0),
        nb.y + (bb.h ? ((y - bb.y) / bb.h) * nb.h : 0),
      ]);
      commit();
    }
  });
  props.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'), L = sel();
    if (!b || !L) return;
    if (b.dataset.act === 'restart') {
      document.querySelectorAll(`.layer[data-id="${L.id}"] video`).forEach((v) => { v.currentTime = 0; v.play().catch(() => {}); });
      output?.win.document.querySelectorAll(`.layer[data-id="${L.id}"] video`).forEach((v) => { v.currentTime = 0; v.play().catch(() => {}); });
      return;
    }
    ACTIONS[b.dataset.act](L);
    commit();
  });

  // ---------- output settings ----------
  function syncOutputInputs() {
    $('#outW').value = project.width;
    $('#outH').value = project.height;
    $('#bgColor').value = project.background;
  }
  function setResolution(w, h) {
    w = Math.round(w); h = Math.round(h);
    if (!(w >= 100 && h >= 100 && w <= 8192 && h <= 8192)) { syncOutputInputs(); return; }
    project.width = w; project.height = h;
    commit();
    fitEditor();
    syncOutputInputs();
  }
  $('#outW').addEventListener('change', () => setResolution(+$('#outW').value, project.height));
  $('#outH').addEventListener('change', () => setResolution(project.width, +$('#outH').value));
  $('#resPreset').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    if (w && h) setResolution(w, h);
    e.target.value = '';
  });
  $('#bgColor').addEventListener('input', (e) => { project.background = e.target.value; renderStage(); });
  $('#bgColor').addEventListener('change', commit);

  // ======================================================================
  // Output window (drag it to the projector)
  // ======================================================================
  function openOutput() {
    const win = window.open('', 'projector-mapper-output', 'width=960,height=540');
    if (!win) { toast('Pop-up blocked. Allow pop-ups for this page and try again.'); return; }
    const d = win.document;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Projector Output</title>
      <style>
        html,body{margin:0;height:100%;background:#000;overflow:hidden}
        body.idle{cursor:none}
        #stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
        .layer{position:absolute;left:0;top:0;transform-origin:0 0}
        .layer>img,.layer>video,.layer>svg{display:block;width:100%;height:100%}
        .layer>.text{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;line-height:1.1;overflow:hidden}
        .layer{pointer-events:none!important}
        .grid-overlay{position:absolute;left:0;top:0;pointer-events:none;z-index:100000}
        #hint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:16px system-ui,sans-serif;color:#fff;
          background:rgba(0,0,0,.75);border:1px solid #555;padding:16px 22px;border-radius:10px;text-align:center;z-index:999999;transition:opacity .5s;pointer-events:none}
      </style></head>
      <body><div id="stage"></div><div id="hint">Drag this window onto the projector,<br>then <b>double-click</b> (or press <b>F</b>) for fullscreen.</div></body></html>`);
    d.close();

    const stage = d.getElementById('stage');
    const renderer = new Renderer(stage);
    const fit = () => fitStage(stage, win.innerWidth, win.innerHeight, 0);
    const fs = () => {
      if (d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen?.().catch(() => {});
    };
    d.addEventListener('dblclick', fs);
    d.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') fs(); });
    win.addEventListener('resize', fit);
    let idle;
    const wake = () => {
      d.body.classList.remove('idle');
      clearTimeout(idle);
      idle = setTimeout(() => d.body.classList.add('idle'), 1500);
    };
    d.addEventListener('mousemove', wake);
    wake();
    setTimeout(() => { const h = d.getElementById('hint'); if (h) h.style.opacity = '0'; }, 5000);

    output = { win, renderer, fit };
    renderer.sync();
    fit();
    win.focus();
  }

  // ======================================================================
  // Present mode (use this browser window as the output)
  // ======================================================================
  function setPresenting(on, fullscreen) {
    document.body.classList.toggle('presenting', on);
    if (on && fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(fitEditor);
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('presenting')) setPresenting(false);
    else requestAnimationFrame(fitEditor);
  });

  // ======================================================================
  // Import / export
  // ======================================================================
  const blobToDataURL = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  function dataURLToBlob(url) {
    const [head, b64] = url.split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }

  async function exportProject() {
    toast('Preparing export…');
    const out = { app: 'projector-mapper', project, media: {} };
    for (const L of project.layers) {
      if (!L.mediaId || out.media[L.mediaId]) continue;
      const rec = await DB.get('media', L.mediaId);
      if (rec) out.media[L.mediaId] = { type: rec.type, name: rec.name, data: await blobToDataURL(rec.blob) };
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projector-mapping-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Project exported');
  }

  async function importProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data.project || !Array.isArray(data.project.layers)) throw new Error('Not a Projector Mapper file');
      for (const [id, m] of Object.entries(data.media || {})) {
        const blob = dataURLToBlob(m.data);
        await DB.put('media', id, { blob, type: m.type, name: m.name }).catch(() => {});
        if (media.has(id)) URL.revokeObjectURL(media.get(id).url);
        media.set(id, { url: URL.createObjectURL(blob), type: m.type });
      }
      project = { ...defaultProject(), ...data.project };
      selectedId = null;
      undoStack.push(committed);
      redoStack = [];
      committed = JSON.stringify(project);
      scheduleSave();
      syncOutputInputs();
      fitEditor();
      renderAll();
      toast('Project imported');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  }

  // ======================================================================
  // Export to PNG / looping video (for the projector's own media player)
  //
  // Every visible layer is drawn at full output resolution: WebGL applies the
  // same perspective warp as the editor, and a 2D canvas composites the layers
  // with their opacity and blend mode.
  // ======================================================================
  function createWarper(W, H) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
    if (!gl) throw new Error('This browser does not support WebGL2. Try the latest Chrome or Edge.');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform mat3 Hi; uniform sampler2D tex; uniform float outH;
      out vec4 o;
      void main() {
        vec3 q = Hi * vec3(gl_FragCoord.x, outH - gl_FragCoord.y, 1.0);
        if (q.z <= 0.0) discard;
        vec2 uv = q.xy / q.z;
        // Anti-aliased edges: distance to the layer border in output pixels.
        vec2 e = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-6));
        float a = clamp(min(e.x, e.y) + 0.5, 0.0, 1.0);
        if (a <= 0.0) discard;
        o = texture(tex, clamp(uv, 0.0, 1.0)) * a;
      }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.viewport(0, 0, W, H);
    gl.uniform1f(gl.getUniformLocation(prog, 'outH'), H);
    const uHi = gl.getUniformLocation(prog, 'Hi');

    return {
      canvas,
      /** Draw `src` warped onto `corners`. Returns false if the quad is degenerate. */
      draw(src, corners) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const k = Geo.coeffs(corners);
        if (!k) return false;
        const [a, b, c, d, e, f, g, h] = k;
        // Invert M = [[a,b,c],[d,e,f],[g,h,1]] (output pixel -> uv).
        const A = e - f * h, B = f * g - d, C = d * h - e * g;
        const det = a * A + b * B + c * C;
        if (Math.abs(det) < 1e-12) return false;
        const inv = [
          [A, c * h - b, b * f - c * e],
          [B, a - c * g, c * d - a * f],
          [C, b * g - a * h, a * e - b * d],
        ].map((r) => r.map((v) => v / det));
        // Column-major for WebGL.
        gl.uniformMatrix3fv(uHi, false, [inv[0][0], inv[1][0], inv[2][0], inv[0][1], inv[1][1], inv[2][1], inv[0][2], inv[1][2], inv[2][2]]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
    };
  }

  const loadImage = (url) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not load an image'));
    i.src = url;
  });

  /** How much bigger than its base size a layer is drawn on the output (for crisp shapes/text). */
  function layerScale(L) {
    const c = L.corners;
    const horiz = Math.max(Geo.dist(c[0], c[1]), Geo.dist(c[3], c[2])) / L.w;
    const vert = Math.max(Geo.dist(c[0], c[3]), Geo.dist(c[1], c[2])) / L.h;
    return Math.min(Math.max(1, horiz, vert), 8192 / Math.max(L.w, L.h), 6);
  }

  function drawTextLayer(L, k) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(L.w * k));
    cv.height = Math.max(1, Math.round(L.h * k));
    const ctx = cv.getContext('2d');
    ctx.scale(k, k);
    ctx.font = `${L.bold ? 700 : 400} ${L.fontSize}px ${L.fontFamily}`;
    ctx.fillStyle = L.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = [];
    for (const para of String(L.text).split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const test = line + word;
        if (line && ctx.measureText(test).width > L.w) { lines.push(line.trimEnd()); line = word.trimStart(); } else line = test;
      }
      lines.push(line);
    }
    const lh = L.fontSize * 1.1;
    const top = L.h / 2 - (lines.length * lh) / 2 + lh / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, L.w / 2, top + i * lh));
    return cv;
  }

  /** Load a drawable source for every visible layer. Videos get their own element so they can be restarted. */
  async function prepareLayers(forVideo) {
    const items = [];
    for (const L of project.layers) {
      if (!L.visible) continue;
      const m = L.mediaId && media.get(L.mediaId);
      let src = null, video = null;
      if (L.type === 'image' && m) {
        src = await loadImage(m.url);
      } else if (L.type === 'video' && m) {
        video = document.createElement('video');
        Object.assign(video, { src: m.url, muted: true, loop: true, playsInline: true, preload: 'auto' });
        await new Promise((res, rej) => {
          video.onloadeddata = res;
          video.onerror = () => rej(new Error(`Could not load video "${L.name}"`));
        });
        if (!forVideo) {
          // For a still image, use the frame that is showing in the editor right now.
          const live = stageEl.querySelector(`.layer[data-id="${L.id}"] video`);
          video.currentTime = live ? live.currentTime : 0;
          await new Promise((r) => { video.onseeked = r; setTimeout(r, 1500); });
        }
        src = video;
      } else if (L.type === 'shape') {
        const k = layerScale(L);
        const svg = new Blob([shapeSVG(L)], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svg);
        try {
          const img = await loadImage(url);
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(L.w * k));
          cv.height = Math.max(1, Math.round(L.h * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          src = cv;
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (L.type === 'text') {
        src = drawTextLayer(L, layerScale(L));
      }
      if (src) items.push({ L, src, video });
    }
    return items;
  }

  function composeFrame(ctx, warper, items) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
    for (const { L, src } of items) {
      if (!warper.draw(src, L.corners)) continue;
      ctx.globalAlpha = L.opacity;
      ctx.globalCompositeOperation = !L.blend || L.blend === 'normal' ? 'source-over' : L.blend;
      ctx.drawImage(warper.canvas, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  async function exportPNG() {
    if (!project.layers.some((l) => l.visible)) return toast('Nothing to export yet. Add a layer first.');
    toast('Rendering image…');
    try {
      const W = project.width, H = project.height;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const items = await prepareLayers(false);
      composeFrame(out.getContext('2d'), createWarper(W, H), items);
      const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
      download(blob, `projector-mapping-${W}x${H}-${stamp()}.png`);
      toast(`Saved a ${W} × ${H} PNG. Copy it to a USB stick for the projector.`);
    } catch (err) {
      toast('Export failed: ' + err.message);
    }
  }

  // ---------- looping video ----------
  const VIDEO_TYPES = [
    ['video/mp4;codecs=avc1.640033', 'mp4'],
    ['video/mp4;codecs=avc1.4d0033', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  const pickVideoType = () => (window.MediaRecorder ? VIDEO_TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) : null);

  let recording = null; // { cancel() }

  function openVideoDialog() {
    if (!project.layers.some((l) => l.visible)) return toast('Nothing to export yet. Add a layer first.');
    const type = pickVideoType();
    if (!type) return toast('This browser cannot record video. Try the latest Chrome or Edge.');
    const longest = Math.max(0, ...project.layers
      .filter((l) => l.visible && l.type === 'video')
      .map((l) => stageEl.querySelector(`.layer[data-id="${l.id}"] video`)?.duration || 0)
      .filter(Number.isFinite));
    $('#vidSecs').value = longest ? Math.round(longest * 10) / 10 : 10;
    $('#vidInfo').innerHTML = `Output: <b>${project.width} × ${project.height}</b>, <b>${type[1].toUpperCase()}</b>` +
      (type[1] === 'mp4' ? '' : '<br>This browser can\'t record MP4, so the video will be WebM. Most Android projectors play WebM. If yours doesn\'t, convert it with a free tool such as HandBrake.') +
      (longest ? `<br>The length is set to your longest video (${longest.toFixed(1)} s) so the loop is seamless.` : '<br>Your mapping has no moving layers. A PNG may be simpler, unless your projector can\'t loop a photo.') +
      '<br>Recording runs in real time, so keep this tab visible until it finishes.';
    $('#vidBar').style.width = '0';
    $('#vidStatus').textContent = '';
    $('#vidStart').disabled = false;
    $('#videoDlg').hidden = false;
  }

  async function recordVideo() {
    const secs = Math.min(600, Math.max(1, parseFloat($('#vidSecs').value) || 10));
    const fps = +$('#vidFps').value || 30;
    const [mimeType, ext] = pickVideoType();
    const W = project.width, H = project.height;
    $('#vidStart').disabled = true;
    $('#vidStatus').textContent = 'Preparing…';
    let items;
    let stopped = false;
    try {
      const warper = createWarper(W, H);
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d');
      items = await prepareLayers(true);
      const videos = items.filter((i) => i.video).map((i) => i.video);

      // Start every video from the beginning together, so the loop lines up.
      await Promise.all(videos.map((v) => new Promise((r) => {
        if (v.currentTime === 0) return r();
        v.onseeked = r;
        v.currentTime = 0;
      })));
      composeFrame(ctx, warper, items);
      await Promise.all(videos.map((v) => v.play().catch(() => {})));

      const stream = out.captureStream(fps);
      const pixels = W * H;
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.round(Math.min(40e6, Math.max(8e6, pixels * fps * 0.15))) });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(1000);
      const t0 = performance.now();

      recording = { cancel() { stopped = true; } };
      let frames = 0;
      await new Promise((resolve) => {
        const tick = () => {
          const t = (performance.now() - t0) / 1000;
          if (stopped || t >= secs) return resolve();
          composeFrame(ctx, warper, items);
          frames++;
          $('#vidBar').style.width = `${(t / secs) * 100}%`;
          $('#vidStatus').textContent = `Recording… ${Math.ceil(secs - t)} s left`;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Hold the last frame briefly so the file is the full length.
      composeFrame(ctx, warper, items);
      await new Promise((r) => setTimeout(r, 1000 / fps + 50));
      rec.stop();
      await done;
      const achieved = frames / secs;
      stream.getTracks().forEach((t) => t.stop());
      if (stopped) {
        $('#vidStatus').textContent = 'Cancelled';
      } else {
        download(new Blob(chunks, { type: mimeType.split(';')[0] }), `projector-mapping-${W}x${H}-${stamp()}.${ext}`);
        $('#vidBar').style.width = '100%';
        $('#vidStatus').textContent = 'Done. Copy the video to a USB stick and set the projector\'s player to repeat.' +
          (achieved < fps * 0.8 ? ` Note: this computer only managed about ${Math.round(achieved)} fps, so motion may look choppy. Try a lower frame rate, or close other apps and record again.` : '');
      }
    } catch (err) {
      $('#vidStatus').textContent = 'Export failed: ' + err.message;
    } finally {
      items?.forEach((i) => { if (i.video) { i.video.pause(); i.video.removeAttribute('src'); i.video.load(); } });
      recording = null;
      $('#vidStart').disabled = false;
    }
  }

  $('#vidStart').addEventListener('click', recordVideo);
  $('#vidCancel').addEventListener('click', () => {
    if (recording) recording.cancel();
    else $('#videoDlg').hidden = true;
  });

  // ======================================================================
  // Commands, keyboard, files
  // ======================================================================
  function run(cmd) {
    const [name, arg] = cmd.split(':');
    switch (name) {
      case 'shape': return addShape(arg);
      case 'text': return addText();
      case 'mode': mode = arg; activeCorner = null; renderToolbar(); return drawOverlay();
      case 'undo': return undo();
      case 'redo': return redo();
      case 'grid': project.grid = !project.grid; return commit();
      case 'up': return moveLayer(1);
      case 'down': return moveLayer(-1);
      case 'dup': return duplicate();
      case 'del': return remove();
      case 'output': return openOutput();
      case 'present': return setPresenting(true, true);
      case 'export': return exportProject();
      case 'png': return exportPNG();
      case 'video': return openVideoDialog();
      case 'new':
        if (!confirm('Clear all layers and start a new project?')) return;
        project = { ...defaultProject(), width: project.width, height: project.height };
        selectedId = null;
        return commit();
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) run(b.dataset.cmd);
  });

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const presenting = document.body.classList.contains('presenting');
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'Escape') { if (presenting) setPresenting(false); else { selectedId = null; activeCorner = null; renderAll(); } return; }
    if (k === 'h' || k === 'H') { setPresenting(!presenting, false); return; }
    if (k === 'p' || k === 'P') { setPresenting(!presenting, !presenting); return; }
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicate(); return; }
    if (mod) return;
    if (k === 'g' || k === 'G') return run('grid');
    if (presenting) return;
    if (k === 'v' || k === 'V') return run('mode:transform');
    if (k === 'w' || k === 'W') return run('mode:warp');
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return remove(); }
    if (k === ']') return moveLayer(1);
    if (k === '[') return moveLayer(-1);
    if (mode === 'warp' && sel() && '1234'.includes(k)) { activeCorner = +k - 1; return drawOverlay(); }
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[k] && sel()) { e.preventDefault(); nudge(...arrows[k]); }
  });

  $('#fileInput').addEventListener('change', async (e) => {
    for (const f of e.target.files) await addMediaFile(f);
    e.target.value = '';
  });
  $('#importInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importProject(e.target.files[0]);
    e.target.value = '';
  });

  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drop'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    viewport.classList.remove('drop');
    const at = toStage(e);
    for (const f of e.dataTransfer.files) {
      if (f.name.endsWith('.json')) await importProject(f);
      else await addMediaFile(f, at);
    }
  });
  document.addEventListener('paste', async (e) => {
    if (isTyping(e.target)) return;
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f) await addMediaFile(f); }
    }
  });

  window.addEventListener('resize', fitEditor);
  window.addEventListener('beforeunload', () => {
    DB.put('kv', 'project', committed);
    if (output && !output.win.closed) output.win.close();
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  // ======================================================================
  // Boot
  // ======================================================================
  (async () => {
    await DB.open();
    try {
      const saved = await DB.get('kv', 'project');
      if (saved) {
        project = { ...defaultProject(), ...JSON.parse(saved) };
        committed = JSON.stringify(project);
      }
      for (const id of (await DB.keys('media')) || []) {
        const rec = await DB.get('media', id);
        if (rec?.blob) media.set(id, { url: URL.createObjectURL(rec.blob), type: rec.type });
      }
    } catch (err) {
      console.warn('Could not restore the saved project', err);
    }
    syncOutputInputs();
    fitEditor();
    renderAll();
  })();
})();
