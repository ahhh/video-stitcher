# Browser Video Editor Project Plan

**Working name:** Timeline Composer  
**Target:** A static, single-page HTML application hosted on GitHub Pages  
**Goal:** Combine photos, video clips, and music into one rendered video entirely in the user's browser.

---

## 1. Product Vision

Build a lightweight browser-based photo/video editor that feels like a simple non-linear editor: users import photos, videos, and audio; arrange them on a time graph/timeline; drag clip edges to change duration; preview the composition; save/reopen projects; and export a finished video.

The project should require no backend server, no uploaded user media, and no paid cloud service. All editing, rendering, caching, and export happen client-side.

---

## 2. Core Constraints

1. **GitHub Pages hosting only**
   - Static files only: `index.html`, CSS, JavaScript modules, assets, and optional WebAssembly files.
   - No server-side render, upload endpoint, background job, or API secret.

2. **Privacy-first**
   - User media stays local in the browser.
   - Do not upload photos, videos, audio, project files, or generated output anywhere.

3. **Browser security model**
   - The app cannot freely read/write arbitrary local files.
   - Use drag-and-drop and file inputs for universal importing.
   - Use the File System Access API where available for nicer open/save flows.
   - Always provide fallback download/upload project files.

4. **Export limitations**
   - WebM export is the practical MVP path.
   - MP4 export is possible but harder. Treat it as Phase 2/3 using WebCodecs plus muxing or ffmpeg.wasm.
   - Large projects may be slow because encoding happens on the user's device.

5. **Single-page app**
   - One app shell with panels: media bin, preview canvas, timeline, inspector, export dialog.
   - Can be implemented as plain HTML/CSS/JS modules or a compiled static app. The deploy output must still be static.

---

## 3. Recommended Technical Strategy

### MVP strategy

Use a **canvas-based renderer** for preview and export:

- Decode images with `createImageBitmap()`.
- Decode video by seeking hidden `<video>` elements or, later, WebCodecs.
- Draw the current timeline frame to a `<canvas>`.
- Mix or attach music through the Web Audio API.
- Capture the canvas with `canvas.captureStream()`.
- Record the stream with `MediaRecorder`.
- Export a downloadable `.webm` file.

This gives a realistic first version without requiring a native server or cloud render pipeline.

### Later export strategy

Add advanced export modes:

1. **WebCodecs export path**
   - Render frames to canvas.
   - Convert frames to `VideoFrame`.
   - Encode with `VideoEncoder`.
   - Mux encoded video and audio into a container using a JavaScript muxer.
   - Best for performance where browser support is good.

2. **ffmpeg.wasm export path**
   - Use ffmpeg.wasm for transcoding, MP4 output, audio mixing, and format compatibility.
   - Keep it optional because it is large, CPU-heavy, and may need cross-origin isolation for best performance.
   - GitHub Pages does not allow normal custom HTTP response header configuration, so SharedArrayBuffer/threaded WebAssembly workflows may require a service-worker-based workaround or a different static host.

---

## 4. Primary User Stories

### Importing

- As a user, I can drag photos, videos, and audio files into the page.
- As a user, I can click **Import Media** and choose files from disk.
- As a user, I can see imported media in a media bin with thumbnails, duration, type, and filename.
- As a user, I can drag imported media from the bin onto the timeline.

### Timeline editing

- As a user, I can see a horizontal time graph with a playhead.
- As a user, I can drag clips left/right to change start time.
- As a user, I can drag clip edges to trim video or change image duration.
- As a user, I can place photos and video clips on a visual track.
- As a user, I can place music on an audio track.
- As a user, I can zoom the timeline in/out.
- As a user, I can snap clips to the playhead, neighboring clips, and whole seconds.

### Preview

- As a user, I can press play and watch the timeline preview.
- As a user, I can scrub with the playhead.
- As a user, I can change project aspect ratio: 16:9, 9:16, 1:1.
- As a user, I can set output resolution presets: 720p, 1080p, square, vertical.

### Saving and opening

- As a user, I can save a project file.
- As a user, I can reopen a project file later.
- As a user, I am warned if media references are missing and can relink them.
- As a user, I can autosave locally in the browser.

