/* Projector Mapper: application wiring. Loaded last.
 *
 * Connects the modules: event → render wiring, toolbar commands (data-cmd),
 * keyboard shortcuts, file input / drag & drop / paste, and start-up.
 * See index.html for the module load order and PM.events in core/namespace.js.
 */
(function (PM) {
  'use strict';

  const { DB, store, events, layers, editor, panel } = PM;
  const { $, isTyping } = PM.util;
  const S = PM.state;

  // ---------- rendering ----------
  function renderAll() {
    editor.renderStage();
    panel.renderLayerList();
    panel.renderProps();
    editor.renderToolbar();
  }

  events.on('change', renderAll);
  events.on('preview', editor.renderStage);
  events.on('restore', () => {
    panel.syncOutputInputs();
    editor.fitEditor();
    renderAll();
  });

  // ---------- toolbar commands ----------
  function run(cmd) {
    const [name, arg] = cmd.split(':');
    switch (name) {
      case 'shape': return layers.addShape(arg);
      case 'text': return layers.addText();
      case 'mode':
        S.mode = arg;
        S.activeCorner = null;
        editor.renderToolbar();
        return editor.drawOverlay();
      case 'undo': return store.undo();
      case 'redo': return store.redo();
      case 'grid': S.project.grid = !S.project.grid; return store.commit();
      case 'up': return layers.moveLayer(1);
      case 'down': return layers.moveLayer(-1);
      case 'dup': return layers.duplicate();
      case 'del': return layers.remove();
      case 'output': return PM.output.open();
      case 'present': return PM.present.set(true, true);
      case 'export': return PM.projectFile.save();
      case 'png': return PM.pngExport.run();
      case 'video': return PM.videoExport.openDialog();
      case 'new':
        if (!confirm('Clear all layers and start a new project?')) return;
        S.project = { ...store.defaultProject(), width: S.project.width, height: S.project.height };
        store.select(null);
        return store.commit();
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) run(b.dataset.cmd);
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (PM.cropDialog.isOpen()) { if (e.key === 'Escape') PM.cropDialog.close(); return; }
    const presenting = PM.present.isOn();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'Escape') { if (presenting) PM.present.set(false); else { store.select(null); renderAll(); } return; }
    if (k === 'h' || k === 'H') { PM.present.set(!presenting, false); return; }
    if (k === 'p' || k === 'P') { PM.present.set(!presenting, !presenting); return; }
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); store.redo(); return; }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); layers.duplicate(); return; }
    if (mod) return;
    if (k === 'g' || k === 'G') return run('grid');
    if (presenting) return;
    if (k === 'v' || k === 'V') return run('mode:transform');
    if (k === 'w' || k === 'W') return run('mode:warp');
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return layers.remove(); }
    if (k === ']') return layers.moveLayer(1);
    if (k === '[') return layers.moveLayer(-1);
    if (S.mode === 'warp' && store.sel() && '1234'.includes(k)) { S.activeCorner = +k - 1; return editor.drawOverlay(); }
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[k] && store.sel()) { e.preventDefault(); layers.nudge(...arrows[k]); }
  });

  // ---------- files: picker, drag & drop, paste ----------
  $('#fileInput').addEventListener('change', async (e) => {
    for (const f of e.target.files) await layers.addMediaFile(f);
    e.target.value = '';
  });
  $('#importInput').addEventListener('change', (e) => {
    if (e.target.files[0]) PM.projectFile.open(e.target.files[0]);
    e.target.value = '';
  });

  const { viewport } = editor;
  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drop'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    viewport.classList.remove('drop');
    const at = editor.toStage(e);
    for (const f of e.dataTransfer.files) {
      if (f.name.endsWith('.json')) await PM.projectFile.open(f);
      else await layers.addMediaFile(f, at);
    }
  });
  document.addEventListener('paste', async (e) => {
    if (isTyping(e.target)) return;
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f) await layers.addMediaFile(f); }
    }
  });

  // ---------- window ----------
  window.addEventListener('resize', editor.fitEditor);
  window.addEventListener('beforeunload', () => {
    store.flush();
    PM.output.close();
  });

  // ---------- boot: restore the autosaved project and media ----------
  (async () => {
    await DB.open();
    try {
      const saved = await DB.get('kv', 'project');
      if (saved) store.load(saved);
      for (const id of (await DB.keys('media')) || []) {
        const rec = await DB.get('media', id);
        if (rec?.blob) store.media.set(id, { url: URL.createObjectURL(rec.blob), type: rec.type });
      }
    } catch (err) {
      console.warn('Could not restore the saved project', err);
    }
    panel.syncOutputInputs();
    editor.fitEditor();
    renderAll();
  })();
})(window.PM);
