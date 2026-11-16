"""Generate docs/functional-architecture.svg (the Functional Architecture diagram).

Usage: python3 docs/generate_architecture.py [output.svg]

The diagram is hand-laid-out: each block is a box(x, y, w, h, layer, title, lines)
call, grouped into bands (presentation, application core, rendering engine,
output & export, persistence & platform). Update the blocks and arrows here when
the app's functionality changes, then re-run the script.
"""
import os
import sys
from html import escape as E
W, H = 1720, 1160
out = []
A = out.append

C = {
  'ui':   ('#EAF2FF', '#4F8CFF', '#1E4FA8'),
  'app':  ('#E7F7EF', '#2FBF8F', '#14724F'),
  'ren':  ('#F1EBFF', '#8B5CF6', '#5B2DB8'),
  'out':  ('#FFF4DF', '#F0A020', '#8A5A00'),
  'per':  ('#EEF0F4', '#6B7280', '#374151'),
  'ext':  ('#FFFFFF', '#374151', '#111827'),
}

def box(x, y, w, h, key, title, lines=(), dashed=False, tsize=14, src=None):
    fill, stroke, ink = C[key]
    da = ' stroke-dasharray="6 4"' if dashed else ''
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{da}/>')
    A(f'<text x="{x+12}" y="{y+22}" class="bt" fill="{ink}" font-size="{tsize}">{E(title)}</text>')
    for i, ln in enumerate(lines):
        A(f'<text x="{x+12}" y="{y+42+i*16}" class="bl">{E(ln)}</text>')
    # Source module(s) implementing the block, bottom-left.
    srcs = [src] if isinstance(src, str) else list(src or [])
    for i, sp in enumerate(reversed(srcs)):
        A(f'<text x="{x+12}" y="{y+h-9-i*13}" class="src" fill="{ink}">{E(sp)}</text>')

def band(x, y, w, h, key, label):
    fill, stroke, ink = C[key]
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="none" stroke="{stroke}" stroke-width="1.2" stroke-opacity=".55"/>')
    A(f'<rect x="{x+14}" y="{y-11}" width="{len(label)*8.4+22}" height="22" rx="11" fill="{stroke}"/>')
    A(f'<text x="{x+24}" y="{y+4}" class="band">{E(label)}</text>')