### Exporting

- As a user, I can export the timeline to a downloadable video.
- As a user, I can choose quality, frame rate, resolution, and file type where supported.
- As a user, I can see export progress and cancel a render.

---

## 5. Proposed Application Layout

```
+--------------------------------------------------------------+
| Top Bar: New | Open | Import | Save | Export | Settings       |
+-------------------+------------------------------------------+
| Media Bin         | Preview Canvas                           |
| - Photos          |                                          |
| - Videos          |                                          |
| - Audio           |                                          |
+-------------------+------------------------------------------+
| Inspector         | Timeline                                 |
| selected clip     | 00:00 ---- 00:10 ---- 00:20 ---- 00:30   |
| properties        | [photo][video clip.....][photo]          |
|                   | [music track...........................] |
+-------------------+------------------------------------------+
```

### Panels

1. **Top bar**
   - New Project
   - Open Project
   - Import Media
   - Save Project
   - Export Video

2. **Media bin**
   - Asset list/grid
   - Thumbnail generation
   - Duration metadata
   - Type filters

3. **Preview canvas**
   - Main render target
   - Playback controls
   - Time display
   - Fit/fill toggle

4. **Timeline**
   - Track area
   - Clip blocks
   - Resizable clip edges
   - Playhead
   - Zoom/scroll
   - Snapping

5. **Inspector**
   - Clip start time
   - Clip duration
   - Trim in/out
   - Scale mode: fit, fill, stretch
   - Volume for audio/video
   - Optional image motion: pan/zoom

---

## 6. Project Data Model

Use a JSON project model that separates asset metadata from timeline placement.

### Example project file

```json
{
  "schemaVersion": 1,
  "app": "timeline-composer",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "settings": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "backgroundColor": "#000000",
    "duration": 18.5
  },
  "assets": [
    {
      "id": "asset_001",
      "type": "image",
      "name": "beach.jpg",
      "mimeType": "image/jpeg",
      "duration": null,
      "source": {
        "kind": "opfs",
        "path": "assets/asset_001"
      }
    },
    {
      "id": "asset_002",
      "type": "audio",
      "name": "song.mp3",
      "mimeType": "audio/mpeg",
      "duration": 124.2,
      "source": {
        "kind": "opfs",
        "path": "assets/asset_002"
      }
    }
  ],
  "tracks": [
    {
      "id": "track_video_1",
      "type": "visual",
      "clips": [
        {
          "id": "clip_001",
          "assetId": "asset_001",
          "timelineStart": 0,
          "duration": 4,
          "trimStart": 0,
          "trimEnd": null,
          "fit": "cover",
          "transform": {
            "x": 0,
            "y": 0,
            "scale": 1,
            "rotation": 0
          },
          "effects": []
        }
      ]
    },
    {
      "id": "track_audio_1",
      "type": "audio",
      "clips": [
        {
          "id": "clip_audio_001",
          "assetId": "asset_002",
          "timelineStart": 0,
          "duration": 18.5,
          "trimStart": 10.0,
          "volume": 0.8,
          "fadeIn": 1.0,
          "fadeOut": 2.0
        }
      ]
    }
  ]
}
```

### Asset storage choices

Support three storage modes:

1. **In-memory session assets**
   - Simplest initial mode.
   - Imported files work until the tab closes.
   - Saving the project produces JSON, but reopening may require relinking media.

2. **OPFS cached assets**
   - Copy imported media into the Origin Private File System.
   - Allows local autosave and reopening without immediate relink in supporting browsers.
   - Still origin-bound; files are not visible as normal user files.

3. **Project bundle**
   - Export a `.zip` containing `project.json` and media files.
   - Most portable open/save model.
   - More work, but ideal for real user trust.

Recommended path: start with in-memory plus JSON save/load, then add OPFS autosave, then add project bundle support.

---

## 7. Rendering Architecture

### Runtime pieces

1. **Timeline engine**
   - Given a time `t`, return active visual clips and audio clips.
   - Handles clip order, trimming, transitions, and effects.

