/* Project file: save / open the editable project as one JSON file,
 * { app: 'projector-mapper', project, media: { mediaId: { type, name, data } } },
 * with the media embedded as data URLs.
 */
(function (PM) {
  'use strict';

  const { DB, store } = PM;
  const S = PM.state;
  const toast = (msg) => PM.ui.toast(msg);

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

  async function save() {
    toast('Preparing export…');
    const { project } = S;
    const out = { app: 'projector-mapper', project, media: {} };
    for (const L of project.layers) {
      if (!L.mediaId || out.media[L.mediaId]) continue;
      const rec = await DB.get('media', L.mediaId);
      if (rec) out.media[L.mediaId] = { type: rec.type, name: rec.name, data: await blobToDataURL(rec.blob) };
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    PM.exporter.download(blob, `projector-mapping-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Project exported');
  }

  async function open(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data.project || !Array.isArray(data.project.layers)) throw new Error('Not a Projector Mapper file');
      for (const [id, m] of Object.entries(data.media || {})) {
        const blob = dataURLToBlob(m.data);
        await DB.put('media', id, { blob, type: m.type, name: m.name }).catch(() => {});
        if (store.media.has(id)) URL.revokeObjectURL(store.media.get(id).url);
        store.media.set(id, { url: URL.createObjectURL(blob), type: m.type });
      }
      store.replaceProject(data.project);
      toast('Project imported');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  }

  PM.projectFile = { save, open };
})(window.PM);
