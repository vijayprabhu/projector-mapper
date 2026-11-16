/* Renderer: syncs PM.state.project into a stage element as warped .layer
 * elements. One instance drives the editor stage, another the output window.
 *
 * Layer CSS (including .layer.cropped / .layer.spinning clipping and the
 * pm-spin keyframes) must exist in both css/style.css and the output window's
 * inline styles (output/output-window.js).
 */
(function (PM) {
  'use strict';

  const { Geo, Spin, Crop } = PM;
  const { contentKey, buildContent, gridSVG } = PM.content;
  const S = PM.state;

  class Renderer {
    constructor(stage) {
      this.stage = stage;
      this.doc = stage.ownerDocument;
      this.els = new Map();
      this.gridKey = null;
      this.grid = null;
    }

    sync() {
      const { stage, doc } = this;
      const { project } = S;
      stage.style.width = project.width + 'px';
      stage.style.height = project.height + 'px';
      stage.style.background = project.background;

      const live = new Set();
      project.layers.forEach((L, i) => {
        live.add(L.id);
        let rec = this.els.get(L.id);
        if (!rec) {
          const el = doc.createElement('div');
          el.className = 'layer';
          el.dataset.id = L.id;
          stage.appendChild(el);
          rec = { el, key: null };
          this.els.set(L.id, rec);
        }
        const key = contentKey(L);
        if (rec.key !== key) { buildContent(rec.el, L, doc); rec.key = key; rec.styleKey = null; }
        this.applyEffects(rec, L);
        const s = rec.el.style;
        s.width = L.w + 'px';
        s.height = L.h + 'px';
        const m = Geo.homography(L.w, L.h, L.corners);
        s.transform = m || 'scale(0)';
        s.opacity = L.opacity;
        s.mixBlendMode = L.blend || 'normal';
        s.zIndex = i + 1;
        s.display = L.visible ? '' : 'none';
        s.pointerEvents = L.locked ? 'none' : '';
      });
      for (const [id, rec] of this.els) {
        if (!live.has(id)) { rec.el.remove(); this.els.delete(id); }
      }
      this.syncGrid();
    }

    /** Crop and spin styles, updated only when they change. */
    applyEffects(rec, L) {
      const crop = Crop.active(L) ? Crop.of(L) : null;
      const styleKey = [Spin.rpm(L), !!L.spinCcw, crop && [crop.x, crop.y, crop.w, crop.h, crop.shape].join(',')].join('|');
      if (rec.styleKey === styleKey) return;
      const anim = Spin.css(L);
      for (const child of rec.el.children) {
        const cs = child.style;
        cs.animation = anim;
        if (crop) {
          // Show only the cropped part: scale the content up and shift it, and spin about the crop's centre.
          Object.assign(cs, {
            position: 'absolute',
            width: `${100 / crop.w}%`, height: `${100 / crop.h}%`,
            left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`,
            transformOrigin: `${(crop.x + crop.w / 2) * 100}% ${(crop.y + crop.h / 2) * 100}%`,
            maxWidth: 'none',
          });
        } else {
          ['position', 'width', 'height', 'left', 'top', 'transformOrigin', 'maxWidth'].forEach((p) => { cs[p] = ''; });
        }
      }
      rec.el.classList.toggle('spinning', !!anim);
      rec.el.classList.toggle('cropped', !!crop);
      rec.el.style.clipPath = crop && crop.shape === 'circle' ? 'ellipse(50% 50% at 50% 50%)' : '';
      rec.styleKey = styleKey;
    }

    syncGrid() {
      const { project } = S;
      const gk = project.grid ? `${project.width}x${project.height}` : null;
      if (gk === this.gridKey) return;
      this.grid?.remove();
      this.grid = null;
      if (gk) {
        const t = this.doc.createElement('div');
        t.innerHTML = gridSVG(project.width, project.height);
        this.grid = t.firstElementChild;
        this.stage.appendChild(this.grid);
      }
      this.gridKey = gk;
    }
  }

  /** Scale and centre a stage inside a vw × vh viewport. Returns the scale. */
  function fitStage(stage, vw, vh, pad) {
    const { width, height } = S.project;
    const s = Math.min((vw - pad * 2) / width, (vh - pad * 2) / height);
    const x = (vw - width * s) / 2, y = (vh - height * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    return s;
  }

  PM.Renderer = Renderer;
  PM.fitStage = fitStage;
})(window.PM);
