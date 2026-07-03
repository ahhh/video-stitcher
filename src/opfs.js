// Origin Private File System asset cache — best-effort, feature-detected.
// Media imported into the app is mirrored here so autosave recovery can
// restore it without asking the user to relink.

const ASSETS_DIR = 'assets';

export function opfsSupported() {
  return !!navigator.storage?.getDirectory;
}

async function assetsDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ASSETS_DIR, { create });
}

export async function opfsWriteAsset(assetId, file) {
  if (!opfsSupported()) return false;
  try {
    const dir = await assetsDir(true);
    const handle = await dir.getFileHandle(assetId, { create: true });
    if (!handle.createWritable) return false; // older Safari
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function opfsReadAsset(assetId, name, mimeType) {
  if (!opfsSupported()) return null;
  try {
    const dir = await assetsDir(false);
    const handle = await dir.getFileHandle(assetId);
    const file = await handle.getFile();
    return new File([file], name, { type: mimeType || file.type || '' });
  } catch {
    return null;
  }
}

export async function opfsDeleteAsset(assetId) {
  if (!opfsSupported()) return;
  try {
    const dir = await assetsDir(false);
    await dir.removeEntry(assetId);
  } catch {
    // already gone
  }
}

export async function opfsClearAssets() {
  if (!opfsSupported()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(ASSETS_DIR, { recursive: true });
  } catch {
    // nothing cached
  }
}
