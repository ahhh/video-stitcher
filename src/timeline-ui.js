// Timeline panel: ruler, dynamic track rows (layers), clip drag/trim,
// vertical layer moves, snapping, zoom, playhead.
import { state, on, emit, markDirty, setSelection, getRuntimeAsset } from './state.js';
import {
  getVisualTracks, getAudioTracks, createClipForAsset, removeVisualTrack,
} from './project-schema.js';
import { clipEnd, getProjectDuration, findClip, maxClipDuration, getSnapTimes, snapTime } from './timeline.js';
import { seek, syncPausedVideos, requestRender } from './playback.js';
import { clamp, formatTime, escapeHtml } from './utils.js';

const MIN_CLIP_DURATION = 0.1;
const SNAP_PX = 8;
const ZOOM_MIN = 4;
const ZOOM_MAX = 400;
const PAD_SECONDS = 30; // scrollable space past the last clip

let els = {};
let dragging = false;

export function initTimelineUI() {
  els = {
    scroll: document.getElementById('timeline-scroll'),
    content: document.getElementById('timeline-content'),
    ruler: document.getElementById('ruler'),
    tracks: document.getElementById('tracks'),
    labels: document.getElementById('track-labels'),
    playhead: document.getElementById('playhead'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    durationLabel: document.getElementById('timeline-duration'),
  };

  els.zoomIn.addEventListener('click', () => zoomBy(1.4));
  els.zoomOut.addEventListener('click', () => zoomBy(1 / 1.4));
  els.scroll.addEventListener('wheel', onWheel, { passive: false });
  els.ruler.addEventListener('pointerdown', onRulerPointerDown);

  on('project', () => { if (!dragging) rebuild(); });
  on('zoom', rebuild);
  on('selection', updateSelectionStyles);
  on('assets', () => { if (!dragging) rebuild(); });
  on('playhead', updatePlayhead);

  rebuild();
}

// Rows top-to-bottom: visual layers reversed (topmost layer first), then audio.
function displayTracks() {
  return [...getVisualTracks(state.project)].reverse().concat(getAudioTracks(state.project));
}

function trackDisplayName(track) {
  if (track.type === 'visual') {
    const visuals = getVisualTracks(state.project);
    return `V${visuals.indexOf(track) + 1}`;
  }
  const audios = getAudioTracks(state.project);
  return `A${audios.indexOf(track) + 1}`;
}

// --- geometry helpers -------------------------------------------------------

function timeToPx(t) {
  return t * state.pxPerSec;
}

function pxToTime(px) {
  return px / state.pxPerSec;
}

function pointerTime(e) {
  const rect = els.content.getBoundingClientRect();
  return clamp(pxToTime(e.clientX - rect.left), 0, 60 * 60 * 4);
}

function contentSeconds() {
  const visible = els.scroll.clientWidth / state.pxPerSec;
  return Math.max(getProjectDuration(state.project) + PAD_SECONDS, visible);
}

// --- rendering --------------------------------------------------------------

export function rebuild() {
  if (!state.project) return;
  const width = Math.ceil(timeToPx(contentSeconds()));
  els.content.style.width = `${width}px`;
  renderRuler(width);
  renderTracks();
  updatePlayhead();
  updateSelectionStyles();
  els.durationLabel.textContent = formatTime(getProjectDuration(state.project));
}

function niceTickStep() {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of steps) {
    if (timeToPx(s) >= 70) return s;
  }
  return 600;
}

function renderRuler(width) {
  const step = niceTickStep();
  const secs = pxToTime(width);
  let html = '';
  for (let t = 0; t <= secs; t += step) {
    const label = step < 1 ? `${t.toFixed(2)}s` : formatTime(t).replace(/\.\d$/, '');
    html += `<div class="tick" style="left:${timeToPx(t)}px"><span>${label}</span></div>`;
  }
  els.ruler.innerHTML = html;
}

function renderTracks() {
  els.tracks.innerHTML = '';
  els.labels.querySelectorAll('.track-label').forEach((n) => n.remove());
  const visuals = getVisualTracks(state.project);

  for (const track of displayTracks()) {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.trackId = track.id;
    row.dataset.trackType = track.type;
    row.addEventListener('pointerdown', onTrackBackgroundPointerDown);
    row.addEventListener('dragover', onTrackDragOver);
    row.addEventListener('drop', onTrackDrop);
    for (const clip of track.clips) row.appendChild(buildClipEl(clip, track));
    els.tracks.appendChild(row);

    const label = document.createElement('div');
    label.className = 'track-label';
    const removable = track.type === 'visual' && visuals.length > 1 && visuals[0] !== track;
    label.innerHTML = `<span>${trackDisplayName(track)}</span>${
      removable ? '<button class="track-remove" title="Remove layer">×</button>' : ''
    }`;
    if (removable) {
      label.querySelector('.track-remove').addEventListener('click', () => removeLayer(track));
    }
    els.labels.appendChild(label);
  }
}

