/* Export pipeline: renders the mapping at full output resolution for the
 * projector's own media player (used by export/png.js and export/video.js).
 *
 *   prepareLayers()  a drawable source per visible layer (image, video, rasterised shape/text)
 *   layerFrame()     applies crop, circle clipping and spin on a 2D canvas
 *   createWarper()   WebGL2 perspective warp (inverse homography in a fragment shader)
 *   composeFrame()   composites the layers with opacity and blend modes
 *
 * This must mirror the DOM renderer (render/renderer.js): a new visual layer
 * feature needs implementing in both places.
 */
(function (PM) {
  'use strict';

  const { Geo, Spin, Crop, store } = PM;
  const { shapeSVG } = PM.content;
  const S = PM.state;

  function createWarper(W, H) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
    if (!gl) throw new Error('This browser does not support WebGL2. Try the latest Chrome or Edge.');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform mat3 Hi; uniform sampler2D tex; uniform float outH;
      out vec4 o;
      void main() {
        vec3 q = Hi * vec3(gl_FragCoord.x, outH - gl_FragCoord.y, 1.0);
        if (q.z <= 0.0) discard;
        vec2 uv = q.xy / q.z;
        // Anti-aliased edges: distance to the layer border in output pixels.
        vec2 e = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-6));
        float a = clamp(min(e.x, e.y) + 0.5, 0.0, 1.0);
        if (a <= 0.0) discard;
        o = texture(tex, clamp(uv, 0.0, 1.0)) * a;
      }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.viewport(0, 0, W, H);
    gl.uniform1f(gl.getUniformLocation(prog, 'outH'), H);
    const uHi = gl.getUniformLocation(prog, 'Hi');

    return {
      canvas,
      /** Draw `src` warped onto `corners`. Returns false if the quad is degenerate. */
      draw(src, corners) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const k = Geo.coeffs(corners);
        if (!k) return false;
        const [a, b, c, d, e, f, g, h] = k;
        // Invert M = [[a,b,c],[d,e,f],[g,h,1]] (output pixel -> uv).
        const A = e - f * h, B = f * g - d, C = d * h - e * g;
        const det = a * A + b * B + c * C;
        if (Math.abs(det) < 1e-12) return false;
        const inv = [
          [A, c * h - b, b * f - c * e],
          [B, a - c * g, c * d - a * f],
          [C, b * g - a * h, a * e - b * d],
        ].map((r) => r.map((v) => v / det));
        // Column-major for WebGL.
        gl.uniformMatrix3fv(uHi, false, [inv[0][0], inv[1][0], inv[2][0], inv[0][1], inv[1][1], inv[2][1], inv[0][2], inv[1][2], inv[2][2]]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
    };
  }

  const loadImage = (url) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not load an image'));
    i.src = url;
  });

  /** How much bigger than its base size a layer is drawn on the output (for crisp shapes/text). */
  function layerScale(L) {
    const c = L.corners;
    const horiz = Math.max(Geo.dist(c[0], c[1]), Geo.dist(c[3], c[2])) / L.w;
    const vert = Math.max(Geo.dist(c[0], c[3]), Geo.dist(c[1], c[2])) / L.h;
    return Math.min(Math.max(1, horiz, vert), 8192 / Math.max(L.w, L.h), 6);
  }

  function drawTextLayer(L, k) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(L.w * k));
    cv.height = Math.max(1, Math.round(L.h * k));
    const ctx = cv.getContext('2d');
    ctx.scale(k, k);
    ctx.font = `${L.bold ? 700 : 400} ${L.fontSize}px ${L.fontFamily}`;
    ctx.fillStyle = L.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = [];
    for (const para of String(L.text).split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const test = line + word;
        if (line && ctx.measureText(test).width > L.w) { lines.push(line.trimEnd()); line = word.trimStart(); } else line = test;
      }
      lines.push(line);
    }
    const lh = L.fontSize * 1.1;
    const top = L.h / 2 - (lines.length * lh) / 2 + lh / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, L.w / 2, top + i * lh));
    return cv;
  }

  /** Load a drawable source for every visible layer. Videos get their own element so they can be restarted. */
  async function prepareLayers(forVideo) {
    const items = [];
    for (const L of S.project.layers) {
      if (!L.visible) continue;
      const m = L.mediaId && store.media.get(L.mediaId);
      let src = null, video = null;
      if (L.type === 'image' && m) {
        src = await loadImage(m.url);
      } else if (L.type === 'video' && m) {
        video = document.createElement('video');
        Object.assign(video, { src: m.url, muted: true, loop: true, playsInline: true, preload: 'auto' });
        await new Promise((res, rej) => {
          video.onloadeddata = res;
          video.onerror = () => rej(new Error(`Could not load video "${L.name}"`));
        });
        if (!forVideo) {
          // For a still image, use the frame that is showing in the editor right now.
          const live = PM.editor.stageEl.querySelector(`.layer[data-id="${L.id}"] video`);
          video.currentTime = live ? live.currentTime : 0;
          await new Promise((r) => { video.onseeked = r; setTimeout(r, 1500); });
        }
        src = video;
      } else if (L.type === 'shape') {
        const k = layerScale(L);
        const svg = new Blob([shapeSVG(L)], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svg);
        try {
          const img = await loadImage(url);
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(L.w * k));
          cv.height = Math.max(1, Math.round(L.h * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          src = cv;
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (L.type === 'text') {
        src = drawTextLayer(L, layerScale(L));
      }
      if (src) items.push({ L, src, video });
    }
    return items;
  }

  /** Draw the layer's crop of `src`, rotated by `a` about the crop's centre and clipped
   *  to the layer's own box (and to a circle for a circular crop), like the preview. */
  function layerFrame(item, a) {
    const { L, src } = item;
    const crop = Crop.active(L) ? Crop.of(L) : Crop.FULL;
    const sw = (src.videoWidth || src.naturalWidth || src.width || L.w) * crop.w;
    const sh = (src.videoHeight || src.naturalHeight || src.height || L.h) * crop.h;
    let k = Math.max(sw / L.w, sh / L.h, 1);
    k = Math.min(k, 4096 / Math.max(L.w, L.h));
    if (!item.frame) {
      item.frame = document.createElement('canvas');
      item.frame.width = Math.max(1, Math.round(L.w * k));
      item.frame.height = Math.max(1, Math.round(L.h * k));
    }
    const cv = item.frame, c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    if (crop.shape === 'circle') {
      c.beginPath();
      c.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      c.clip();
    }
    // The whole picture, scaled so that the crop fills the canvas, centred on the crop's centre.
    const FW = W / crop.w, FH = H / crop.h;
    c.translate(W / 2, H / 2);
    c.rotate(a);
    c.drawImage(src, -(crop.x + crop.w / 2) * FW, -(crop.y + crop.h / 2) * FH, FW, FH);
    c.restore();
    return cv;
  }

  /** `t`: seconds used for the spin angle (wall clock for a still, elapsed time for a video). */
  function composeFrame(ctx, warper, items, t = Date.now() / 1000) {
    const { project } = S;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
    for (const item of items) {
      const { L } = item;
      const src = Spin.rpm(L) || Crop.active(L) ? layerFrame(item, Spin.angle(L, t)) : item.src;
      if (!warper.draw(src, L.corners)) continue;
      ctx.globalAlpha = L.opacity;
      ctx.globalCompositeOperation = !L.blend || L.blend === 'normal' ? 'source-over' : L.blend;
      ctx.drawImage(warper.canvas, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  PM.exporter = { createWarper, prepareLayers, composeFrame, download, stamp };
})(window.PM);
