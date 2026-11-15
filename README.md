# Projector Mapper

A simple projection mapping tool that runs in your browser. Point a projector at a wall and place, resize, rotate and warp images, videos, shapes and text so they land exactly where you want them.

No install and no build step. It runs fully offline.

## Getting started

1. Download or clone this repository.
2. Open `index.html` in **Chrome or Edge**. Double-clicking the file works. You can also serve the folder with `python3 -m http.server` and open <http://localhost:8000>.
3. Connect the projector as a **second (extended) display**.
4. Under **Output → Resolution**, enter the projector's native resolution (for example, 1920 × 1080).
5. Click **Open output window**, drag that window onto the projector, then **double-click** it or press **F** to go fullscreen.
6. Edit on your laptop screen. The projector updates live.

With only one display, for example a mirrored projector, use **Present** or press **P**. This hides the editor and makes the current window fullscreen. Press **Esc** to return.

## Features

- **Multiple layers:** images (PNG, JPG, GIF, SVG, WebP), looping videos (MP4, WebM), shapes (rectangle, circle, triangle, star, hexagon) and text.
- **Adding media:** use **+ Media**, drag files onto the canvas, or paste from the clipboard.
- **Transform mode (V):**
  - Drag a layer to move it.
  - Drag a corner handle to resize in proportion. Hold **Alt** to resize from the centre.
  - Drag an edge handle to stretch in one direction.
  - Drag the round top handle to rotate. Hold **Shift** to snap to 15°.
- **Corner warp mode (W):**
  - Drag each corner on its own to fit content onto surfaces seen at an angle, such as a box face or a slanted wall.
  - Corners snap to other layers' corners and to the screen edges. Hold **Alt** to turn snapping off.
  - Click a corner (or press 1–4) and use the arrow keys for pixel-exact adjustment.
- **Layer properties:** position and size in exact numbers, opacity, blend mode, fill and outline colours, corner radius, font, flip, rotate 90°, reset warp, original aspect, fit to output and fill output.
- **Layer list:** reorder, show or hide, lock (locked layers can't be clicked or moved), duplicate and delete. Double-click a name to rename it.
- **Alignment grid (G):** a test pattern with the output border, grid, diagonals and a centre circle, for lining up the projector.
- **Undo/redo:** Ctrl+Z and Ctrl+Shift+Z.
- **Autosave:** the project and media are saved in the browser (IndexedDB), so they are still there after a reload.
- **Export/Import:** saves the whole project, media included, as one `.json` file to back up or move to another computer.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` / `W` | Transform mode / Corner warp mode |
| Arrows (`Shift` = ×10) | Nudge the layer, or the selected corner in warp mode |
| `1`–`4` | Select a corner in warp mode (TL, TR, BR, BL) |
| `G` | Toggle the alignment grid |
| `H` | Hide or show the editor UI |
| `P` | Present fullscreen |
| `Esc` | Exit present mode, or deselect |
| `Ctrl+D` | Duplicate |
| `Del` / `Backspace` | Delete |
| `[` / `]` | Send backward / bring forward |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

## Tips for mapping

- To hide parts of the wall, use black shapes as masks. Black projects as no light.
- Lock layers you have finished aligning so you don't move them by accident.
- Use the **screen** blend mode to layer glowing effects.
- For a 3D object such as a box, add one layer per face and corner-warp each one onto its face. Snapping helps the shared edges line up.

## How it works

Every layer is drawn at its base size and mapped onto four output corners with a CSS `matrix3d` perspective transform (a homography). Moving, resizing, rotating and warping all edit those four corners. This is why any layer type, including video and text, can be perspective-warped. The output window is a second browser window that the editor drives directly, so it stays in sync and needs no server.

Code layout: `index.html` (UI), `css/style.css`, `js/app.js` (all logic, plain JavaScript with no dependencies).
