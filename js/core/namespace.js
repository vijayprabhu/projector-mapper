/* Projector Mapper: shared namespace, small helpers and the event bus.
 *
 * The app is split into plain (non-module) scripts so that it still works when
 * index.html is opened from disk (file://), where ES modules are blocked. Every
 * script adds its part to the global `PM` namespace and must be loaded in the
 * order listed in index.html. This file is always loaded first.
 *
 * Events (PM.events) keep the lower layers independent of the UI:
 *   change   state changed (commit, selection): re-render everything
 *   preview  layer geometry changed live, not committed yet: re-render the stage only
 *   restore  the whole project was replaced (undo/redo, open, boot): re-sync inputs and refit
 *   render   the editor stage was just synced: other views (output window) follow
 */
(function () {
  'use strict';

  const PM = (window.PM = window.PM || {});

  PM.util = {
    $: (s, r = document) => r.querySelector(s),
    uid: () => Math.random().toString(36).slice(2, 10),
    clone: (o) => JSON.parse(JSON.stringify(o)),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    isTyping: (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable),
  };

  const handlers = {};
  PM.events = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit(name, ...args) { (handlers[name] || []).forEach((fn) => fn(...args)); },
  };
})();
