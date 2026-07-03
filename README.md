# Timeline Composer

A browser-based photo/video editor: combine photos, video clips, and music into
one rendered video — entirely in your browser. No backend, no uploads, no
accounts. Everything (editing, preview, and export) runs client-side, so it can
be hosted on GitHub Pages or any static file host.

## Features (MVP)

- **Import** photos, videos, and music by drag-and-drop or the Import button.
- **Media bin** with thumbnails, type, and duration.
- **Timeline** with up to 4 video layers plus a music track:
  - drag clips to reposition (drag vertically to change layer), drag edges to
    trim / set duration
  - snapping to clip edges, the playhead, and whole seconds (hold Shift to disable)
  - zoom with the +/− buttons or ⌘/Ctrl + scroll
  - **+ Layer** adds an overlay layer; higher layers render on top
- **Preview** playback with music, scrubbing, and per-clip fit modes
  (contain / cover / stretch).
- **Inspector** for precise start/duration/trim, volume, audio fade in/out,
  and — for visual clips — opacity, scale, and X/Y position (picture-in-picture
  style overlays).
- **Save / Open**:
  - `.json` project file (layout only; media is relinked by filename on open)
  - **Bundle**: a portable `.timeline.zip` containing the project *and* all
    media — reopens anywhere with no relinking
- **Autosave** to localStorage, with media mirrored into the Origin Private
  File System where supported — recovery restores your media automatically.
- **Export** the timeline to a downloadable `.webm` video (canvas capture +
  MediaRecorder) with quality presets, progress, and cancel.

## Running locally

It is a static site, but it uses ES modules, so serve it over HTTP:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploying to GitHub Pages

Push the repo and enable Pages (Settings → Pages → deploy from branch, root
folder). `index.html` at the repo root is the whole app — no build step.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Home / End | Jump to start / end |
| ← / → | Nudge selected clip (or playhead) by one frame; Shift = 1 s |
| Delete / Backspace | Delete selected clip |
| ⌘/Ctrl + D | Duplicate selected clip |
| + / − | Zoom timeline |
| Shift while dragging | Disable snapping |
| Esc | Deselect |

## Current limitations

- Export is **real time**: a 30-second timeline takes ~30 seconds to render.
  Keep the tab in the foreground while exporting.
- Export format is **WebM** (VP9/VP8 + Opus, depending on the browser). MP4
  export via WebCodecs/ffmpeg.wasm is planned (see the project plan, Phase 3).
- Video clips are **muted** in the composition for now — the audio track is
  the music track. Video-audio mixing is planned.
- `.json` project files store clip layout and asset metadata only; reopening
  one prompts you to relink the original media files (matched by filename).
  Use **Bundle** (`.timeline.zip`) to save a fully self-contained project.
- One audio track (multiple audio tracks are planned).

## Project structure

```
index.html          app shell
styles/app.css      theme + layout
src/
  app.js            bootstrap, toolbar, keyboard, drag/drop import
  state.js          central state + event bus
  project-schema.js project model, presets, (de)serialization
  timeline.js       pure timeline math (active clips, snapping, durations)
  timeline-ui.js    timeline panel: ruler, clips, drag/trim, zoom, playhead
  media-import.js   file import, probing, thumbnails, relinking
  media-cache.js    ImageBitmap / <video> / AudioBuffer caches
  renderer.js       draws a timeline frame onto a canvas
  playback.js       preview playback clock, video sync, Web Audio scheduling
  export-webm.js    WebM export (captureStream + MediaRecorder)
  storage.js        save/open JSON + zip bundles, autosave, OPFS recovery
  zip.js            dependency-free ZIP writer/reader for bundles
  opfs.js           Origin Private File System media cache
  ui.js             media bin, inspector, dialogs, toasts
  utils.js          small helpers
docs/               project plan
```

See `docs/project-plan.md` for the full roadmap.

## License

MIT — see [LICENSE](LICENSE).
