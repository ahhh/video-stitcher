// App bootstrap: wires the toolbar, preview, keyboard shortcuts, drag/drop
// import, autosave, and the panels together.
import { state, on, emit, markDirty, setSelection } from './state.js';
import { createProject, RESOLUTION_PRESETS, addVisualTrack, MAX_VISUAL_TRACKS } from './project-schema.js';
import { importFiles } from './media-import.js';
import { clearMediaCache } from './media-cache.js';
import { initPreview, syncPreviewCanvasSize, requestRender, togglePlay, pause, seek, clearAudioBufferCache } from './playback.js';
import { initTimelineUI, rebuild as rebuildTimeline, zoomIn, zoomOut } from './timeline-ui.js';
import {
  initMediaBin, initInspector, toast, showRelinkDialog, showExportDialog,
  showRecoverDialog, deleteSelectedClip, duplicateSelectedClip,
} from './ui.js';
import {
  saveProjectToFile, saveProjectBundle, openProjectFromFile, installProject,
  autosave, readAutosave, clearAutosave, restoreAssetsFromOpfs,
} from './storage.js';
import { opfsClearAssets } from './opfs.js';
import { getProjectDuration, findClip } from './timeline.js';
import { formatTime } from './utils.js';

const $ = (id) => document.getElementById(id);

function boot() {
  state.project = createProject();

  const canvas = $('preview-canvas');
  initPreview(canvas);
  syncPreviewCanvasSize(canvas);
  initTimelineUI();
  initMediaBin();
  initInspector();
  wireToolbar(canvas);
  wireTransport();
  wireFileDrop();
  wireKeyboard();
  wireStateDisplays();

  requestRender();
  setInterval(autosave, 15000);
  window.addEventListener('beforeunload', (e) => {
    autosave();
    if (state.dirty) e.preventDefault();
  });

  const saved = readAutosave();
  if (saved) {
    showRecoverDialog(
      async () => {
        installProject(saved);
        syncPreviewCanvasSize(canvas);
        applySettingsToControls();
        const restored = await restoreAssetsFromOpfs();
        if (restored) toast(`Recovered ${restored} media file${restored > 1 ? 's' : ''} from the local cache.`, { kind: 'success' });
        requestRender();
        if ([...state.assets.values()].some((a) => a.missing)) showRelinkDialog();
      },
      () => {
        clearAutosave();
        opfsClearAssets();
      },
    );
  }
}

// --- toolbar -----------------------------------------------------------------

function wireToolbar(canvas) {
  $('btn-new').addEventListener('click', () => {
    if (state.dirty && !confirm('Discard unsaved changes and start a new project?')) return;
    pause();
    clearMediaCache();
    clearAudioBufferCache();
    for (const asset of state.assets.values()) {
      if (asset.url) URL.revokeObjectURL(asset.url);
    }
    installProject(createProject());
    clearAutosave();
    opfsClearAssets();
    syncPreviewCanvasSize(canvas);
    applySettingsToControls();
    requestRender();
  });

  const openInput = $('open-input');
  $('btn-open').addEventListener('click', () => {
    if (state.dirty && !confirm('Discard unsaved changes and open another project?')) return;
    openInput.click();
  });
  openInput.addEventListener('change', async () => {
    const file = openInput.files[0];
    openInput.value = '';
    if (!file) return;
    try {
      pause();
      clearMediaCache();
      clearAudioBufferCache();
      await opfsClearAssets(); // cache belongs to the incoming project's assets
      const assets = await openProjectFromFile(file);
      syncPreviewCanvasSize(canvas);
      applySettingsToControls();
      requestRender();
      toast(`Opened "${state.project.name}".`, { kind: 'success' });
      if (assets.some((a) => a.missing)) showRelinkDialog();
    } catch (err) {
      toast(err.message, { kind: 'error' });
    }
  });

  const importInput = $('import-input');
  $('btn-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    await handleImport(importInput.files);
    importInput.value = '';
  });

  $('btn-save').addEventListener('click', () => {
    saveProjectToFile();
    toast('Project saved. Note: the file stores clip layout — media is relinked when you reopen it.');
  });

  $('btn-save-bundle').addEventListener('click', async () => {
    try {
      const skipped = await saveProjectBundle();
      if (skipped.length) toast(`Bundle saved, but missing media was left out: ${skipped.join(', ')}`, { kind: 'error', timeout: 6000 });
      else toast('Bundle saved — it contains the project and all media.', { kind: 'success' });
    } catch (err) {
      toast(`Could not save bundle: ${err.message}`, { kind: 'error' });
    }
  });

  $('btn-add-layer').addEventListener('click', () => {
    const track = addVisualTrack(state.project);
    if (!track) {
      toast(`Layer limit reached (${MAX_VISUAL_TRACKS} video layers).`, { kind: 'error' });
      return;
    }
    markDirty();
  });

  $('btn-export').addEventListener('click', () => {
    pause();
    showExportDialog();
  });

  $('btn-relink').addEventListener('click', showRelinkDialog);

  const nameInput = $('project-name');
  nameInput.addEventListener('change', () => {
    state.project.name = nameInput.value.trim() || 'Untitled project';
    markDirty();
  });

  const resSelect = $('resolution-select');
  resSelect.innerHTML = RESOLUTION_PRESETS
    .map((p) => `<option value="${p.id}">${p.label}</option>`)
    .join('');
  resSelect.addEventListener('change', () => {
    const preset = RESOLUTION_PRESETS.find((p) => p.id === resSelect.value);
    if (!preset) return;
    state.project.settings.width = preset.width;
    state.project.settings.height = preset.height;
    syncPreviewCanvasSize(canvas);
    markDirty();
    requestRender();
  });

  const fpsSelect = $('fps-select');
  fpsSelect.addEventListener('change', () => {
    state.project.settings.fps = Number(fpsSelect.value);
    markDirty();
  });

  applySettingsToControls();
}

