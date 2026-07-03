// Media bin, inspector, dialogs, and toasts.
import { state, on, emit, markDirty, setSelection, getRuntimeAsset } from './state.js';
import { findClip, removeClip, maxClipDuration, clipEnd } from './timeline.js';
import { formatDuration, escapeHtml, clamp, downloadBlob } from './utils.js';
import { appendAssetToTimeline } from './timeline-ui.js';
import { relinkAsset } from './media-import.js';
import { dropAssetFromCache } from './media-cache.js';
import { opfsDeleteAsset } from './opfs.js';
import { requestRender, syncPausedVideos } from './playback.js';
import { exportWebM, pickSupportedMimeType } from './export-webm.js';

const TYPE_ICONS = { image: '🖼️', video: '🎬', audio: '🎵' };

// --- toasts -----------------------------------------------------------------

export function toast(message, { kind = 'info', timeout = 4000 } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

// --- media bin ----------------------------------------------------------------

export function initMediaBin() {
  on('assets', renderMediaBin);
  on('project', renderMediaBin);
  renderMediaBin();
}

function renderMediaBin() {
  const listEl = document.getElementById('media-list');
  const assets = [...state.assets.values()];
  if (!assets.length) {
    listEl.innerHTML = `<p class="bin-empty">Drop photos, videos, or music here,<br>or click <strong>Import</strong>.</p>`;
    return;
  }
  listEl.innerHTML = '';
  for (const asset of assets) {
    const el = document.createElement('div');
    el.className = 'media-item' + (asset.missing ? ' media-missing' : '');
    el.draggable = !asset.missing;
    el.title = asset.missing
      ? `${asset.name} — missing, open the relink dialog`
      : `${asset.name} — drag to timeline or double-click to append`;
    const thumb = asset.thumb
      ? `<img class="media-thumb" src="${asset.thumb}" alt="">`
      : `<div class="media-thumb media-thumb-icon">${TYPE_ICONS[asset.type] || '📄'}</div>`;
    el.innerHTML = `
      ${thumb}
      <div class="media-meta">
        <div class="media-name">${escapeHtml(asset.name)}</div>
        <div class="media-sub">${asset.type}${asset.duration != null ? ' · ' + formatDuration(asset.duration) : ''}${asset.missing ? ' · missing' : ''}</div>
      </div>
      <button class="media-remove" title="Remove from project">×</button>`;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-timeline-asset', asset.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dblclick', () => {
      if (!asset.missing) appendAssetToTimeline(asset.id);
    });
    el.querySelector('.media-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeAsset(asset.id);
    });
    listEl.appendChild(el);
  }
}

function removeAsset(assetId) {
  const used = state.project.tracks.some((t) => t.clips.some((c) => c.assetId === assetId));
  if (used && !confirm('This media is used on the timeline. Remove it and its clips?')) return;
  for (const track of state.project.tracks) {
    track.clips = track.clips.filter((c) => c.assetId !== assetId);
  }
  const asset = state.assets.get(assetId);
  if (asset?.url) URL.revokeObjectURL(asset.url);
  state.assets.delete(assetId);
  dropAssetFromCache(assetId);
  opfsDeleteAsset(assetId);
  if (state.selectedClipId && !findClip(state.project, state.selectedClipId)) setSelection(null);
  emit('assets');
  markDirty();
  requestRender();
}

// --- inspector ------------------------------------------------------------------

export function initInspector() {
  on('selection', renderInspector);
  on('project', renderInspector);
  on('clip-edited', renderInspector);
  renderInspector();
}

