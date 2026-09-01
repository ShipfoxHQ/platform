import {brotliDecompressSync} from 'node:zlib';

const WOFF2_HEADER_BYTES = 48;
const WOFF2_SIGNATURE = 0x774f4632;
const MAX_WOFF2_TABLES = 64;
const FAMILY_NAME_ID = 1;
const NAME_TABLE_INDEX = 5;
const GLYF_TABLE_INDEX = 10;
const LOCA_TABLE_INDEX = 11;

type Woff2Table = {
  tag: string | undefined;
  transformedLength: number;
};
type Woff2Directory = {
  tables: Woff2Table[];
  compressedOffset: number;
  compressedSize: number;
};

/** Reads the family name from the WOFF2 name table used by the renderer. */
export function readFontFamily(font: Uint8Array): string | undefined {
  try {
    return familyNameFromNameTable(readWoff2NameTable(font));
  } catch {
    return undefined;
  }
}

function readWoff2NameTable(font: Uint8Array): Uint8Array | undefined {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const directory = readWoff2Directory(font, view);
  if (directory === undefined) return undefined;

  const compressedEnd = directory.compressedOffset + directory.compressedSize;
  if (compressedEnd > font.byteLength) return undefined;
  const decompressed = brotliDecompressSync(
    font.subarray(directory.compressedOffset, compressedEnd),
  );
  const dataLength = directory.tables.reduce((total, table) => total + table.transformedLength, 0);
  if (decompressed.byteLength !== dataLength) return undefined;

  let dataOffset = 0;
  for (const table of directory.tables) {
    if (table.tag === 'name') {
      return decompressed.subarray(dataOffset, dataOffset + table.transformedLength);
    }
    dataOffset += table.transformedLength;
  }
  return undefined;
}

function readWoff2Directory(font: Uint8Array, view: DataView): Woff2Directory | undefined {
  if (!hasWoff2Header(font, view)) return undefined;

  const tables: Woff2Table[] = [];
  let offset = WOFF2_HEADER_BYTES;
  for (let index = 0; index < view.getUint16(12); index += 1) {
    const entry = readWoff2Table(font, offset);
    if (entry === undefined) return undefined;
    tables.push(entry.table);
    offset = entry.nextOffset;
  }
  return {tables, compressedOffset: offset, compressedSize: view.getUint32(20)};
}

function hasWoff2Header(font: Uint8Array, view: DataView): boolean {
  if (font.byteLength < WOFF2_HEADER_BYTES) return false;
  const tableCount = view.getUint16(12);
  const fileLength = view.getUint32(8);
  return (
    view.getUint32(0) === WOFF2_SIGNATURE &&
    tableCount > 0 &&
    tableCount <= MAX_WOFF2_TABLES &&
    fileLength >= WOFF2_HEADER_BYTES &&
    fileLength <= font.byteLength
  );
}

function readWoff2Table(
  font: Uint8Array,
  startOffset: number,
): {table: Woff2Table; nextOffset: number} | undefined {
  const flags = byteAt(font, startOffset);
  if (flags === undefined) return undefined;
  const tagIndex = flags & 0x3f;
  const transformVersion = flags >> 6;
  const tagResult = readWoff2Tag(font, tagIndex, startOffset + 1);
  if (tagResult === undefined) return undefined;

  const originalLength = readBase128(font, tagResult.nextOffset);
  if (originalLength === undefined) return undefined;
  const transformed = readTransformedLength(
    font,
    originalLength.nextOffset,
    tagResult.tag,
    transformVersion,
    originalLength.value,
  );
  if (transformed === undefined) return undefined;

  return {
    table: {tag: tagResult.tag, transformedLength: transformed.value},
    nextOffset: transformed.nextOffset,
  };
}

function readWoff2Tag(
  font: Uint8Array,
  tagIndex: number,
  startOffset: number,
): {tag: string | undefined; nextOffset: number} | undefined {
  if (tagIndex !== 0x3f) return {tag: tagForIndex(tagIndex), nextOffset: startOffset};
  if (startOffset + 4 > font.byteLength) return undefined;
  return {
    tag: String.fromCharCode(...Array.from(font.subarray(startOffset, startOffset + 4))),
    nextOffset: startOffset + 4,
  };
}

function readTransformedLength(
  font: Uint8Array,
  startOffset: number,
  tag: string | undefined,
  transformVersion: number,
  originalLength: number,
): {value: number; nextOffset: number} | undefined {
  if (tag === 'glyf' || tag === 'loca') {
    if (transformVersion === 3) return {value: originalLength, nextOffset: startOffset};
    if (transformVersion !== 0) return undefined;
    return readBase128(font, startOffset);
  }
  if (transformVersion === 0) return {value: originalLength, nextOffset: startOffset};
  return readBase128(font, startOffset);
}

function tagForIndex(index: number): string | undefined {
  if (index === NAME_TABLE_INDEX) return 'name';
  if (index === GLYF_TABLE_INDEX) return 'glyf';
  if (index === LOCA_TABLE_INDEX) return 'loca';
  return undefined;
}

function readBase128(
  bytes: Uint8Array,
  startOffset: number,
): {value: number; nextOffset: number} | undefined {
  let value = 0;
  let offset = startOffset;
  for (let index = 0; index < 5; index += 1) {
    const byte = byteAt(bytes, offset);
    if (byte === undefined) return undefined;
    offset += 1;
    value = value * 128 + (byte & 0x7f);
    if (!Number.isSafeInteger(value) || value > 0x7fffffff) return undefined;
    if ((byte & 0x80) === 0) return {value, nextOffset: offset};
  }
  return undefined;
}

function familyNameFromNameTable(table: Uint8Array | undefined): string | undefined {
  if (table === undefined || table.byteLength < 6) return undefined;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  if (stringOffset > table.byteLength || 6 + count * 12 > table.byteLength) return undefined;

  for (let index = 0; index < count; index += 1) {
    const recordOffset = 6 + index * 12;
    const platform = view.getUint16(recordOffset);
    const nameId = view.getUint16(recordOffset + 6);
    if (nameId !== FAMILY_NAME_ID || (platform !== 0 && platform !== 3)) continue;

    const length = view.getUint16(recordOffset + 8);
    const relativeOffset = view.getUint16(recordOffset + 10);
    const start = stringOffset + relativeOffset;
    const end = start + length;
    if (end > table.byteLength || length % 2 !== 0) continue;

    const value = decodeUtf16Be(table.subarray(start, end)).trim();
    if (value.length > 0) return value;
  }

  return undefined;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let value = '';
  for (let index = 0; index < bytes.byteLength; index += 2) {
    const high = byteAt(bytes, index);
    const low = byteAt(bytes, index + 1);
    if (high === undefined || low === undefined) break;
    value += String.fromCharCode((high << 8) | low);
  }
  return value;
}

function byteAt(bytes: Uint8Array, offset: number): number | undefined {
  return offset >= 0 && offset < bytes.byteLength ? bytes[offset] : undefined;
}
