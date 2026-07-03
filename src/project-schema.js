import { uid } from './utils.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'timeline-composer';

export const RESOLUTION_PRESETS = [
  { id: '1080p', label: '1080p — 16:9 (1920×1080)', width: 1920, height: 1080 },
  { id: '720p', label: '720p — 16:9 (1280×720)', width: 1280, height: 720 },
  { id: 'square', label: 'Square (1080×1080)', width: 1080, height: 1080 },
  { id: 'vertical', label: 'Vertical — 9:16 (1080×1920)', width: 1080, height: 1920 },
];

export const DEFAULT_IMAGE_DURATION = 4;
export const MAX_VISUAL_TRACKS = 4;

export function createProject() {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    name: 'Untitled project',
    createdAt: now,
    updatedAt: now,
    settings: {
      width: 1280,
      height: 720,
      fps: 30,
      backgroundColor: '#000000',
    },
    assets: [],
    tracks: [
      { id: uid('track'), type: 'visual', clips: [] },
      { id: uid('track'), type: 'audio', clips: [] },
    ],
  };
}

export function getVisualTrack(project) {
  return project.tracks.find((t) => t.type === 'visual');
}

export function getAudioTrack(project) {
  return project.tracks.find((t) => t.type === 'audio');
}

// Visual tracks in render order: index 0 is the base layer (drawn first),
// later tracks draw on top.
export function getVisualTracks(project) {
  return project.tracks.filter((t) => t.type === 'visual');
}

export function getAudioTracks(project) {
  return project.tracks.filter((t) => t.type === 'audio');
}

// Inserts a new visual layer above the existing ones. Returns it, or null
// when the layer limit is reached.
export function addVisualTrack(project) {
  const visuals = getVisualTracks(project);
  if (visuals.length >= MAX_VISUAL_TRACKS) return null;
  const track = { id: uid('track'), type: 'visual', clips: [] };
  const lastVisualIdx = project.tracks.indexOf(visuals[visuals.length - 1]);
  project.tracks.splice(lastVisualIdx + 1, 0, track);
  return track;
}

// Removes a visual layer (never the base layer). Returns true on success.
export function removeVisualTrack(project, trackId) {
  const visuals = getVisualTracks(project);
  const track = visuals.find((t) => t.id === trackId);
  if (!track || visuals[0] === track) return false;
  project.tracks.splice(project.tracks.indexOf(track), 1);
  return true;
}

export function createClipForAsset(asset, timelineStart) {
  if (asset.type === 'audio') {
    return {
      id: uid('clip'),
      assetId: asset.id,
      timelineStart,
      duration: asset.duration ?? DEFAULT_IMAGE_DURATION,
      trimStart: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    };
  }
  return {
    id: uid('clip'),
    assetId: asset.id,
    timelineStart,
    duration: asset.type === 'video' ? (asset.duration ?? DEFAULT_IMAGE_DURATION) : DEFAULT_IMAGE_DURATION,
    trimStart: 0,
    fit: 'contain',
    opacity: 1,
    transform: { x: 0, y: 0, scale: 1 },
  };
}

// Serialize the project for saving: asset entries carry metadata only
// (in-memory storage mode — media is relinked on open).
export function serializeProject(project, assets) {
  const out = structuredClone(project);
  out.updatedAt = new Date().toISOString();
  out.assets = [...assets.values()].map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    mimeType: a.mimeType,
    duration: a.duration ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));
  return JSON.stringify(out, null, 2);
}

export function parseProject(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data.app !== APP_ID) {
    throw new Error('That file is not a Timeline Composer project.');
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported project version (${data.schemaVersion}).`);
  }
  if (!Array.isArray(data.assets) || !Array.isArray(data.tracks)) {
    throw new Error('Project file is missing assets or tracks.');
  }
  const settings = data.settings || {};
  data.settings = {
    width: Number(settings.width) || 1280,
    height: Number(settings.height) || 720,
    fps: Number(settings.fps) || 30,
    backgroundColor: settings.backgroundColor || '#000000',
  };
  data.name = data.name || 'Untitled project';
  if (!getVisualTrack(data)) data.tracks.unshift({ id: uid('track'), type: 'visual', clips: [] });
  if (!getAudioTrack(data)) data.tracks.push({ id: uid('track'), type: 'audio', clips: [] });
  for (const track of data.tracks) {
    track.clips = (track.clips || []).filter(
      (c) => c && c.assetId && Number.isFinite(c.timelineStart) && Number.isFinite(c.duration) && c.duration > 0,
    );
    for (const clip of track.clips) {
      clip.id = clip.id || uid('clip');
      clip.trimStart = Number(clip.trimStart) || 0;
      if (track.type === 'audio') {
        clip.volume = clip.volume == null ? 1 : Number(clip.volume);
        clip.fadeIn = Number(clip.fadeIn) || 0;
        clip.fadeOut = Number(clip.fadeOut) || 0;
      } else {
        clip.fit = clip.fit || 'contain';
        clip.opacity = clip.opacity == null ? 1 : Number(clip.opacity);
        const tr = clip.transform || {};
        clip.transform = {
          x: Number(tr.x) || 0,
          y: Number(tr.y) || 0,
          scale: Number(tr.scale) || 1,
        };
      }
    }
  }
  return data;
}
