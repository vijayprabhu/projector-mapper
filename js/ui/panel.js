/* Side panel: layer list, layer properties and output settings.
 *
 * Property inputs use data-prop (with data-num / data-bool / data-bool-sel to
 * coerce the value), position/size inputs use data-bbox, and buttons use
 * data-act (PM.layers.ACTIONS or the special cases in the click handler).
 */
(function (PM) {
  'use strict';

  const { Geo, Spin, Crop, store, events } = PM;
  const { $, esc } = PM.util;
  const { SHAPE_NAMES, ACTIONS } = PM.layers;
  const S = PM.state;

  const ICON = { image: '🖼', video: '🎞', text: 'T', shape: '◆' };
  const BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'difference', 'color-dodge', 'hard-light', 'soft-light'];
  const FONTS = ['system-ui, sans-serif', 'Georgia, serif', 'Impact, sans-serif', '"Courier New", monospace', '"Comic Sans MS", cursive', 'Arial Black, sans-serif'];

  // ---------- layer list ----------
  function renderLayerList() {
    const ul = $('#layerList');
    const { layers } = S.project;
    if (!layers.length) { ul.innerHTML = '<li class="empty">No layers yet</li>'; return; }
    ul.innerHTML = [...layers].reverse().map((L) => `
      <li data-id="${L.id}" class="${L.id === S.selectedId ? 'sel' : ''} ${L.visible ? '' : 'hidden'}">
        <span class="ico">${L.type === 'shape' ? `<span style="color:${esc(L.fill)}">◆</span>` : ICON[L.type]}</span>
        <span class="name" title="${esc(L.name)}">${esc(L.name)}</span>
        <button class="tog ${L.visible ? 'on' : ''}" data-tog="visible" title="Show / hide">${L.visible ? '👁' : '—'}</button>
        <button class="tog ${L.locked ? 'on' : ''}" data-tog="locked" title="Lock">${L.locked ? '🔒' : '🔓'}</button>
      </li>`).join('');
  }

  $('#layerList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const L = store.findLayer(li.dataset.id);
    const tog = e.target.closest('[data-tog]');
    if (tog) { L[tog.dataset.tog] = !L[tog.dataset.tog]; store.commit(); return; }
    store.select(L.id);
    events.emit('change');
  });

  $('#layerList').addEventListener('dblclick', (e) => {
    const li = e.target.closest('li[data-id]');
    const L = li && store.findLayer(li.dataset.id);
    if (!L) return;
    const name = prompt('Layer name', L.name);
    if (name != null && name.trim()) { L.name = name.trim(); store.commit(); }
  });

  // ---------- properties ----------
  function renderProps() {
    const box = $('#props');
    const L = store.sel();
    if (!L) {
      box.innerHTML = '<h3>Properties</h3><p class="muted">Select a layer to edit it.</p>';
      return;
    }
    const bb = Geo.bbox(L.corners);
    const r = (v) => Math.round(v);
    let html = `<h3>Properties: ${esc(L.type)}</h3>
      <div class="row"><label>Name</label><input type="text" data-prop="name" value="${esc(L.name)}"></div>
      <div class="row"><label>Position</label>
        X <input type="number" data-bbox="x" value="${r(bb.x)}"> Y <input type="number" data-bbox="y" value="${r(bb.y)}"></div>
      <div class="row"><label>Size</label>
        W <input type="number" min="1" data-bbox="w" value="${r(bb.w)}"> H <input type="number" min="1" data-bbox="h" value="${r(bb.h)}"></div>
      <div class="row"><label>Opacity</label><input type="range" min="0" max="1" step="0.01" data-prop="opacity" data-num value="${L.opacity}"></div>
      <div class="row"><label>Blend</label><select data-prop="blend">${BLENDS.map((b) => `<option ${b === L.blend ? 'selected' : ''}>${b}</option>`).join('')}</select></div>`;

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
      <div class="row"><label>Font</label><select data-prop="fontFamily">${FONTS
        .map((f) => `<option value='${esc(f)}' ${f === L.fontFamily ? 'selected' : ''}>${esc(f.split(',')[0].replace(/"/g, ''))}</option>`).join('')}</select></div>`;
    }
    if (Crop.canCrop(L)) {
      const c = Crop.of(L);
      const label = !Crop.active(L) ? 'none' : c.shape === 'circle' ? 'circle' : c.mode === 'square' ? '1:1' : 'free';
      html += `
      <div class="row"><label>Crop</label>
        <button class="btn sm" data-act="crop" title="Crop to free form, 1:1 or a circle">Crop…</button>
        ${Crop.active(L) ? '<button class="btn sm" data-act="uncrop" title="Show the whole picture again">Remove crop</button>' : ''}
        <span class="muted">${label}</span></div>`;
    }
    html += `
      <div class="row"><label>Spin</label>
        <input type="number" min="0" max="600" step="1" data-prop="spin" data-num value="${Spin.rpm(L)}" title="Rotations per minute (0 = off)"> rpm
        <select data-prop="spinCcw" data-bool-sel title="Direction: clockwise or anticlockwise">
          <option value="" ${L.spinCcw ? '' : 'selected'}>↻ CW</option>
          <option value="1" ${L.spinCcw ? 'selected' : ''}>↺ CCW</option>
        </select></div>`;
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
    if (t.hasAttribute('data-bool-sel')) return !!t.value;
    if (t.hasAttribute('data-num')) return parseFloat(t.value) || 0;
    return t.value;
  }
  props.addEventListener('input', (e) => {
    const t = e.target, L = store.sel();
    if (!L || !t.dataset.prop) return;
    L[t.dataset.prop] = readProp(t);
    events.emit('preview');
  });
  props.addEventListener('change', (e) => {
    const t = e.target, L = store.sel();
    if (!L) return;
    if (t.dataset.prop) {
      L[t.dataset.prop] = readProp(t);
      if (t.dataset.prop === 'name' && !L.name.trim()) L.name = 'Layer';
      if (t.dataset.prop === 'spin') L.spin = Math.min(600, Math.max(0, L.spin));
      store.commit();
    } else if (t.dataset.bbox) {
      const bb = Geo.bbox(L.corners);
      const nb = { ...bb, [t.dataset.bbox]: parseFloat(t.value) };
      if (!(nb[t.dataset.bbox] === nb[t.dataset.bbox])) return renderProps();
      nb.w = Math.max(1, nb.w); nb.h = Math.max(1, nb.h);
      L.corners = L.corners.map(([x, y]) => [
        nb.x + (bb.w ? ((x - bb.x) / bb.w) * nb.w : 0),
        nb.y + (bb.h ? ((y - bb.y) / bb.h) * nb.h : 0),
      ]);
      store.commit();
    }
  });
  props.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'), L = store.sel();
    if (!b || !L) return;
    const act = b.dataset.act;
    if (act === 'crop') return PM.cropDialog.open(L);
    if (act === 'uncrop') { Crop.apply(L, null); return store.commit(); }
    if (act === 'restart') {
      for (const doc of [document, ...PM.output.documents()]) {
        doc.querySelectorAll(`.layer[data-id="${L.id}"] video`).forEach((v) => { v.currentTime = 0; v.play().catch(() => {}); });
      }
      return;
    }
    ACTIONS[act](L);
    store.commit();
  });

  // ---------- output settings ----------
  function syncOutputInputs() {
    $('#outW').value = S.project.width;
    $('#outH').value = S.project.height;
    $('#bgColor').value = S.project.background;
  }
  function setResolution(w, h) {
    w = Math.round(w); h = Math.round(h);
    if (!(w >= 100 && h >= 100 && w <= 8192 && h <= 8192)) { syncOutputInputs(); return; }
    S.project.width = w; S.project.height = h;
    store.commit();
    PM.editor.fitEditor();
    syncOutputInputs();
  }
  $('#outW').addEventListener('change', () => setResolution(+$('#outW').value, S.project.height));
  $('#outH').addEventListener('change', () => setResolution(S.project.width, +$('#outH').value));
  $('#resPreset').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    if (w && h) setResolution(w, h);
    e.target.value = '';
  });
  $('#bgColor').addEventListener('input', (e) => { S.project.background = e.target.value; events.emit('preview'); });
  $('#bgColor').addEventListener('change', () => store.commit());

  PM.panel = { renderLayerList, renderProps, syncOutputInputs };
})(window.PM);
