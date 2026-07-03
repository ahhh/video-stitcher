import { uid, nextEvent } from './utils.js';
import { state, emit } from './state.js';
import { opfsWriteAsset } from './opfs.js';

const ACCEPT = 'image/*,video/*,audio/*';
export const ACCEPT_ATTR = ACCEPT;

function detectType(file) {
  const mime = file.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'flac'].includes(ext)) return 'audio';
  return null;
}

// Import files into the media bin. Returns { added, failed } asset name lists.
export async function importFiles(fileList) {
  const files = [...fileList];
  const added = [];
  const failed = [];
  for (const file of files) {
    const type = detectType(file);
    if (!type) {
      failed.push(`${file.name} (unsupported type)`);
      continue;
    }
    try {
      const asset = await buildAsset(file, type);
      state.assets.set(asset.id, asset);
      added.push(asset.name);
      opfsWriteAsset(asset.id, file); // mirror for autosave recovery (best-effort)
    } catch (err) {
      console.error('Import failed', file.name, err);
      failed.push(`${file.name} (${err.message || 'could not decode'})`);
    }
  }
  if (added.length) emit('assets');
  return { added, failed };
}

async function buildAsset(file, type) {
  const url = URL.createObjectURL(file);
  const asset = {
    id: uid('asset'),
    type,
    name: file.name,
    mimeType: file.type || '',
    file,
    url,
    duration: null,
    width: null,
    height: null,
    thumb: null,
    missing: false,
  };
  try {
    if (type === 'image') await probeImage(asset);
    else if (type === 'video') await probeVideo(asset);
    else await probeAudio(asset);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return asset;
}

async function probeImage(asset) {
  const bitmap = await createImageBitmap(asset.file);
  asset.width = bitmap.width;
  asset.height = bitmap.height;
  asset.thumb = makeThumb(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
}

async function probeVideo(asset) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = asset.url;
  await nextEvent(video, 'loadedmetadata');
  asset.duration = Number.isFinite(video.duration) ? video.duration : null;
  asset.width = video.videoWidth;
  asset.height = video.videoHeight;
  // Seek a little way in for a representative thumbnail frame.
  video.currentTime = Math.min(0.5, (asset.duration || 1) / 2);
  try {
    await nextEvent(video, 'seeked', { timeout: 5000 });
    asset.thumb = makeThumb(video, video.videoWidth, video.videoHeight);
  } catch {
    // Thumbnail is optional; keep the asset.
  }
  video.removeAttribute('src');
  video.load();
}

async function probeAudio(asset) {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = asset.url;
  await nextEvent(audio, 'loadedmetadata');
  asset.duration = Number.isFinite(audio.duration) ? audio.duration : null;
  audio.removeAttribute('src');
  audio.load();
  if (asset.duration == null) throw new Error('could not read audio duration');
}

const THUMB_H = 72;

function makeThumb(source, srcW, srcH) {
  if (!srcW || !srcH) return null;
  const h = THUMB_H;
  const w = Math.max(24, Math.round((srcW / srcH) * h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Attach a real file to a placeholder asset that came from an opened project.
export async function relinkAsset(asset, file) {
  const type = detectType(file);
  if (type !== asset.type) {
    throw new Error(`Expected a ${asset.type} file`);
  }
  const probed = await buildAsset(file, type);
  asset.file = probed.file;
  asset.url = probed.url;
  asset.thumb = probed.thumb;
  asset.width = probed.width;
  asset.height = probed.height;
  if (asset.duration == null) asset.duration = probed.duration;
  asset.missing = false;
  asset.name = file.name;
  opfsWriteAsset(asset.id, file); // keep the recovery cache in sync
  emit('assets');
}
