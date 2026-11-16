/* State: the project model, editor selection, undo/redo history, autosave and
 * the media cache.
 *
 * PM.state holds the mutable state. Always read it through PM.state, because
 * `project` is replaced on undo/redo/open:
 *   project       { version, width, height, background, grid, layers[] }
 *   selectedId    id of the selected layer, or null
 *   mode          'transform' | 'warp'
 *   activeCorner  corner index chosen for keyboard nudging in warp mode
 *
 * Mutate PM.state.project, then call PM.store.commit(). It records an undo step,
 * schedules the autosave and emits 'change'.
 */
(function (PM) {
  'use strict';

  const { DB, events } = PM;

  const defaultProject = () => ({ version: 1, width: 1920, height: 1080, background: '#000000', grid: false, layers: [] });

  const S = {
    project: defaultProject(),
    selectedId: null,
    mode: 'transform',
    activeCorner: null,
  };

  /** mediaId -> { url, type }: object URLs for the media blobs in IndexedDB. */
  const media = new Map();

  const sel = () => S.project.layers.find((l) => l.id === S.selectedId) || null;
  const findLayer = (id) => S.project.layers.find((l) => l.id === id) || null;
  function select(id) {
    S.selectedId = id;
    S.activeCorner = null;
  }

  // ---------- history ----------
  let undoStack = [], redoStack = [], committed = JSON.stringify(S.project);

  function commit() {
    const s = JSON.stringify(S.project);
    if (s === committed) return;
    undoStack.push(committed);
    if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    committed = s;
    scheduleSave();
    events.emit('change');
  }

  function restore(s) {
    committed = s;
    S.project = JSON.parse(s);
    if (!sel()) S.selectedId = null;
    scheduleSave();
    events.emit('restore');
  }
  function undo() { if (undoStack.length) { redoStack.push(committed); restore(undoStack.pop()); } }
  function redo() { if (redoStack.length) { undoStack.push(committed); restore(redoStack.pop()); } }

  /** Replace the whole project as one undoable step (used when opening a file). */
  function replaceProject(p) {
    undoStack.push(committed);
    redoStack = [];
    S.project = { ...defaultProject(), ...p };
    select(null);
    committed = JSON.stringify(S.project);
    scheduleSave();
    events.emit('restore');
  }

  /** Load the autosaved project at start-up (no undo step, no events). */
  function load(json) {
    S.project = { ...defaultProject(), ...JSON.parse(json) };
    committed = JSON.stringify(S.project);
  }

  // ---------- autosave ----------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.put('kv', 'project', committed).catch(() => {});
      gcMedia();
    }, 400);
  }
  /** Save right away (on page unload). */
  function flush() { DB.put('kv', 'project', committed); }

  /** Delete media blobs that no layer, undo state or redo state uses any more.
   *  It scans the JSON for "mediaId":"…", so keep that key name. */
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

  PM.state = S;
  PM.store = { defaultProject, media, sel, findLayer, select, commit, undo, redo, replaceProject, load, flush };
})(window.PM);