2. **Media decoder/cache**
   - Images: decode once into `ImageBitmap` when possible.
   - Videos: keep hidden video elements or WebCodecs decoders.
   - Audio: decode with Web Audio API for waveform and mixing.

3. **Preview renderer**
   - Uses `requestAnimationFrame()` during playback.
   - Draws current timeline state to the preview canvas.
   - Supports letterbox/crop/fill modes.

4. **Export renderer**
   - Renders deterministically frame-by-frame.
   - Does not depend on UI animation timing.
   - Reports progress as `framesRendered / totalFrames`.

### Frame render pseudocode

```js
async function renderFrameAt(timeSeconds, ctx, project) {
  ctx.clearRect(0, 0, project.width, project.height);
  ctx.fillStyle = project.backgroundColor;
  ctx.fillRect(0, 0, project.width, project.height);

  const visualClips = timeline.getActiveVisualClips(timeSeconds);

  for (const clip of visualClips) {
    const localTime = timeSeconds - clip.timelineStart + clip.trimStart;
    const frameSource = await mediaCache.getFrame(clip.assetId, localTime);
    drawClip(ctx, frameSource, clip, project);
  }
}
```

---

## 8. Export Plan

### Phase 1 export: WebM via canvas capture

Best first implementation:

1. Create an offscreen or hidden export canvas at target resolution.
2. Use `canvas.captureStream(fps)` to create a video stream.
3. Build an audio graph for the music track.
4. Merge canvas video track and audio track into one `MediaStream`.
5. Record with `MediaRecorder`.
6. Save the resulting Blob as `.webm`.

Pros:
- Relatively simple.
- Works with standard browser APIs.
- Good enough for first usable version.

Cons:
- WebM may not be accepted everywhere.
- Encoding quality/options vary by browser.
- Real-time recording can drift if rendering is too slow.

### Phase 2 export: deterministic frame render

Improve quality by rendering frame-by-frame:

1. Step through exact timestamps: `frameIndex / fps`.
2. Render each frame to canvas.
3. Encode each frame with WebCodecs where supported.
4. Encode/mix audio separately.
5. Mux into MP4/WebM.

Pros:
- More deterministic.
- Better progress reporting.
- Better chance of clean sync.

Cons:
- More complex.
- Browser support and codec availability vary.
- Requires muxing code.

### Phase 3 export: optional ffmpeg.wasm

Use ffmpeg.wasm as an advanced compatibility layer:

- MP4/H.264 output where supported by the wasm build.
- Audio conversion.
- Final remux/transcode.
- GIF export.
- Extract thumbnails or waveforms.

Cautions:
- Large download size.
- Heavy CPU and memory use.
- Browser may freeze if not isolated in a Worker.
- Threaded/high-performance wasm often depends on cross-origin isolation, which is awkward on GitHub Pages.

---

## 9. Open, Import, and Save Features

### Open

Implement in this order:

1. **Open `.json` project file**
   - Use `<input type="file">`.
   - Parse project JSON.
   - Ask user to relink missing assets if needed.

2. **Open project bundle**
   - Use `.zip` file with `project.json` plus `assets/`.
   - Extract in browser.
   - Rebuild media cache.

3. **Open with File System Access API**
   - Use `showOpenFilePicker()` where supported.
   - Store file handles with permission after user action.

### Import

Support:

- Drag/drop files onto page.
- Click **Import Media**.
- Accept images: `image/png`, `image/jpeg`, `image/webp`, `image/gif` where feasible.
- Accept videos: `video/mp4`, `video/webm`, `video/quicktime` where browser can decode.
- Accept audio: `audio/mpeg`, `audio/wav`, `audio/aac`, `audio/ogg`, `audio/webm` where browser can decode.

On import:

1. Generate asset id.
2. Detect media type and MIME.
3. Read duration for audio/video.
4. Generate thumbnail.
5. Optionally copy to OPFS.
6. Add to media bin.

### Save

Implement three save modes:

1. **Save project JSON**
   - Download `project.timeline-composer.json`.
   - Fastest MVP.
   - Requires relinking assets if they are not cached.

2. **Autosave local project**
   - Store project JSON and asset cache in IndexedDB/OPFS.
   - Offer **Recover Last Project**.