function renderInspector() {
  const el = document.getElementById('inspector-body');
  const found = state.selectedClipId ? findClip(state.project, state.selectedClipId) : null;
  if (!found) {
    el.innerHTML = `<p class="inspector-empty">Select a clip on the timeline to edit it.</p>`;
    return;
  }
  const { track, clip } = found;
  const asset = getRuntimeAsset(clip.assetId);
  const isAudio = track.type === 'audio';
  const hasTrim = asset && asset.duration != null;

  let html = `
    <div class="inspector-clip-name">${TYPE_ICONS[asset?.type] || ''} ${escapeHtml(asset?.name || 'missing media')}</div>
    ${numField('Start (s)', 'timelineStart', clip.timelineStart, 0.1, 0)}
    ${numField('Duration (s)', 'duration', clip.duration, 0.1, 0.1)}
    ${hasTrim ? numField('Trim in (s)', 'trimStart', clip.trimStart, 0.1, 0) : ''}`;

  if (isAudio) {
    html += `
      ${numField('Volume (0–1)', 'volume', clip.volume ?? 1, 0.05, 0, 1)}
      ${numField('Fade in (s)', 'fadeIn', clip.fadeIn ?? 0, 0.1, 0)}
      ${numField('Fade out (s)', 'fadeOut', clip.fadeOut ?? 0, 0.1, 0)}`;
  } else {
    const tr = clip.transform || { x: 0, y: 0, scale: 1 };
    html += `
      <label class="field">
        <span>Fit</span>
        <select data-prop="fit">
          <option value="contain"${clip.fit === 'contain' ? ' selected' : ''}>Contain (letterbox)</option>
          <option value="cover"${clip.fit === 'cover' ? ' selected' : ''}>Cover (crop)</option>
          <option value="stretch"${clip.fit === 'stretch' ? ' selected' : ''}>Stretch</option>
        </select>
      </label>
      ${numField('Opacity (0–1)', 'opacity', clip.opacity ?? 1, 0.05, 0, 1)}
      ${numField('Scale', 'transform.scale', tr.scale, 0.05, 0.05, 8)}
      ${numField('X offset (%)', 'transform.x', tr.x, 1, -100, 100)}
      ${numField('Y offset (%)', 'transform.y', tr.y, 1, -100, 100)}`;
  }
  html += `
    <div class="inspector-actions">
      <button id="clip-duplicate">Duplicate</button>
      <button id="clip-delete" class="danger">Delete</button>
    </div>`;
  el.innerHTML = html;

  for (const input of el.querySelectorAll('[data-prop]')) {
    input.addEventListener('change', () => applyClipEdit(clip, asset, track, input));
  }
  el.querySelector('#clip-delete').addEventListener('click', () => deleteSelectedClip());
  el.querySelector('#clip-duplicate').addEventListener('click', () => duplicateSelectedClip());
}

function numField(label, prop, value, step, min, max) {
  const maxAttr = max != null ? ` max="${max}"` : '';
  return `
    <label class="field">
      <span>${label}</span>
      <input type="number" data-prop="${prop}" value="${Number(value).toFixed(2)}" step="${step}" min="${min}"${maxAttr}>
    </label>`;
}

function applyClipEdit(clip, asset, track, input) {
  const prop = input.dataset.prop;
  if (prop === 'fit') {
    clip.fit = input.value;
  } else {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    if (prop === 'timelineStart') v = Math.max(0, v);
    if (prop === 'trimStart' && asset?.duration != null) v = clamp(v, 0, asset.duration - 0.1);
    if (prop === 'volume' || prop === 'opacity') v = clamp(v, 0, 1);
    if (prop === 'fadeIn' || prop === 'fadeOut') v = clamp(v, 0, clip.duration);
    if (prop === 'duration') v = clamp(v, 0.1, maxClipDuration(clip, asset));
    if (prop.startsWith('transform.')) {
      clip.transform = clip.transform || { x: 0, y: 0, scale: 1 };
      const key = prop.slice('transform.'.length);
      if (key === 'scale') v = clamp(v, 0.05, 8);
      else v = clamp(v, -100, 100);
      clip.transform[key] = v;
    } else {
      clip[prop] = v;
      if (prop === 'trimStart') clip.duration = Math.min(clip.duration, maxClipDuration(clip, asset));
    }
  }
  markDirty();
  syncPausedVideos(state.playhead);
  requestRender();
}

export function deleteSelectedClip() {
  if (!state.selectedClipId) return;
  removeClip(state.project, state.selectedClipId);
  setSelection(null);
  markDirty();
  requestRender();
}

export function duplicateSelectedClip() {
  const found = state.selectedClipId ? findClip(state.project, state.selectedClipId) : null;
  if (!found) return;
  const copy = structuredClone(found.clip);
  copy.id = `clip_${Math.random().toString(36).slice(2, 10)}`;
  copy.timelineStart = clipEnd(found.clip);
  found.track.clips.push(copy);
  setSelection(copy.id);
  markDirty();
}

// --- modal helpers -----------------------------------------------------------------

function openModal(innerHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  root.hidden = false;
  return root.querySelector('.modal');
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  root.hidden = true;
}

// --- relink dialog ------------------------------------------------------------------

