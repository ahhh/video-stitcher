// Phase 1 export: real-time canvas capture + MediaRecorder → .webm blob.
import { state, emit } from './state.js';
import { getProjectDuration, getActiveVisualClips } from './timeline.js';
import { getAudioContext, getVideoElement } from './media-cache.js';
import { renderFrame } from './renderer.js';
import { getVisualTracks } from './project-schema.js';
import { preloadAudioBuffers, scheduleAudioClips, pause } from './playback.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

// Renders the whole timeline in real time and records it.
// options: { videoBitsPerSecond, onProgress(fraction), signal (AbortSignal) }
export async function exportWebM({ videoBitsPerSecond = 8_000_000, onProgress, signal } = {}) {
  const project = state.project;
  const duration = getProjectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty — add some clips first.');
  const mimeType = pickSupportedMimeType();
  if (!mimeType) throw new Error('This browser does not support WebM recording (MediaRecorder).');

  pause();
  state.exporting = true;
  emit('exporting');

  const { width, height, fps } = project.settings;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d');

  const audioCtx = getAudioContext();
  await audioCtx.resume();
  await preloadAudioBuffers();

  const videoStream = canvas.captureStream(fps);
  const audioDest = audioCtx.createMediaStreamDestination();
  const mixedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks(),
  ]);

  const chunks = [];
  const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let audioNodes = [];
  let rafId = 0;
  let cancelled = false;

  const stopEverything = () => {
    cancelAnimationFrame(rafId);
    for (const node of audioNodes) {
      try { node.stop(); } catch { /* ok */ }
    }
    pauseExportVideos();
    for (const track of mixedStream.getTracks()) track.stop();
  };

  const blob = await new Promise((resolve, reject) => {
    recorder.onstop = () => {
      stopEverything();
      if (cancelled) reject(new DOMException('Export cancelled', 'AbortError'));
      else resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = (e) => {
      stopEverything();
      reject(e.error || new Error('Recording failed'));
    };
    if (signal) {
      signal.addEventListener('abort', () => {
        cancelled = true;
        if (recorder.state !== 'inactive') recorder.stop();
      }, { once: true });
    }

    recorder.start(250);
    const ctxT0 = audioCtx.currentTime + 0.1;
    audioNodes = scheduleAudioClips(audioCtx, audioDest, 0, ctxT0);

    const step = () => {
      if (cancelled) return;
      const t = Math.max(0, audioCtx.currentTime - ctxT0);
      if (t >= duration) {
        renderFrame(ctx2d, duration - 1 / fps);
        onProgress?.(1);
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      syncExportVideos(t);
      renderFrame(ctx2d, t);
      onProgress?.(t / duration);
      rafId = requestAnimationFrame(step);
    };
    // Seed the first frame before audio starts.
    prepareExportVideos();
    renderFrame(ctx2d, 0);
    rafId = requestAnimationFrame(step);
  }).finally(() => {
    state.exporting = false;
    emit('exporting');
  });

  return { blob, mimeType };
}

function forEachVideoClip(fn) {
  for (const track of getVisualTracks(state.project)) {
    for (const clip of track.clips) {
      const asset = state.assets.get(clip.assetId);
      if (asset?.type === 'video' && !asset.missing) fn(clip);
    }
  }
}

function prepareExportVideos() {
  forEachVideoClip((clip) => {
    const video = getVideoElement(clip.assetId);
    if (video) {
      video.pause();
      video.currentTime = clip.trimStart;
    }
  });
}

function syncExportVideos(t) {
  const active = new Set(getActiveVisualClips(state.project, t).map((c) => c.id));
  forEachVideoClip((clip) => {
    const video = getVideoElement(clip.assetId);
    if (!video) return;
    if (active.has(clip.id)) {
      const target = t - clip.timelineStart + clip.trimStart;
      if (video.paused) {
        video.currentTime = target;
        video.play().catch(() => {});
      } else if (Math.abs(video.currentTime - target) > 0.25) {
        video.currentTime = target;
      }
    } else if (!video.paused) {
      video.pause();
    }
  });
}

function pauseExportVideos() {
  if (!state.project) return;
  forEachVideoClip((clip) => {
    const video = getVideoElement(clip.assetId);
    if (video && !video.paused) video.pause();
  });
}
