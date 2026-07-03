// Minimal ZIP support for project bundles — no dependencies.
// Writer emits uncompressed (stored) entries; reader handles stored and
// deflate entries (via DecompressionStream), which covers zips from other tools.

let crcTable = null;

function buildCrcTable() {
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
}

export function crc32(bytes) {
  if (!crcTable) buildCrcTable();
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name: string, data: Uint8Array }] → Blob (application/zip)
export function createZip(entries) {
  const te = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameB = te.encode(name);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // method: store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);

    offset += 30 + nameB.length + data.length;
  }

  let cdSize = 0;
  for (const p of central) cdSize += p.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

// ArrayBuffer → Map(name → Uint8Array)
export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid zip file');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip file');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new Error('Zip64 archives are not supported');
    }
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = comp.slice();
    else if (method === 8) data = await inflateRaw(comp);
    else throw new Error(`Unsupported zip compression (method ${method})`);

    if (!name.endsWith('/')) out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(comp) {
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