export function showRelinkDialog() {
  const missing = [...state.assets.values()].filter((a) => a.missing);
  if (!missing.length) return;
  const rows = missing
    .map(
      (a) => `
      <div class="relink-row" data-asset-id="${a.id}">
        <span class="relink-status">✗</span>
        <span class="relink-name">${TYPE_ICONS[a.type] || ''} ${escapeHtml(a.name)}</span>
      </div>`,
    )
    .join('');
  const modal = openModal(`
    <h2>Relink media</h2>
    <p>This project references files that need to be located again. Pick the original
    files (you can select several at once) — they are matched by filename.</p>
    <div class="relink-list">${rows}</div>
    <div class="modal-actions">
      <button id="relink-pick" class="primary">Choose files…</button>
      <button id="relink-close">Done</button>
    </div>`);

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,video/*,audio/*';
  input.addEventListener('change', async () => {
    let matched = 0;
    for (const file of input.files) {
      const target = [...state.assets.values()].find((a) => a.missing && a.name === file.name)
        || [...state.assets.values()].find((a) => a.missing && a.type === detectRoughType(file));
      if (!target) continue;
      try {
        await relinkAsset(target, file);
        matched += 1;
        const row = modal.querySelector(`.relink-row[data-asset-id="${target.id}"]`);
        if (row) {
          row.querySelector('.relink-status').textContent = '✓';
          row.classList.add('relinked');
        }
      } catch (err) {
        toast(`Could not relink ${file.name}: ${err.message}`, { kind: 'error' });
      }
    }
    if (matched) {
      markDirty();
      syncPausedVideos(state.playhead);
      requestRender();
    }
    if (![...state.assets.values()].some((a) => a.missing)) {
      closeModal();
      toast('All media relinked.', { kind: 'success' });
    }
  });
  modal.querySelector('#relink-pick').addEventListener('click', () => input.click());
  modal.querySelector('#relink-close').addEventListener('click', closeModal);
}

function detectRoughType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

// --- recover autosave dialog ----------------------------------------------------------

export function showRecoverDialog(onRecover, onDiscard) {
  const modal = openModal(`
    <h2>Recover project?</h2>
    <p>An autosaved project from a previous session was found. Recover it?
    (You'll be asked to relink your media files.)</p>
    <div class="modal-actions">
      <button id="recover-yes" class="primary">Recover</button>
      <button id="recover-no">Start fresh</button>
    </div>`);
  modal.querySelector('#recover-yes').addEventListener('click', () => {
    closeModal();
    onRecover();
  });
  modal.querySelector('#recover-no').addEventListener('click', () => {
    closeModal();
    onDiscard();
  });
}

// --- export dialog ---------------------------------------------------------------------

const QUALITY_PRESETS = [
  { id: 'high', label: 'High (12 Mbps)', bps: 12_000_000 },
  { id: 'medium', label: 'Medium (8 Mbps)', bps: 8_000_000 },
  { id: 'low', label: 'Low (4 Mbps)', bps: 4_000_000 },
];

export function showExportDialog() {
  const mime = pickSupportedMimeType();
  if (!mime) {
    toast('This browser cannot record WebM video. Try Chrome, Edge, or Firefox.', { kind: 'error' });
    return;
  }
  const { width, height, fps } = state.project.settings;
  const options = QUALITY_PRESETS.map(
    (q, i) => `<option value="${q.id}"${i === 1 ? ' selected' : ''}>${q.label}</option>`,
  ).join('');
  const modal = openModal(`
    <h2>Export video</h2>
    <p class="export-info">${width}×${height} @ ${fps} fps → WebM (${escapeHtml(mime)})<br>
    Export runs in real time — a 30&#8202;s timeline takes about 30&#8202;s. Keep this tab in the foreground.</p>
    <label class="field"><span>Quality</span><select id="export-quality">${options}</select></label>
    <div class="export-progress" hidden>
      <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
      <span class="progress-label">0%</span>
    </div>
    <div class="modal-actions">
      <button id="export-start" class="primary">Export</button>
      <button id="export-cancel">Cancel</button>
    </div>`);

  const startBtn = modal.querySelector('#export-start');
  const cancelBtn = modal.querySelector('#export-cancel');
  const progressWrap = modal.querySelector('.export-progress');
  const fill = modal.querySelector('.progress-fill');
  const label = modal.querySelector('.progress-label');
  let controller = null;

  startBtn.addEventListener('click', async () => {
    controller = new AbortController();
    startBtn.disabled = true;
    modal.querySelector('#export-quality').disabled = true;
    progressWrap.hidden = false;
    const bps = QUALITY_PRESETS.find((q) => q.id === modal.querySelector('#export-quality').value)?.bps;
    try {
      const { blob } = await exportWebM({
        videoBitsPerSecond: bps,
        signal: controller.signal,
        onProgress: (f) => {
          const pct = Math.round(f * 100);
          fill.style.width = `${pct}%`;
          label.textContent = `${pct}%`;
        },
      });
      const safeName = (state.project.name || 'video').replace(/[^\w.-]+/g, '-');
      downloadBlob(blob, `${safeName}.webm`);
      closeModal();
      toast('Export finished — check your downloads.', { kind: 'success' });
    } catch (err) {
      closeModal();
      if (err?.name === 'AbortError') toast('Export cancelled.');
      else toast(`Export failed: ${err.message}`, { kind: 'error' });
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (controller) controller.abort();
    else closeModal();
  });
}

