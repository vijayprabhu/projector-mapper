/* Video export: records a looping MP4 (or WebM) of the mapping in real time,
 * using the export pipeline per frame with captureStream + MediaRecorder.
 */
(function (PM) {
  'use strict';

  const { Spin } = PM;
  const { $ } = PM.util;
  const S = PM.state;
  const toast = (msg) => PM.ui.toast(msg);

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

  function openDialog() {
    const { project } = S;
    if (!project.layers.some((l) => l.visible)) return toast('Nothing to export yet. Add a layer first.');
    const type = pickVideoType();
    if (!type) return toast('This browser cannot record video. Try the latest Chrome or Edge.');
    const longest = Math.max(0, ...project.layers
      .filter((l) => l.visible && l.type === 'video')
      .map((l) => PM.editor.stageEl.querySelector(`.layer[data-id="${l.id}"] video`)?.duration || 0)
      .filter(Number.isFinite));
    const spinLoop = spinLoopSeconds();
    $('#vidSecs').value = longest ? Math.round(longest * 10) / 10 : spinLoop || 10;
    $('#vidInfo').innerHTML = `Output: <b>${project.width} × ${project.height}</b>, <b>${type[1].toUpperCase()}</b>` +
      (type[1] === 'mp4' ? '' : '<br>This browser can\'t record MP4, so the video will be WebM. Most Android projectors play WebM. If yours doesn\'t, convert it with a free tool such as HandBrake.') +
      (longest ? `<br>The length is set to your longest video (${longest.toFixed(1)} s) so the loop is seamless.` +
        (spinLoop ? ` Spinning layers loop seamlessly when the length is a multiple of ${spinLoop} s.` : '')
        : spinLoop ? `<br>The length is set to ${spinLoop} s so every spinning layer completes whole turns and the loop is seamless.`
        : '<br>Your mapping has no moving layers. A PNG may be simpler, unless your projector can\'t loop a photo.') +
      '<br>Recording runs in real time, so keep this tab visible until it finishes.';
    $('#vidBar').style.width = '0';
    $('#vidStatus').textContent = '';
    $('#vidStart').disabled = false;
    $('#videoDlg').hidden = false;
  }

  /** Shortest length (s) in which every spinning layer completes whole turns, or 0 if none / too long. */
  function spinLoopSeconds() {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    let lcm = 0; // in milliseconds
    for (const L of S.project.layers) {
      if (!L.visible || !Spin.rpm(L)) continue;
      const ms = Math.round(Spin.period(L) * 1000);
      lcm = lcm ? (lcm / gcd(lcm, ms)) * ms : ms;
      if (lcm > 600000) return 0;
    }
    if (!lcm) return 0;
    // Very short loops are fine for the projector, but give it a few turns.
    let secs = lcm / 1000;
    while (secs < 5) secs += lcm / 1000;
    return Math.round(secs * 1000) / 1000;
  }

  async function record() {
    const { createWarper, prepareLayers, composeFrame, download, stamp } = PM.exporter;
    const secs = Math.min(600, Math.max(1, parseFloat($('#vidSecs').value) || 10));
    const fps = +$('#vidFps').value || 30;
    const [mimeType, ext] = pickVideoType();
    const W = S.project.width, H = S.project.height;
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
      composeFrame(ctx, warper, items, 0);
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
          composeFrame(ctx, warper, items, t);
          frames++;
          $('#vidBar').style.width = `${(t / secs) * 100}%`;
          $('#vidStatus').textContent = `Recording… ${Math.ceil(secs - t)} s left`;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Hold the last frame briefly so the file is the full length.
      composeFrame(ctx, warper, items, secs);
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

  $('#vidStart').addEventListener('click', record);
  $('#vidCancel').addEventListener('click', () => {
    if (recording) recording.cancel();
    else $('#videoDlg').hidden = true;
  });

  PM.videoExport = { openDialog, spinLoopSeconds };
})(window.PM);
