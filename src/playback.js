// Preview playback: drives the playhead from the audio clock, keeps hidden
// video elements in sync, and schedules music clips through Web Audio.
import { state, emit, setPlayhead } from './state.js';
import { getProjectDuration, getActiveVisualClips, clipEnd } from './timeline.js';
import { getAudioContext, getVideoElement, ensureAudioBuffer, ensureImageBitmap } from './media-cache.js';
import { renderFrame } from './renderer.js';
import { getVisualTracks, getAudioTracks } from './project-schema.js';

let previewCtx = null;
let rafId = 0;
let renderQueued = false;

// Playback clock state
let playStartTime = 0; // timeline seconds when play began
let playStartCtxTime = 0; // AudioContext.currentTime when play began
let activeAudioNodes = [];

export function initPreview(canvas) {
  previewCtx = canvas.getContext('2d');
}

export function syncPreviewCanvasSize(canvas) {
  const { width, height } = state.project.settings;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

// Coalesced single-frame render for the paused state.
export function requestRender() {
  if (renderQueued || !previewCtx) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!state.project) return;
    renderFrame(previewCtx, state.playhead);
  });
}

export function togglePlay() {
  if (state.playing) pause();
  else play();
}

export async function play() {
  if (state.playing || state.exporting || !state.project) return;
  const duration = getProjectDuration(state.project);
  if (duration <= 0) return;
  if (state.playhead >= duration - 0.01) setPlayhead(0);

  const ctx = getAudioContext();
  await ctx.resume();
  // Pre-decode audio so scheduling below is synchronous-ish.
  await preloadAudioBuffers();
  if (state.playing) return; // double-tap guard

  state.playing = true;
  playStartTime = state.playhead;
  playStartCtxTime = ctx.currentTime + 0.05;
  activeAudioNodes = scheduleAudioClips(ctx, ctx.destination, playStartTime, playStartCtxTime);
  emit('playing');
  rafId = requestAnimationFrame(tick);
}

export function pause() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(rafId);
  stopAudioNodes();
  pauseAllVideos();
  emit('playing');
  syncPausedVideos(state.playhead);
}

export function seek(t) {
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  setPlayhead(Math.max(0, t));
  if (wasPlaying) play();
  else {
    syncPausedVideos(state.playhead);
    requestRender();
  }
}

function tick() {
  if (!state.playing) return;
  const ctx = getAudioContext();
  const t = playStartTime + Math.max(0, ctx.currentTime - playStartCtxTime);
  const duration = getProjectDuration(state.project);
  if (t >= duration) {
    setPlayhead(duration);
    pause();
    return;
  }
  setPlayhead(t);
  syncPlayingVideos(t);
  renderFrame(previewCtx, t);
  rafId = requestAnimationFrame(tick);
}

// --- video element sync ---------------------------------------------------

function clipLocalTime(clip, t) {
  return t - clip.timelineStart + clip.trimStart;
}

function forEachVideoClip(fn) {
  for (const track of getVisualTracks(state.project)) {
    for (const clip of track.clips) {
      const asset = state.assets.get(clip.assetId);
      if (asset?.type === 'video' && !asset.missing) fn(clip, asset);
    }
  }
}

function syncPlayingVideos(t) {
  const active = new Set(getActiveVisualClips(state.project, t).map((c) => c.id));
  forEachVideoClip((clip) => {
    const video = getVideoElement(clip.assetId);
    if (!video) return;
    if (active.has(clip.id)) {
      const target = clipLocalTime(clip, t);
      if (video.paused) {
        video.currentTime = target;
        video.play().catch(() => {});
      } else if (Math.abs(video.currentTime - target) > 0.25) {
        video.currentTime = target; // drift correction
      }
    } else if (!video.paused) {
      video.pause();
    }
  });
}

function pauseAllVideos() {
  if (!state.project) return;
  forEachVideoClip((clip) => {
    const video = getVideoElement(clip.assetId);
    if (video && !video.paused) video.pause();
  });
}

