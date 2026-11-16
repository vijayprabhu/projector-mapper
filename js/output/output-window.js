/* Output window: a pop-up the user drags onto the projector. It has its own
 * Renderer and follows the editor on every 'render' event.
 *
 * The pop-up's document and styles are written here. Layer CSS must match
 * css/style.css (clipping for .layer.cropped / .layer.spinning, pm-spin keyframes).
 */
(function (PM) {
  'use strict';

  const { Renderer, fitStage, events } = PM;

  let output = null; // { win, renderer, fit }

  const STYLE = `
    html,body{margin:0;height:100%;background:#000;overflow:hidden}
    body.idle{cursor:none}
    #stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
    .layer{position:absolute;left:0;top:0;transform-origin:0 0}
    .layer>img,.layer>video,.layer>svg{display:block;width:100%;height:100%}
    .layer>.text{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;line-height:1.1;overflow:hidden}
    .layer{pointer-events:none!important}
    .layer.spinning,.layer.cropped{overflow:hidden}
    .layer>*{transform-origin:50% 50%}
    @keyframes pm-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .grid-overlay{position:absolute;left:0;top:0;pointer-events:none;z-index:100000}
    #hint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:16px system-ui,sans-serif;color:#fff;
      background:rgba(0,0,0,.75);border:1px solid #555;padding:16px 22px;border-radius:10px;text-align:center;z-index:999999;transition:opacity .5s;pointer-events:none}`;

  function open() {
    const win = window.open('', 'projector-mapper-output', 'width=960,height=540');
    if (!win) { PM.ui.toast('Pop-up blocked. Allow pop-ups for this page and try again.'); return; }
    const d = win.document;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Projector Output</title>
      <style>${STYLE}</style></head>
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

  function isOpen() {
    if (output && output.win.closed) output = null;
    return !!output;
  }

  /** Documents other than the editor's that show layers (for restarting videos). */
  const documents = () => (isOpen() ? [output.win.document] : []);

  function close() { if (isOpen()) output.win.close(); }

  events.on('render', () => {
    if (!isOpen()) return;
    output.renderer.sync();
    output.fit();
  });

  PM.output = { open, close, documents };
})(window.PM);
