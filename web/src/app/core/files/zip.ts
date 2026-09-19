/**
 * Just enough ZIP to read and write `.xlsx` files, which are ZIP archives of XML.
 *
 * Writing stores entries uncompressed: the workbooks are a few kilobytes, and
 * every spreadsheet program opens stored entries. Reading handles both stored
 * and deflated entries — Excel and Google Sheets deflate — using the browser's
 * own `DecompressionStream`, so no library is needed.
 */

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ZipArchive {
  readonly names: readonly string[];
  /** The entry's bytes, or `null` when the archive has no such entry. */
  read(name: string): Promise<Uint8Array | null>;
}

export class ZipFormatError extends Error {}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Bit 11: names are UTF-8. */
const UTF8_FLAG = 0x0800;
/** 1 January 1980, the earliest DOS date — the files need a date, not a real one. */
const DOS_DATE = 0x0021;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_HEADER, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_HEADER, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    parts.push(local, entry.data);
    directory.push(central);
    offset += local.length + size;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...directory, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of all) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

export function readZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record sits at the very end, after an optional comment of up to 64 KB.
  let end = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new ZipFormatError('Not a ZIP archive.');
  }

  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, { readonly method: number; readonly start: number; readonly size: number }>();

  for (let i = 0; i < count; i++) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== CENTRAL_HEADER) {
      throw new ZipFormatError('The archive directory is damaged.');
    }
    const method = view.getUint16(pointer + 10, true);
    const size = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;

    // The local header's extra field can differ from the directory's, so read its own lengths.
    const start =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    entries.set(name, { method, start, size });
  }

  return {
    names: [...entries.keys()],
    async read(name: string): Promise<Uint8Array | null> {
      const entry = entries.get(name);
      if (entry === undefined) {
        return null;
      }
      const raw = bytes.subarray(entry.start, entry.start + entry.size);
      if (entry.method === 0) {
        return raw;
      }
      if (entry.method === 8) {
        return inflateRaw(raw);
      }
      throw new ZipFormatError(`Unsupported compression in ${name}.`);
    },
  };
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