// While paused/scrubbing, seek active videos to the frame under the playhead
// and re-render once the seek lands.
export function syncPausedVideos(t) {
  if (!state.project) return;
  const active = getActiveVisualClips(state.project, t);
  for (const clip of active) {
    const asset = state.assets.get(clip.assetId);
    if (asset?.type === 'video' && !asset.missing) {
      const video = getVideoElement(clip.assetId);
      if (!video) continue;
      const target = clipLocalTime(clip, t);
      if (Math.abs(video.currentTime - target) > 1 / 60) {
        video.currentTime = target;
        video.addEventListener('seeked', requestRender, { once: true });
      }
    } else if (asset?.type === 'image') {
      ensureImageBitmap(clip.assetId).then(requestRender);
    }
  }
}

// --- audio scheduling (shared with export) --------------------------------

function allAudioClips() {
  return getAudioTracks(state.project).flatMap((t) => t.clips);
}

async function preloadAudioBuffers() {
  const jobs = [];
  for (const clip of allAudioClips()) {
    const asset = state.assets.get(clip.assetId);
    if (asset && !asset.missing) {
      jobs.push(
        ensureAudioBuffer(clip.assetId)
          .then((buf) => { if (buf) readyBuffers.set(clip.assetId, buf); })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
}

export { preloadAudioBuffers };

// Schedule every audio clip that is still (partly) ahead of timeline time
// `fromT`, mapped so that `fromT` plays at AudioContext time `ctxT0`.
// Returns the started nodes so playback can stop them on pause.
export function scheduleAudioClips(audioCtx, destination, fromT, ctxT0) {
  const nodes = [];
  for (const clip of allAudioClips()) {
    const asset = state.assets.get(clip.assetId);
    if (!asset || asset.missing) continue;
    const buffer = bufferIfReady(clip.assetId);
    if (!buffer) continue;
    if (clipEnd(clip) <= fromT) continue;

    const startOffsetInClip = Math.max(0, fromT - clip.timelineStart);
    const when = ctxT0 + Math.max(0, clip.timelineStart - fromT);
    const bufferOffset = clip.trimStart + startOffsetInClip;
    const playDuration = clip.duration - startOffsetInClip;
    if (playDuration <= 0 || bufferOffset >= buffer.duration) continue;

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = audioCtx.createGain();
    applyGainEnvelope(gain.gain, clip, when, startOffsetInClip);
    source.connect(gain).connect(destination);
    source.start(when, bufferOffset, playDuration);
    nodes.push(source);
  }
  return nodes;
}

const readyBuffers = new Map();

function bufferIfReady(assetId) {
  const cached = readyBuffers.get(assetId);
  if (cached) return cached;
  ensureAudioBuffer(assetId)?.then((buf) => {
    if (buf) readyBuffers.set(assetId, buf);
  }).catch(() => {});
  return readyBuffers.get(assetId) || null;
}

export function clearAudioBufferCache() {
  readyBuffers.clear();
}

// Volume with linear fade in/out. `when` is the AudioContext time at which
// the clip starts playing, `intoClip` is how far into the clip that is.
function applyGainEnvelope(gainParam, clip, when, intoClip) {
  const vol = clip.volume ?? 1;
  const fadeIn = clip.fadeIn || 0;
  const fadeOut = clip.fadeOut || 0;
  const remaining = clip.duration - intoClip;

  const envelopeAt = (local) => {
    let v = vol;
    if (fadeIn > 0 && local < fadeIn) v = Math.min(v, vol * (local / fadeIn));
    const fromEnd = clip.duration - local;
    if (fadeOut > 0 && fromEnd < fadeOut) v = Math.min(v, vol * (fromEnd / fadeOut));
    return Math.max(0, v);
  };

  gainParam.setValueAtTime(envelopeAt(intoClip), when);
  if (fadeIn > 0 && intoClip < fadeIn) {
    gainParam.linearRampToValueAtTime(vol, when + (fadeIn - intoClip));
  }
  if (fadeOut > 0) {
    const fadeOutStartLocal = Math.max(intoClip, clip.duration - fadeOut);
    const rampStart = when + (fadeOutStartLocal - intoClip);
    gainParam.setValueAtTime(envelopeAt(fadeOutStartLocal), rampStart);
    gainParam.linearRampToValueAtTime(0, when + remaining);
  }
}

function stopAudioNodes() {
  for (const node of activeAudioNodes) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  activeAudioNodes = [];
}