3. **Save project bundle**
   - Download `.timeline.zip` containing:
     - `project.json`
     - `assets/<asset-id>-<original-name>`
     - optional thumbnails
   - Best long-term option.

---

## 10. Timeline Interaction Details

### Clip behavior

Each timeline clip should support:

- Drag to reposition.
- Drag left edge to trim start or extend image duration.
- Drag right edge to trim end or extend image duration.
- Click to select.
- Delete key removes selected clip.
- Duplicate command copies selected clip.
- Snap to neighboring clips and playhead.

### Timeline controls

- Spacebar: play/pause.
- Arrow keys: nudge selected clip or playhead.
- `+` / `-`: zoom timeline.
- Home: go to start.
- End: go to end.
- Shift-drag: disable snapping.

### Visual track MVP

Start with one visual track. Later add multiple visual tracks for overlays, titles, picture-in-picture, and layering.

### Audio track MVP

Start with one music track. Later add multiple tracks, volume envelopes, ducking, and fades.

---

## 11. MVP Scope

The MVP should prove the full loop: import, arrange, preview, save, reopen, export.

### Must have

- Single static `index.html` app.
- Import images, videos, and one audio/music file.
- Media bin with thumbnails.
- One visual timeline track.
- One audio/music track.
- Drag clips on timeline.
- Drag clip edges to set durations/trims.
- Preview canvas playback.
- Project settings: resolution, aspect ratio, fps.
- Save project JSON.
- Open project JSON with relink flow.
- Export WebM.

### Should have

- Timeline zoom.
- Snapping.
- Clip inspector.
- Basic image fit modes: contain, cover, stretch.
- Fade in/out for audio.
- Progress bar during export.
- Cancel export.
- Autosave recovery.

### Could have later

- MP4 export.
- Project bundle ZIP.
- Ken Burns pan/zoom for photos.
- Transitions.
- Text overlays.
- Multiple tracks.
- Waveform rendering.
- Color filters.
- Keyboard shortcut editor.
- PWA/offline support.

---

## 12. Suggested File Structure

For a plain JavaScript single-page app:

```text
/browser-video-editor
  index.html
  README.md
  /src
    app.js
    state.js
    project-schema.js
    media-import.js
    media-cache.js
    timeline.js
    timeline-ui.js
    renderer.js
    export-webm.js
    export-webcodecs.js
    storage.js
    ui.js
    utils.js
  /styles
    app.css
  /vendor
    optional-libs.md
  /docs
    project-plan.md
    project-format.md
```

For a Vite build while still deploying statically:

```text
/browser-video-editor
  package.json
  index.html
  /src
    main.js
    ...
  /docs
    project-plan.md
  /dist
    static GitHub Pages output
```

Recommendation: begin with Vite for developer ergonomics, but keep a no-server runtime requirement. The deployed app is still static.

---

## 13. Implementation Phases

### Phase 0 — Technical spikes

Objective: prove the hard parts before building UI polish.

Deliverables:

- Import one image and draw it to canvas.
- Import one video and seek/draw frames to canvas.
- Import one audio file and play it with preview.
- Record canvas output to WebM.
- Save and reload a small JSON project file.

Exit criteria:

- A simple sequence of one image plus one song exports as a playable WebM.

### Phase 1 — MVP editor

Deliverables:

- App shell layout.
- Media bin.
- Timeline clip model.
- Drag/drop editing.
- Preview playback.
- Save/open JSON project.
- WebM export dialog.

Exit criteria:

- User can make a slideshow/music video from imported files and export it.

### Phase 2 — Reliability and storage

Deliverables:

- OPFS or IndexedDB asset cache.
- Autosave/recover.
- Missing asset relink workflow.
- Export progress/cancel.
- Better video trim behavior.
- Better audio sync testing.

Exit criteria:

- User can close and reopen the browser and recover their recent project.

### Phase 3 — Advanced export

Deliverables:

- WebCodecs experiment.
- MP4 muxing experiment.
- Optional ffmpeg.wasm integration.
- Cross-origin isolation strategy decision for GitHub Pages.
- Worker-based export to keep UI responsive.

Exit criteria:

- App can produce either higher-quality WebM or MP4 on supported browsers.