function removeLayer(track) {
  if (track.clips.length && !confirm(`Remove layer ${trackDisplayName(track)} and its ${track.clips.length} clip(s)?`)) {
    return;
  }
  if (removeVisualTrack(state.project, track.id)) {
    if (state.selectedClipId && !findClip(state.project, state.selectedClipId)) setSelection(null);
    markDirty();
    requestRender();
  }
}

function buildClipEl(clip, track) {
  const asset = getRuntimeAsset(clip.assetId);
  const el = document.createElement('div');
  el.className = `clip clip-${asset?.type || 'missing'}`;
  el.dataset.clipId = clip.id;
  el.style.left = `${timeToPx(clip.timelineStart)}px`;
  el.style.width = `${Math.max(4, timeToPx(clip.duration))}px`;
  if (asset?.missing) el.classList.add('clip-missing-media');
  if (asset?.thumb) el.style.backgroundImage = `url("${asset.thumb}")`;
  el.innerHTML = `
    <div class="clip-handle clip-handle-l" data-handle="l"></div>
    <span class="clip-label">${escapeHtml(asset?.name || 'missing')}</span>
    <div class="clip-handle clip-handle-r" data-handle="r"></div>`;
  el.addEventListener('pointerdown', (e) => onClipPointerDown(e, clip.id, track));
  return el;
}

function updateSelectionStyles() {
  for (const el of els.content.querySelectorAll('.clip')) {
    el.classList.toggle('selected', el.dataset.clipId === state.selectedClipId);
  }
}

function updatePlayhead() {
  const x = timeToPx(state.playhead);
  els.playhead.style.transform = `translateX(${x}px)`;
  if (state.playing) {
    const { scrollLeft, clientWidth } = els.scroll;
    if (x < scrollLeft || x > scrollLeft + clientWidth - 40) {
      els.scroll.scrollLeft = Math.max(0, x - 60);
    }
  }
}

// --- zoom --------------------------------------------------------------------

function zoomBy(factor, anchorClientX) {
  const rect = els.scroll.getBoundingClientRect();
  const anchorX = anchorClientX != null ? anchorClientX - rect.left : rect.width / 2;
  const anchorT = pxToTime(els.scroll.scrollLeft + anchorX);
  state.pxPerSec = clamp(state.pxPerSec * factor, ZOOM_MIN, ZOOM_MAX);
  emit('zoom');
  els.scroll.scrollLeft = Math.max(0, timeToPx(anchorT) - anchorX);
}

export function zoomIn() { zoomBy(1.4); }
export function zoomOut() { zoomBy(1 / 1.4); }

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
}

// --- playhead scrubbing -------------------------------------------------------

function onRulerPointerDown(e) {
  e.preventDefault();
  els.ruler.setPointerCapture(e.pointerId);
  const scrub = (ev) => seek(pointerTime(ev));
  scrub(e);
  const onMove = (ev) => scrub(ev);
  const onUp = () => {
    els.ruler.removeEventListener('pointermove', onMove);
    els.ruler.removeEventListener('pointerup', onUp);
  };
  els.ruler.addEventListener('pointermove', onMove);
  els.ruler.addEventListener('pointerup', onUp);
}

function onTrackBackgroundPointerDown(e) {
  if (e.target.closest('.clip')) return;
  setSelection(null);
  seek(pointerTime(e));
}

// --- clip drag / trim ----------------------------------------------------------

