/** Terrain RLE: terrain byte + nonzero unsigned 16-bit little-endian run length. */
export function encodeTerrain(values: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < values.length;) {
    const value = values[i];
    if (value > 3) throw new Error('Invalid terrain value');
    let count = 1;
    while (i + count < values.length && values[i + count] === value && count < 65535) count++;
    bytes.push(value, count & 255, count >>> 8); i += count;
  }
  return Uint8Array.from(bytes);
}
export function decodeTerrain(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length % 3 !== 0) throw new Error('Truncated terrain data');
  const values = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const count = bytes[i + 1] | (bytes[i + 2] << 8), value = bytes[i];
    if (value > 3 || count === 0 || offset + count > length) throw new Error('Invalid terrain run');
    values.fill(value, offset, offset + count); offset += count;
  }
  if (offset !== length) throw new Error('Incomplete terrain data');
  return values;
}
