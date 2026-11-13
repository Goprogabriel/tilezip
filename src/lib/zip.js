/**
 * Minimal ZIP32 writer, STORE method (no recompression of PNG/JPEG/WebP).
 * No dependencies or executable content. Filenames are sanitized by the caller.
 * File payloads remain Blobs; only one payload is read at a time for its CRC.
 */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const encoder = new TextEncoder();
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function blobCrc(blob, signal) {
  let crc = 0xffffffff;
  const chunkSize = 1024 * 1024;
  for (let start = 0; start < blob.size; start += chunkSize) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await blob.slice(start, start + chunkSize).arrayBuffer());
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    await pause();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function record(length, signature) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

/** @param {{name: string, blob: Blob}[]} entries */
export async function createZip(entries, { signal, onProgress, date = new Date() } = {}) {
  if (!entries.length || entries.length > 65535) throw new RangeError('Invalid ZIP entry count.');
  const { time, date: day } = dosTimestamp(date);
  const localParts = [];
  const centralParts = [];
  const names = new Set();
  let offset = 0;
  let centralSize = 0;

  for (let i = 0; i < entries.length; i++) {
    signal?.throwIfAborted();
    const { name, blob } = entries[i];
    if (!name || /[/\\\0]/.test(name) || name === '.' || name === '..' || names.has(name)) {
      throw new TypeError('ZIP filenames must be unique, simple filenames.');
    }
    names.add(name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 65535 || blob.size > 0xffffffff) throw new RangeError('ZIP file is too large.');
    const crc = await blobCrc(blob, signal);

    const local = record(30, 0x04034b50);
    local.view.setUint16(4, 20, true); // ZIP version needed: 2.0
    local.view.setUint16(6, 0x0800, true); // UTF-8 filename
    local.view.setUint16(8, 0, true); // STORE
    local.view.setUint16(10, time, true);
    local.view.setUint16(12, day, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, blob.size, true);
    local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, nameBytes.length, true);
    localParts.push(local.bytes, nameBytes, blob);

    const central = record(46, 0x02014b50);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, time, true);
    central.view.setUint16(14, day, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, blob.size, true);
    central.view.setUint32(24, blob.size, true);
    central.view.setUint16(28, nameBytes.length, true);
    central.view.setUint32(42, offset, true);
    centralParts.push(central.bytes, nameBytes);
    centralSize += central.bytes.length + nameBytes.length;
    offset += local.bytes.length + nameBytes.length + blob.size;
    if (offset + centralSize + 22 > 0xffffffff) throw new RangeError('This archive exceeds the ZIP32 limit.');
    onProgress?.((i + 1) / entries.length);
    await pause();
  }

  signal?.throwIfAborted();
  const end = record(22, 0x06054b50);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end.bytes], { type: 'application/zip' });
}
