// Runtime decode cache: ImageBitmaps, hidden <video> elements, AudioBuffers.
import { state } from './state.js';

const bitmaps = new Map(); // assetId -> ImageBitmap | Promise
const videos = new Map(); // assetId -> HTMLVideoElement
const audioBuffers = new Map(); // assetId -> Promise<AudioBuffer>

let sharedCtx = null;

export function getAudioContext() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}

export function getImageBitmapSync(assetId) {
  const entry = bitmaps.get(assetId);
  return entry instanceof ImageBitmap ? entry : null;
}

export async function ensureImageBitmap(assetId) {
  const existing = bitmaps.get(assetId);
  if (existing) return existing;
  const asset = state.assets.get(assetId);
  if (!asset?.file) return null;
  const promise = createImageBitmap(asset.file).then((bmp) => {
    bitmaps.set(assetId, bmp);
    return bmp;
  });
  bitmaps.set(assetId, promise);
  return promise;
}

export function getVideoElement(assetId) {
  let video = videos.get(assetId);
  if (video) return video;
  const asset = state.assets.get(assetId);
  if (!asset?.url) return null;
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = asset.url;
  video.load();
  videos.set(assetId, video);
  return video;
}

export async function ensureAudioBuffer(assetId) {
  const existing = audioBuffers.get(assetId);
  if (existing) return existing;
  const asset = state.assets.get(assetId);
  if (!asset?.file) return null;
  const promise = asset.file
    .arrayBuffer()
    .then((buf) => getAudioContext().decodeAudioData(buf))
    .catch((err) => {
      audioBuffers.delete(assetId);
      throw err;
    });
  audioBuffers.set(assetId, promise);
  return promise;
}

export function clearMediaCache() {
  for (const bmp of bitmaps.values()) {
    if (bmp instanceof ImageBitmap) bmp.close();
  }
  bitmaps.clear();
  for (const video of videos.values()) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  videos.clear();
  audioBuffers.clear();
}

export function dropAssetFromCache(assetId) {
  const bmp = bitmaps.get(assetId);
  if (bmp instanceof ImageBitmap) bmp.close();
  bitmaps.delete(assetId);
  const video = videos.get(assetId);
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  videos.delete(assetId);
  audioBuffers.delete(assetId);
}