def arrow(pts, label=None, lx=None, ly=None, color='#4B5563', dashed=False, anchor='middle'):
    d = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
    da = ' stroke-dasharray="5 4"' if dashed else ''
    A(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{da} marker-end="url(#ah)"/>')
    if label:
        A(f'<text x="{lx}" y="{ly}" class="al" text-anchor="{anchor}">{E(label)}</text>')

A(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<title>Projector Mapper: functional architecture</title>
<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4B5563"/></marker>
  <style>
    .bt {{ font-weight: 650; }}
    .bl {{ font-size: 12px; fill: #374151; }}
    .band {{ font-size: 12px; font-weight: 700; fill: #fff; letter-spacing: .04em; }}
    .al {{ font-size: 11.5px; fill: #374151; font-style: italic; }}
    .h1 {{ font-size: 24px; font-weight: 700; fill: #111827; }}
    .h2 {{ font-size: 13px; fill: #4B5563; }}
    .src {{ font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill-opacity: .8; }}
  </style>
</defs>
<rect width="{W}" height="{H}" fill="#FFFFFF"/>
<text x="30" y="44" class="h1">Projector Mapper: Functional Architecture</text>
<text x="30" y="68" class="h2">Browser-based projection-mapping tool. Single page, no server or build step: index.html · css/style.css · js/** classic scripts on one PM namespace (runs from GitHub Pages or file://).</text>
''')

# ---------- app boundary ----------
AX, AY, AW, AH = 220, 96, 1080, 1040
A(f'<rect x="{AX}" y="{AY}" width="{AW}" height="{AH}" rx="16" fill="#FBFBFD" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="8 5"/>')
A(f'<text x="{AX+16}" y="{AY+24}" class="bt" font-size="14" fill="#374151">Projector Mapper web app (runs entirely in the browser)</text>')

# ---------- Presentation ----------
band(240, 140, 1040, 230, 'ui', 'PRESENTATION / INTERACTION')
y = 160
box(256, y, 196, 196, 'ui', 'Toolbar', ['Add media (image/video)', 'Add shape / text', 'Transform | Corner-warp mode', 'Undo · Redo · Grid', 'Save / Open / New project', 'Export PNG / video', 'Output window · Present'], src='index.html · js/app.js')
box(464, y, 214, 196, 'ui', 'Editor Viewport', ['Stage scaled to output res.', 'Selection overlay & handles', 'Move · resize · rotate', 'Corner warp (per corner)', 'Snap to corners / edges', 'Shift: 15° snap, Alt: centre'], src='js/ui/editor.js')
box(690, y, 204, 196, 'ui', 'Side Panel', ['Layer list: select, rename,', '  show/hide, lock, reorder', 'Properties: position, size,', '  opacity, blend, crop, spin,', '  shape/text styling', 'Output: resolution, presets,', '  background colour'], src='js/ui/panel.js')
box(906, y, 176, 196, 'ui', 'Dialogs', ['Crop editor', '  Free form · 1:1 · Circle', '  move / resize crop box', 'Video export', '  length, frame rate,', '  progress, cancel'], src=['js/ui/crop-dialog.js', 'js/export/video.js'])
box(1094, y, 170, 196, 'ui', 'Input Handling', ['Keyboard shortcuts', '  (V W G H P, arrows,', '  Ctrl+Z/D, Del, [ ])', 'Drag & drop files', 'Paste images', 'Pointer capture'], src='js/app.js')

# ---------- Application core ----------
band(240, 410, 560, 300, 'app', 'APPLICATION CORE')
box(256, 432, 172, 124, 'app', 'Dispatcher & Events', ['run(cmd) routes toolbar,', 'panel and key actions', 'PM.events notifies views'], src=['js/core/namespace.js', 'js/app.js'])
box(440, 432, 172, 124, 'app', 'Project Model', ['Output w × h, background,', 'grid, ordered layers', 'Layer: type, w × h, four', 'corners, opacity, blend'], src='js/core/state.js')
box(624, 432, 160, 124, 'app', 'History', ['commit() snapshots', 'Undo / redo stacks', '(150 states)', 'Triggers autosave'], src='js/core/state.js')
box(256, 568, 172, 128, 'app', 'Layer Operations', ['Add · duplicate · delete', 'Reorder · flip · rotate 90°', 'Reset warp · aspect', 'Fit / fill / centre'], src='js/core/layers.js')
box(440, 568, 172, 128, 'app', 'Crop Service', ['Normalised crop rect +', 'shape (rect / circle)', 'Re-maps corners so the', 'kept area stays in place'], src='js/core/effects.js')
box(624, 568, 160, 128, 'app', 'Spin Service', ['rpm + direction', 'Wall-clock phase keeps', 'all views in sync', 'Seamless loop length'], src='js/core/effects.js')

# ---------- Rendering engine ----------
band(820, 410, 460, 300, 'ren', 'RENDERING ENGINE')
box(836, 432, 210, 124, 'ren', 'Geometry', ['Unit square → quad', '  homography coefficients', 'CSS matrix3d per layer', 'Point mapping, bbox, snap'], src='js/core/geometry.js')
box(1058, 432, 206, 124, 'ren', 'Renderer (DOM sync)', ['One instance per view', '  (editor, output window)', 'Diffs layers → elements', 'Applies warp, crop, spin'], src='js/render/renderer.js')
box(836, 568, 210, 128, 'ren', 'Content Builders', ['Image  <img>', 'Video  <video> (loop, muted)', 'Shape  generated SVG', 'Text   styled block'], src='js/render/content.js')
box(1058, 568, 206, 128, 'ren', 'Alignment Grid', ['100 px grid, diagonals,', 'centre circle, border', 'Resolution label', 'Shown in all views'], src='js/render/content.js')

# ---------- Output & export ----------
band(240, 750, 1040, 190, 'out', 'OUTPUT & EXPORT')
box(256, 772, 190, 152, 'out', 'Output Window', ['Pop-up window to drag', 'onto the projector', 'Double-click / F: fullscreen', 'Live sync with editor', 'Cursor auto-hide'], src='js/output/output-window.js')
box(458, 772, 160, 152, 'out', 'Present Mode', ['Hide UI in this tab', 'Fullscreen (P) or', 'UI-hidden only (H)', 'Esc to exit'], src='js/output/present.js')
box(630, 772, 210, 152, 'out', 'PNG Export', ['Rasterise each layer', 'Crop / spin frame (canvas)', 'WebGL2 perspective warp', 'Canvas 2D compositing', '  (opacity, blend modes)'], src=['js/export/png.js', 'js/export/pipeline.js'])
box(852, 772, 210, 152, 'out', 'Video Export', ['Same pipeline per frame', 'captureStream + MediaRecorder', 'MP4 (H.264) or WebM', 'Loop length from videos', '  / spin periods'], src=['js/export/video.js', 'js/export/pipeline.js'])
box(1074, 772, 190, 152, 'out', 'Project File I/O', ['Save: JSON with media', '  embedded as data URLs', 'Open: restore media', '  + project, keep undo', 'New: clear layers'], src='js/export/project-file.js')

# ---------- Persistence & platform ----------
band(240, 980, 1040, 140, 'per', 'PERSISTENCE & PLATFORM SERVICES')
box(256, 1002, 380, 102, 'per', 'Local Store (IndexedDB "projector-mapper")', ['kv: project JSON (autosave, 400 ms debounce)', 'media: original image / video blobs', 'Unused media garbage-collected (with undo/redo)'], tsize=13, src='js/core/storage.js')
box(648, 1002, 170, 102, 'per', 'Media Cache', ['mediaId → object URL', 'Restored on start-up', 'Shared by all views'], src='js/core/state.js')
box(830, 1002, 434, 102, 'per', 'Browser APIs used', ['CSS 3D transforms · clip-path · CSS animations', 'WebGL2 · Canvas 2D · MediaRecorder · captureStream', 'IndexedDB · File API · Drag & drop · Clipboard', 'Fullscreen API · window.open (output window)'])

# ---------- external actors ----------
# Operator
A('<g>')
box(30, 190, 168, 126, 'ext', 'Operator', ['Designs the mapping', 'Aligns layers to', 'physical surfaces'], dashed=True)
A('</g>')
box(30, 420, 168, 110, 'ext', 'Media Sources', ['Image & video files', '(picker, drag & drop,', 'clipboard)'], dashed=True)
box(30, 1010, 168, 96, 'ext', 'Static Hosting', ['GitHub Pages', 'or local file://', 'serves static files'], dashed=True)

# right externals
box(1340, 930, 350, 120, 'ext', 'Projector: live input (HDMI)', ['Shows Output Window / Present mode', 'Native resolution = project output size', 'Keystone & auto-correction off'], dashed=True)
box(1340, 770, 350, 104, 'ext', "Projector's USB media player", ['Plays exported PNG or looping', 'MP4 / WebM with no computer attached'], dashed=True)
box(1340, 600, 350, 116, 'ext', 'Local File System', ['Saved project (.json)', 'Exported image (.png)', 'Exported video (.mp4 / .webm)'], dashed=True)

# ---------- flows ----------
arrow([(198, 250), (254, 250)], 'uses', 226, 242)
arrow([(198, 475), (232, 475), (232, 300), (254, 300)], 'loads', 202, 492, anchor='start')
arrow([(198, 1058), (254, 1058)], 'serves', 226, 1050)
# presentation -> dispatcher
arrow([(354, 356), (354, 430)], 'commands / edits', 362, 398, anchor='start')
# dispatcher -> model ; model <-> history
arrow([(428, 494), (438, 494)])
arrow([(612, 494), (622, 494)])
# history -> local store (autosave)
arrow([(784, 520), (806, 520), (806, 726), (624, 726), (624, 1000)], 'autosave (debounced)', 715, 721, dashed=True)
# model -> renderer
arrow([(526, 432), (526, 400), (1160, 400), (1160, 430)], 'project state → sync()', 930, 394)
# renderer -> viewport (editor view)
arrow([(1150, 432), (1150, 386), (571, 386), (571, 358)], None)
A('<text x="760" y="381" class="al">renders editor view</text>')
# renderer -> output window
arrow([(1264, 494), (1288, 494), (1288, 745), (425, 745), (425, 770)], 'renders live output view', 1282, 740, anchor='end')
# output window / present -> projector
arrow([(351, 924), (351, 958), (1310, 958), (1310, 990), (1338, 990)], 'live video signal (HDMI)', 1300, 952, anchor='end')
A('<path d="M538,924 L538,958" fill="none" stroke="#4B5563" stroke-width="1.6"/><circle cx="538" cy="958" r="3" fill="#4B5563"/>')
# exports -> file system
arrow([(957, 772), (957, 754), (1320, 754), (1320, 650), (1338, 650)], 'files', 1314, 700, anchor='end')
A('<path d="M735,772 L735,754 L957,754" fill="none" stroke="#4B5563" stroke-width="1.6"/>')
arrow([(1169, 772), (1169, 760), (1326, 760), (1326, 690), (1338, 690)])
# file system -> USB player
arrow([(1515, 716), (1515, 768)], 'copy via USB stick', 1525, 746, anchor='start')

# legend
lx, ly = 1340, 140
A(f'<rect x="{lx}" y="{ly}" width="350" height="272" rx="10" fill="#fff" stroke="#D1D5DB"/>')
A(f'<text x="{lx+14}" y="{ly+24}" class="bt" font-size="14" fill="#111827">Legend</text>')
items = [('ui', 'Presentation / interaction'), ('app', 'Application core (domain logic)'), ('ren', 'Rendering engine'), ('out', 'Output & export channels'), ('per', 'Persistence & platform services')]
for i, (k, t) in enumerate(items):
    f, s, _ = C[k]
    yy = ly + 44 + i * 26
    A(f'<rect x="{lx+14}" y="{yy-12}" width="22" height="16" rx="4" fill="{f}" stroke="{s}" stroke-width="1.5"/>')
    A(f'<text x="{lx+46}" y="{yy+1}" class="bl" font-size="13">{E(t)}</text>')
yy = ly + 44 + 5 * 26
A(f'<rect x="{lx+14}" y="{yy-12}" width="22" height="16" rx="4" fill="#fff" stroke="#374151" stroke-dasharray="4 3"/>')
A(f'<text x="{lx+46}" y="{yy+1}" class="bl" font-size="13">External actor / system</text>')
yy += 28
A(f'<path d="M{lx+14},{yy-4} L{lx+36},{yy-4}" stroke="#4B5563" stroke-width="1.6" marker-end="url(#ah)"/><text x="{lx+46}" y="{yy+1}" class="bl" font-size="13">Control / data flow</text>')
yy += 24
A(f'<path d="M{lx+14},{yy-4} L{lx+36},{yy-4}" stroke="#4B5563" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#ah)"/><text x="{lx+46}" y="{yy+1}" class="bl" font-size="13">Asynchronous / background flow</text>')
yy += 24
A(f'<text x="{lx+14}" y="{yy+1}" class="src" fill="#374151">js/…</text><text x="{lx+46}" y="{yy+1}" class="bl" font-size="13">Source module implementing the block</text>')

# key principles note
nx, ny = 1340, 426
A(f'<rect x="{nx}" y="{ny}" width="350" height="162" rx="10" fill="#F9FAFB" stroke="#D1D5DB"/>')
A(f'<text x="{nx+14}" y="{ny+24}" class="bt" font-size="14" fill="#111827">Key design principles</text>')
for i, t in enumerate(['Every layer = base size + 4 output corners;', '  move, resize, rotate and warp all edit corners', 'One project model drives editor, output', '  window and exports (WYSIWYG)', 'Offline-first: no backend, all data local', 'No dependencies, no build; works from file://', 'Modules: classic scripts on one PM namespace']):
    A(f'<text x="{nx+14}" y="{ny+46+i*16}" class="bl">{E(t)}</text>')

A('</svg>')
dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'functional-architecture.svg')
with open(dest, 'w') as f:
    f.write('\n'.join(out) + '\n')
print('Wrote', dest)
