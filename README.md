# Projector Mapper

A simple projection mapping tool that runs in your browser. Point a projector at a wall and place, resize, rotate and warp images, videos, shapes and text so they land exactly where you want them.

No install and no build step. It runs fully offline.

## Getting started

**Use it online:** <https://vijayprabhu.github.io/projector-mapper/>. Your projects are saved in your own browser and nothing is uploaded.

To run it offline instead:

1. Download or clone this repository.
2. Open `index.html` in **Chrome or Edge**. Double-clicking the file works. You can also serve the folder with `python3 -m http.server` and open <http://localhost:8000>.
3. Connect the projector as a **second (extended) display**.
4. Under **Output → Resolution**, enter the projector's native resolution (for example, 1920 × 1080).
5. Click **Open output window**, drag that window onto the projector, then **double-click** it or press **F** to go fullscreen.
6. Edit on your laptop screen. The projector updates live.

With only one display, for example a mirrored projector, use **Present** or press **P**. This hides the editor and makes the current window fullscreen. Press **Esc** to return.

## Running it on the projector without a computer

Most smart projectors, including Android ones, have a built-in media player that can play photos and videos from a USB stick or from internal storage. Once your mapping is lined up, you can export it and let the projector play it on its own.

1. **Line up the mapping once.** Connect a laptop to the projector, open the output window on the projector (or use **Present**), and adjust every layer until it sits exactly where you want it on the wall.
2. **Export it** at the projector's resolution (set under **Output → Resolution**):
   - **Export PNG** for still shapes and images. It saves one image with all the warping baked in.
   - **Export video** for anything that moves, or for players that can't loop a photo. It saves a looping **MP4** (H.264). If a video layer is in the mapping, the length defaults to that video's length, so the loop is seamless. Recording runs in real time, so keep the tab visible until it finishes.
3. **Copy the file** to a USB stick. You can also send it to the projector over WiFi or with a phone app if your model supports that.
4. **Play it on the projector.** Open the file in the projector's file manager or media player. For a video, turn on **Repeat / Loop**. For a photo, start a slideshow and turn off the timer, or use the video export instead.

To keep the projected image aligned with the wall:
- Leave the projector, its **zoom** and its **position** exactly as they were when you made the mapping.
- Turn off **auto keystone** and **auto focus/correction** in the projector's settings, or set keystone to 0. The mapping already includes all the warping, and automatic correction would distort it.
- Use the video's **native resolution**. If the export doesn't match the projector, its player will rescale the image and the mapping will shift.

Use **Save project** to keep an editable copy, so you can tweak the mapping and export again later.

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
- **Spin:** set a speed in rotations per minute and a direction to make any layer spin continuously. The content turns inside its mapped area, so it stays on the surface you warped it to (anything that swings outside the layer's edges is clipped; a square or round layer spins cleanly). Exported videos pick a length that completes whole turns so the loop is seamless.
- **Layer list:** reorder, show or hide, lock (locked layers can't be clicked or moved), duplicate and delete. Double-click a name to rename it.
- **Alignment grid (G):** a test pattern with the output border, grid, diagonals and a centre circle, for lining up the projector.
- **Undo/redo:** Ctrl+Z and Ctrl+Shift+Z.
- **Autosave:** the project and media are saved in the browser (IndexedDB), so they are still there after a reload.
- **Export PNG / Export video:** renders the finished mapping at full output resolution, with the warping, opacity and blend modes baked in, for playing directly on a projector.
- **Save project / Open project:** saves the whole editable project, media included, as one `.json` file to back up or move to another computer.

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
