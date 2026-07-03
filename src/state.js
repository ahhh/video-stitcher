// Central app state plus a tiny event bus.
// Events: 'project' (structure/settings/clips changed), 'assets', 'selection',
//         'playhead', 'playing', 'zoom', 'exporting'

export const state = {
  project: null,
  assets: new Map(), // assetId -> runtime asset (file, url, thumb, duration, ...)
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerSec: 40,
  exporting: false,
  dirty: false,
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) fn(payload);
}

export function markDirty() {
  state.dirty = true;
  emit('project');
}

export function setPlayhead(t) {
  state.playhead = Math.max(0, t);
  emit('playhead');
}

export function setSelection(clipId) {
  if (state.selectedClipId === clipId) return;
  state.selectedClipId = clipId;
  emit('selection');
}

export function getRuntimeAsset(assetId) {
  return state.assets.get(assetId) || null;
}
