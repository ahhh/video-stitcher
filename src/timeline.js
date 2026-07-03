// Pure timeline model helpers — no DOM.
import { getVisualTracks, getAudioTracks } from './project-schema.js';

export function clipEnd(clip) {
  return clip.timelineStart + clip.duration;
}

export function getProjectDuration(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}

export function getActiveClips(track, t) {
  return track.clips
    .filter((c) => t >= c.timelineStart && t < clipEnd(c))
    .sort((a, b) => a.timelineStart - b.timelineStart);
}

// Active visual clips across all layers, in paint order (base layer first).
export function getActiveVisualClips(project, t) {
  return getVisualTracks(project).flatMap((track) => getActiveClips(track, t));
}

export function getActiveAudioClips(project, t) {
  return getAudioTracks(project).flatMap((track) => getActiveClips(track, t));
}

export function findClip(project, clipId) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function removeClip(project, clipId) {
  for (const track of project.tracks) {
    const i = track.clips.findIndex((c) => c.id === clipId);
    if (i >= 0) {
      track.clips.splice(i, 1);
      return true;
    }
  }
  return false;
}

// Maximum duration a clip may have given its trim and source length.
// Images are unbounded.
export function maxClipDuration(clip, asset) {
  if (!asset || asset.duration == null) return Infinity;
  return Math.max(0.05, asset.duration - clip.trimStart);
}

// All times other clips' edges sit at — used for snapping.
export function getSnapTimes(project, excludeClipId) {
  const times = [0];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      times.push(clip.timelineStart, clipEnd(clip));
    }
  }
  return times;
}

export function snapTime(t, snapTimes, thresholdSecs) {
  let best = null;
  let bestDist = thresholdSecs;
  for (const s of snapTimes) {
    const d = Math.abs(t - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  // Whole seconds as a weaker fallback snap.
  if (best == null) {
    const whole = Math.round(t);
    if (Math.abs(t - whole) < thresholdSecs) best = whole;
  }
  return best;
}
