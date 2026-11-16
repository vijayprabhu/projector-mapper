/* Toast: short status messages at the bottom of the window. */
(function (PM) {
  'use strict';

  const { $ } = PM.util;
  let timer;

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  PM.ui = PM.ui || {};
  PM.ui.toast = toast;
})(window.PM);
