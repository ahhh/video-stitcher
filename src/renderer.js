// Draws the composed frame for a given timeline time onto a 2D context.
import { state } from './state.js';
import { getActiveVisualClips } from './timeline.js';
import { ensureImageBitmap, getImageBitmapSync, getVideoElement } from './media-cache.js';

export function renderFrame(ctx, t) {
  const project = state.project;
  const { width, height, backgroundColor } = project.settings;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  for (const clip of getActiveVisualClips(project, t)) {
    const asset = state.assets.get(clip.assetId);
    if (!asset || asset.missing) {
      drawMissingPlaceholder(ctx, width, height, asset?.name);
      continue;
    }
    if (asset.type === 'image') {
      const bmp = getImageBitmapSync(clip.assetId);
      if (bmp) drawClip(ctx, bmp, bmp.width, bmp.height, clip, width, height);
      else ensureImageBitmap(clip.assetId); // decode kicks off; next render picks it up
    } else if (asset.type === 'video') {
      const video = getVideoElement(clip.assetId);
      if (video && video.readyState >= 2) {
        drawClip(ctx, video, video.videoWidth, video.videoHeight, clip, width, height);
      }
    }
  }
}

function drawClip(ctx, source, srcW, srcH, clip, outW, outH) {
  if (!srcW || !srcH) return;
  const tr = clip.transform || { x: 0, y: 0, scale: 1 };
  const userScale = tr.scale || 1;
  // x/y offsets are percentages of the output size, so they survive
  // resolution changes.
  const offX = ((tr.x || 0) / 100) * outW;
  const offY = ((tr.y || 0) / 100) * outH;

  let w;
  let h;
  if (clip.fit === 'stretch') {
    w = outW;
    h = outH;
  } else {
    const fitScale = clip.fit === 'cover'
      ? Math.max(outW / srcW, outH / srcH)
      : Math.min(outW / srcW, outH / srcH);
    w = srcW * fitScale;
    h = srcH * fitScale;
  }
  w *= userScale;
  h *= userScale;
  const x = (outW - w) / 2 + offX;
  const y = (outH - h) / 2 + offY;

  ctx.save();
  ctx.globalAlpha = clip.opacity == null ? 1 : clip.opacity;
  ctx.drawImage(source, x, y, w, h);
  ctx.restore();
}

function drawMissingPlaceholder(ctx, width, height, name) {
  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#8a8a99';
  ctx.font = `${Math.round(height / 24)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Missing media${name ? `: ${name}` : ''}`, width / 2, height / 2);
}
