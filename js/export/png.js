/* PNG export: one still image of the mapping at output resolution. */
(function (PM) {
  'use strict';

  const S = PM.state;
  const toast = (msg) => PM.ui.toast(msg);

  async function run() {
    if (!S.project.layers.some((l) => l.visible)) return toast('Nothing to export yet. Add a layer first.');
    toast('Rendering image…');
    try {
      const { createWarper, prepareLayers, composeFrame, download, stamp } = PM.exporter;
      const W = S.project.width, H = S.project.height;
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

  PM.pngExport = { run };
})(window.PM);