function applySettingsToControls() {
  $('project-name').value = state.project.name;
  const { width, height, fps } = state.project.settings;
  const preset = RESOLUTION_PRESETS.find((p) => p.width === width && p.height === height);
  $('resolution-select').value = preset ? preset.id : RESOLUTION_PRESETS[1].id;
  $('fps-select').value = String(fps);
}

// --- transport / preview -------------------------------------------------------

function wireTransport() {
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-to-start').addEventListener('click', () => seek(0));
  $('btn-to-end').addEventListener('click', () => seek(getProjectDuration(state.project)));
  on('playing', () => {
    $('btn-play').textContent = state.playing ? '⏸' : '▶';
  });
}

function wireStateDisplays() {
  const timeEl = $('time-display');
  const update = () => {
    timeEl.textContent = `${formatTime(state.playhead)} / ${formatTime(getProjectDuration(state.project))}`;
  };
  on('playhead', update);
  on('project', () => {
    update();
    requestRender();
  });
  on('exporting', () => {
    document.body.classList.toggle('exporting', state.exporting);
  });
  update();
}

// --- import (button + page-wide drag/drop) ----------------------------------------

async function handleImport(fileList) {
  if (!fileList?.length) return;
  toast(`Importing ${fileList.length} file${fileList.length > 1 ? 's' : ''}…`, { timeout: 1500 });
  const { added, failed } = await importFiles(fileList);
  if (added.length) toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''}.`, { kind: 'success' });
  for (const f of failed) toast(`Skipped ${f}`, { kind: 'error', timeout: 6000 });
}

function wireFileDrop() {
  const overlay = $('drop-overlay');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    depth += 1;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    handleImport(e.dataTransfer.files);
  });
}

// --- keyboard shortcuts --------------------------------------------------------------

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (state.exporting) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelectedClip();
        break;
      case 'd':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          duplicateSelectedClip();
        }
        break;
      case 'Home':
        e.preventDefault();
        seek(0);
        break;
      case 'End':
        e.preventDefault();
        seek(getProjectDuration(state.project));
        break;
      case '+':
      case '=':
        zoomIn();
        break;
      case '-':
        zoomOut();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const step = e.shiftKey ? 1 : 1 / state.project.settings.fps;
        const found = state.selectedClipId ? findClip(state.project, state.selectedClipId) : null;
        if (found) {
          found.clip.timelineStart = Math.max(0, found.clip.timelineStart + dir * step);
          markDirty();
        } else {
          seek(state.playhead + dir * step);
        }
        break;
      }
      case 'Escape':
        setSelection(null);
        break;
      default:
        break;
    }
  });
}

// Rebuild the timeline when the window resizes (content width depends on viewport).
window.addEventListener('resize', () => {
  if (state.project) rebuildTimeline();
});

// emit is imported for completeness of the bus; reference to avoid tree-shake lint noise.
void emit;

boot();
