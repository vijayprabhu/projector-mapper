/* Present mode: use this browser window as the output (hide the editor UI,
 * optionally fullscreen). */
(function (PM) {
  'use strict';

  const isOn = () => document.body.classList.contains('presenting');

  function set(on, fullscreen) {
    document.body.classList.toggle('presenting', on);
    if (on && fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(PM.editor.fitEditor);
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isOn()) set(false);
    else requestAnimationFrame(PM.editor.fitEditor);
  });

  PM.present = { set, isOn };
})(window.PM);
