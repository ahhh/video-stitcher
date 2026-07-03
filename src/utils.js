let uidCounter = 0;

export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds, { withFrames = false, fps = 30 } = {}) {
  const s = Math.max(0, seconds);
  const totalSecs = Math.floor(s);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const base = `${mins}:${String(secs).padStart(2, '0')}`;
  if (withFrames) {
    const frames = Math.floor((s - totalSecs) * fps);
    return `${base}.${String(frames).padStart(2, '0')}`;
  }
  const tenths = Math.floor((s - totalSecs) * 10);
  return `${base}.${tenths}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function nextEvent(target, event, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    const onEvent = () => { cleanup(); resolve(); };
    const onError = (e) => { cleanup(); reject(e.error || new Error(`Error waiting for "${event}"`)); };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
