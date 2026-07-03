// Save/open project JSON, project bundles (.zip with media), a localStorage
// autosave, and OPFS-based media recovery.
import { state, emit } from './state.js';
import { serializeProject, parseProject } from './project-schema.js';
import { downloadBlob } from './utils.js';
import { createZip, readZip } from './zip.js';
import { relinkAsset } from './media-import.js';
import { opfsReadAsset } from './opfs.js';

const AUTOSAVE_KEY = 'timeline-composer.autosave.v1';

function safeName() {
  return (state.project.name || 'project').replace(/[^\w.-]+/g, '-');
}

export function saveProjectToFile() {
  const json = serializeProject(state.project, state.assets);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName()}.timeline-composer.json`);
  state.dirty = false;
}

// Bundle: project.json + every media file, in one zip. Fully portable —
// opening it needs no relinking. Returns names of assets that could not be
// included (still missing).
export async function saveProjectBundle() {
  const json = serializeProject(state.project, state.assets);
  const entries = [{ name: 'project.json', data: new TextEncoder().encode(json) }];
  const skipped = [];
  for (const asset of state.assets.values()) {
    if (!asset.file) {
      skipped.push(asset.name);
      continue;
    }
    const cleanName = asset.name.replace(/[/\\]+/g, '-');
    entries.push({
      name: `assets/${asset.id}__${cleanName}`,
      data: new Uint8Array(await asset.file.arrayBuffer()),
    });
  }
  downloadBlob(createZip(entries), `${safeName()}.timeline.zip`);
  state.dirty = false;
  return skipped;
}

// Parses a project file (.json or bundle .zip) and installs it as the
// current project. Returns the runtime asset list (bundles come back with
// media attached; plain JSON assets are "missing" until relinked).
export async function openProjectFromFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return openBundle(buffer);
  return installProject(parseProject(new TextDecoder().decode(buffer)));
}

async function openBundle(buffer) {
  const entries = await readZip(buffer);
  const projectJson = entries.get('project.json');
  if (!projectJson) throw new Error('This zip is not a project bundle (no project.json).');
  installProject(parseProject(new TextDecoder().decode(projectJson)));

  for (const [name, data] of entries) {
    if (!name.startsWith('assets/')) continue;
    const base = name.slice('assets/'.length);
    const sep = base.indexOf('__');
    const id = sep > 0 ? base.slice(0, sep) : base;
    const asset = state.assets.get(id);
    if (!asset) continue;
    const file = new File([data], asset.name, { type: asset.mimeType || '' });
    try {
      await relinkAsset(asset, file);
    } catch (err) {
      console.error('Bundle asset failed to load', asset.name, err);
    }
  }
  return [...state.assets.values()];
}

// Try to restore missing assets from the OPFS cache (used after autosave
// recovery). Returns how many were restored.
export async function restoreAssetsFromOpfs() {
  let restored = 0;
  for (const asset of state.assets.values()) {
    if (!asset.missing) continue;
    const file = await opfsReadAsset(asset.id, asset.name, asset.mimeType);
    if (!file) continue;
    try {
      await relinkAsset(asset, file);
      restored += 1;
    } catch {
      // Corrupt cache entry — leave as missing, relink dialog covers it.
    }
  }
  return restored;
}

export function installProject(data) {
  const assetMeta = data.assets;
  data.assets = []; // runtime map is the source of truth for assets
  state.project = data;
  state.assets = new Map();
  for (const meta of assetMeta) {
    state.assets.set(meta.id, {
      id: meta.id,
      type: meta.type,
      name: meta.name,
      mimeType: meta.mimeType || '',
      file: null,
      url: null,
      duration: meta.duration ?? null,
      width: meta.width ?? null,
      height: meta.height ?? null,
      thumb: null,
      missing: true,
    });
  }
  state.selectedClipId = null;
  state.playhead = 0;
  state.dirty = false;
  emit('assets');
  emit('selection');
  emit('project');
  emit('playhead');
  return [...state.assets.values()];
}

// --- autosave --------------------------------------------------------------

export function autosave() {
  if (!state.project || !state.dirty) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.project, state.assets));
  } catch {
    // Quota or private mode — autosave is best-effort.
  }
}

export function readAutosave() {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return null;
    const data = parseProject(json);
    const hasContent = data.tracks.some((t) => t.clips.length > 0) || data.assets.length > 0;
    return hasContent ? data : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ok */ }
}
