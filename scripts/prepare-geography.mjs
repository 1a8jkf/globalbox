import { createCanvas } from '@napi-rs/canvas';
import { geoPath } from 'd3-geo';
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CHUNK_SIZE, CHUNK_PADDING, WORLD_WIDTH, WORLD_HEIGHT, LEVELS, stepAt, createProjection } from '../src/world/config.ts';
import { encodeTerrain } from '../src/world/codec.ts';

const input = new URL('../data/geography/', import.meta.url);
const output = new URL('../public/geography/', import.meta.url);
const staging = new URL('../public/.geography-staging/', import.meta.url);
const sourceManifest = JSON.parse(await readFile(new URL('sources.json', input), 'utf8'));
const geography = [];
for (const asset of sourceManifest.assets) {
  const bytes = await readFile(new URL(asset.file, input));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Source checksum mismatch: ${asset.file}`);
  geography.push(JSON.parse(bytes.toString()));
}
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
const manifest = { version: 1, width: WORLD_WIDTH, height: WORLD_HEIGHT, chunkSize: CHUNK_SIZE, padding: CHUNK_PADDING, levels: LEVELS, projection: 'equal-earth-v1', source: sourceManifest, chunks: {} };
const padded = CHUNK_SIZE + CHUNK_PADDING * 2;
for (let level = 0; level < LEVELS; level++) {
  const step = stepAt(level), width = WORLD_WIDTH / step, height = WORLD_HEIGHT / step;
  const stripWidth = width + CHUNK_PADDING * 2;
  const canvas = createCanvas(stripWidth, padded), ctx = canvas.getContext('2d');
  const projection = createProjection(width, height), path = geoPath(projection, ctx);
  for (let row = 0; row < height / CHUNK_SIZE; row++) {
    const mask = new Uint8Array(stripWidth * padded);
    for (let layer = 0; layer < geography.length; layer++) {
      ctx.resetTransform(); ctx.clearRect(0, 0, stripWidth, padded);
      ctx.translate(CHUNK_PADDING, CHUNK_PADDING - row * CHUNK_SIZE);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.72;
      ctx.beginPath(); path(geography[layer]);
      if (layer === 2) ctx.stroke(); else ctx.fill();
      const pixels = ctx.getImageData(0, 0, stripWidth, padded).data;
      for (let i = 0; i < mask.length; i++) {
        if (pixels[i * 4 + 3] <= 90) continue;
        if (layer === 0) mask[i] = 1;
        else if (mask[i] === 1) mask[i] = layer + 1;
      }
    }
    for (let col = 0; col < width / CHUNK_SIZE; col++) {
      const key = `${level}/${col}/${row}`, values = new Uint8Array(padded * padded);
      for (let y = 0; y < padded; y++) values.set(mask.subarray(y * stripWidth + col * CHUNK_SIZE, y * stripWidth + col * CHUNK_SIZE + padded), y * padded);
      const uniform = values.every(value => value === values[0]);
      if (uniform) manifest.chunks[key] = { uniform: values[0] };
      else {
        const bytes = encodeTerrain(values), file = `${key}.bin`;
        await mkdir(new URL(`${level}/${col}/`, staging), { recursive: true });
        await writeFile(new URL(file, staging), bytes);
        manifest.chunks[key] = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
    }
    if (row % 8 === 0) console.log(`Level ${level + 1}/${LEVELS}: strip ${row + 1}/${height / CHUNK_SIZE}`);
  }
}
await writeFile(new URL('manifest.json', staging), JSON.stringify(manifest) + '\n');
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log(`Prepared ${Object.keys(manifest.chunks).length} geographic regions across ${LEVELS} levels.`);