### Phase 4 — Creative editing polish

Deliverables:

- Transitions.
- Text overlays.
- Ken Burns effects.
- Waveforms.
- Multi-track visual overlays.
- Keyboard shortcuts.
- Project bundle ZIP.

Exit criteria:

- Tool feels useful for hobbyist social/video montage workflows.

---

## 14. Major Risks and Mitigations

### Risk: MP4 export is harder than expected

Mitigation:
- Treat WebM as MVP.
- Make export format capability-driven.
- Add MP4 only after WebM workflow is stable.

### Risk: Browser codec support varies

Mitigation:
- Detect support at runtime with `MediaRecorder.isTypeSupported()` and WebCodecs capability checks.
- Show clear messages when a format cannot be imported or exported.
- Keep the original media untouched.

### Risk: Long videos exhaust memory

Mitigation:
- Avoid loading entire files into memory where possible.
- Use Blob URLs and streaming APIs.
- Cache thumbnails, not full decoded videos.
- Use Workers for heavy export tasks.
- Put practical limits in the first version.

### Risk: Audio/video sync drift

Mitigation:
- Use timeline timestamps as source of truth.
- For preview, accept minor drift.
- For export, move toward deterministic frame stepping.
- Add test projects with known beats/cuts.

### Risk: GitHub Pages and cross-origin isolation

Mitigation:
- Do not require threaded wasm for MVP.
- Keep ffmpeg.wasm optional.
- Consider a service-worker-based COOP/COEP workaround only after testing.
- Document that Netlify, Cloudflare Pages, or Vercel may be better for advanced wasm features if GitHub Pages becomes a blocker.

---

## 15. Test Plan

### Functional tests

- Import image formats: JPEG, PNG, WebP.
- Import common video files: MP4, WebM.
- Import common audio files: MP3, WAV, AAC where supported.
- Drag clips to timeline.
- Resize image duration.
- Trim video clip.
- Place music under visual clips.
- Save project JSON.
- Open project JSON.
- Relink missing media.
- Export WebM.

### Browser tests

Test at minimum:

- Chrome desktop.
- Edge desktop.
- Firefox desktop.
- Safari desktop.

Mobile browsers are a stretch goal because timeline editing and export workloads are much harder on phones.

### Performance tests

- 10-image slideshow, 30 seconds, 1080p, 30 fps.
- 3 video clips, 60 seconds, 720p, 30 fps.
- 1 audio track, 3 minutes, 720p, 30 fps.
- Stress test with large 4K input files.

---

## 16. First Build Checklist

1. Create static app skeleton.
2. Add drag/drop import zone.
3. Generate thumbnails for images and videos.
4. Build basic project state store.
5. Render one image clip to canvas.
6. Build timeline scale and clip blocks.
7. Add clip dragging.
8. Add clip edge resizing.
9. Add playhead and preview playback.
10. Add audio import and playback.
11. Add project save/load JSON.
12. Add WebM export.
13. Add error messages and capability detection.
14. Deploy to GitHub Pages.
15. Test import, save, open, and export in target browsers.

---

## 17. Source/Reference Notes Checked for This Plan

These were used to validate that the plan fits current browser capabilities as of July 2026:

- MDN WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN using WebCodecs: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN Origin Private File System: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- MDN canvas `captureStream()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
- MDN MediaStream Recording API: https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API
- ffmpeg.wasm GitHub repository: https://github.com/ffmpegwasm/ffmpeg.wasm
- GitHub Pages HTTPS docs: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- GitHub community discussion on custom headers / COOP / COEP: https://github.com/orgs/community/discussions/13309
- Wasmer guide on COOP/COEP workaround for GitHub Pages: https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers/

---

## 18. Recommended First Milestone Definition

**Milestone name:** Slideshow MVP

A successful first milestone is not a full Premiere-style editor. It is a focused, working tool that can:

1. Import multiple photos.
2. Import one music file.
3. Arrange photos on a timeline.
4. Drag photo lengths.
5. Preview the result.
6. Save/reopen the project.
7. Export a WebM video.

Once that loop works reliably, add video clip trimming, then advanced export.