function onClipPointerDown(e, clipId, startTrack) {
  e.preventDefault();
  e.stopPropagation();
  if (state.exporting) return;
  setSelection(clipId);
  const found = findClip(state.project, clipId);
  if (!found) return;
  const { clip } = found;
  let curTrack = found.track;
  const asset = getRuntimeAsset(clip.assetId);
  const handle = e.target.dataset?.handle || null;
  const clipEl = e.currentTarget;

  const startX = e.clientX;
  const orig = { start: clip.timelineStart, duration: clip.duration, trimStart: clip.trimStart };
  const snapTimes = [...getSnapTimes(state.project, clipId), state.playhead];
  const threshold = () => SNAP_PX / state.pxPerSec;
  const hasTrim = asset && asset.duration != null; // video/audio: left edge trims source
  const canChangeLayer = !handle && startTrack.type === 'visual' && getVisualTracks(state.project).length > 1;
  // Row rects are stable during a drag — capture once.
  const rowRects = canChangeLayer
    ? [...els.tracks.querySelectorAll('.track[data-track-type="visual"]')].map((rowEl) => ({
        rowEl,
        trackId: rowEl.dataset.trackId,
        rect: rowEl.getBoundingClientRect(),
      }))
    : [];

  dragging = true;
  clipEl.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const dt = pxToTime(ev.clientX - startX);
    const noSnap = ev.shiftKey;
    if (handle === 'l') {
      let newStart = orig.start + dt;
      if (!noSnap) {
        const snapped = snapTime(newStart, snapTimes, threshold());
        if (snapped != null) newStart = snapped;
      }
      let delta = newStart - orig.start;
      // Clamp so duration stays positive, trim stays >= 0, start stays >= 0.
      delta = Math.min(delta, orig.duration - MIN_CLIP_DURATION);
      if (hasTrim) delta = Math.max(delta, -orig.trimStart);
      delta = Math.max(delta, -orig.start);
      clip.timelineStart = orig.start + delta;
      clip.duration = orig.duration - delta;
      if (hasTrim) clip.trimStart = orig.trimStart + delta;
    } else if (handle === 'r') {
      let newEnd = orig.start + orig.duration + dt;
      if (!noSnap) {
        const snapped = snapTime(newEnd, snapTimes, threshold());
        if (snapped != null) newEnd = snapped;
      }
      const maxDur = maxClipDuration(clip, asset);
      clip.duration = clamp(newEnd - orig.start, MIN_CLIP_DURATION, maxDur);
    } else {
      let newStart = Math.max(0, orig.start + dt);
      if (!noSnap) {
        const th = threshold();
        const snapStart = snapTime(newStart, snapTimes, th);
        const snapEnd = snapTime(newStart + orig.duration, snapTimes, th);
        const dStart = snapStart != null ? Math.abs(snapStart - newStart) : Infinity;
        const dEnd = snapEnd != null ? Math.abs(snapEnd - (newStart + orig.duration)) : Infinity;
        if (dStart <= dEnd && snapStart != null) newStart = snapStart;
        else if (snapEnd != null) newStart = snapEnd - orig.duration;
        newStart = Math.max(0, newStart);
      }
      clip.timelineStart = newStart;

      // Vertical: move the clip to the visual layer under the pointer.
      if (canChangeLayer) {
        const hit = rowRects.find(({ rect }) => ev.clientY >= rect.top && ev.clientY <= rect.bottom);
        if (hit && hit.trackId !== curTrack.id) {
          const newTrack = state.project.tracks.find((tr) => tr.id === hit.trackId);
          if (newTrack) {
            curTrack.clips.splice(curTrack.clips.indexOf(clip), 1);
            newTrack.clips.push(clip);
            hit.rowEl.appendChild(clipEl); // keep pointer capture alive
            curTrack = newTrack;
          }
        }
      }
    }
    clipEl.style.left = `${timeToPx(clip.timelineStart)}px`;
    clipEl.style.width = `${Math.max(4, timeToPx(clip.duration))}px`;
    emit('clip-edited', clip.id);
    requestRender();
  };

  const onUp = () => {
    clipEl.removeEventListener('pointermove', onMove);
    clipEl.removeEventListener('pointerup', onUp);
    clipEl.removeEventListener('pointercancel', onUp);
    dragging = false;
    markDirty();
    syncPausedVideos(state.playhead);
    requestRender();
  };

  clipEl.addEventListener('pointermove', onMove);
  clipEl.addEventListener('pointerup', onUp);
  clipEl.addEventListener('pointercancel', onUp);
}

// --- drop from media bin ---------------------------------------------------------

function onTrackDragOver(e) {
  if ([...e.dataTransfer.types].includes('application/x-timeline-asset')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onTrackDrop(e) {
  const assetId = e.dataTransfer.getData('application/x-timeline-asset');
  if (!assetId) return;
  e.preventDefault();
  addAssetClipAt(assetId, pointerTime(e), e.currentTarget.dataset.trackId);
}

// Places a clip for the asset. Visual assets go to the drop-target layer when
// it is a visual layer; audio always goes to the audio track.
export function addAssetClipAt(assetId, t, preferredTrackId) {
  const asset = getRuntimeAsset(assetId);
  if (!asset || !state.project) return;
  let track;
  if (asset.type === 'audio') {
    [track] = getAudioTracks(state.project);
  } else {
    const visuals = getVisualTracks(state.project);
    track = visuals.find((tr) => tr.id === preferredTrackId) || visuals[0];
  }
  if (!track) return;
  const clip = createClipForAsset(asset, Math.max(0, t));
  // Snap the drop to nearby edges so quick drops line up.
  const snapped = snapTime(clip.timelineStart, getSnapTimes(state.project, null), SNAP_PX / state.pxPerSec);
  if (snapped != null) clip.timelineStart = snapped;
  track.clips.push(clip);
  setSelection(clip.id);
  markDirty();
}

// Appends the asset after the last clip on its base track (double-click in bin).
export function appendAssetToTimeline(assetId) {
  const asset = getRuntimeAsset(assetId);
  if (!asset || !state.project) return;
  const track = asset.type === 'audio'
    ? getAudioTracks(state.project)[0]
    : getVisualTracks(state.project)[0];
  if (!track) return;
  const end = track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip = createClipForAsset(asset, end);
  track.clips.push(clip);
  setSelection(clip.id);
  markDirty();
}
