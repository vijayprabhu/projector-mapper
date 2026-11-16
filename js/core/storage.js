/* Storage: IndexedDB "projector-mapper".
 *   kv     key "project" → the committed project JSON (autosave)
 *   media  mediaId → { blob, type, name } for images and videos
 * Every call resolves to null (instead of failing) when IndexedDB is unavailable.
 */
(function (PM) {
  'use strict';

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
        req.onsuccess = () => { DB.db = req.result; res(DB.db); };
        req.onerror = () => res(null);
      });
    },
    tx(store, mode, fn) {
      if (!DB.db) return Promise.resolve(null);
      return new Promise((res, rej) => {
        const t = DB.db.transaction(store, mode);
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

  PM.DB = DB;
})(window.PM);
