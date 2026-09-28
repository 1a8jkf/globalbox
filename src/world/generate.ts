import { climateAt } from './climate.ts';
import { Terrain, type Region, type ChunkCells } from './types.ts';
import { CHUNK_SIZE, CHUNK_PADDING, createProjection, stepAt, type ChunkKey } from './config.ts';

/** Chamfer distance in cell units; land and inland water are zero. */
export function coastDistances(terrain: Uint8Array, width: number, height: number): Uint16Array {
  const distance = new Uint16Array(terrain.length);
  for (let i = 0; i < distance.length; i++) distance[i] = terrain[i] === Terrain.Ocean ? 30000 : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 3);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 3);
    if (x && y) distance[i] = Math.min(distance[i], distance[i - width - 1] + 4);
    if (x + 1 < width && y) distance[i] = Math.min(distance[i], distance[i - width + 1] + 4);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 3);
    if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 3);
    if (x + 1 < width && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width + 1] + 4);
    if (x && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width - 1] + 4);
  }
  return distance;
}

const projection = createProjection();
export function generateRegion(key: ChunkKey, terrain: Uint8Array, seed: number): Region {
  const width = CHUNK_SIZE + CHUNK_PADDING * 2, height = width, step = stepAt(key.level);
  if (terrain.length !== width * height) throw new Error('Wrong geographic mask size');
  const region: Region = {
    width, height, step, seed,
    originX: (key.x * CHUNK_SIZE - CHUNK_PADDING) * step,
    originY: (key.y * CHUNK_SIZE - CHUNK_PADDING) * step,
    terrain, biomes: new Uint8Array(terrain.length), elevation: new Float32Array(terrain.length),
    moisture: new Float32Array(terrain.length), coastDistance: coastDistances(terrain, width, height),
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (terrain[i] === Terrain.Ocean) continue;
    const point = projection.invert?.([region.originX + (x + 0.5) * step, region.originY + (y + 0.5) * step]);
    if (!point) continue;
    const climate = climateAt(point[0], point[1], seed);
    region.biomes[i] = climate.biome; region.elevation[i] = climate.elevation; region.moisture[i] = climate.moisture;
  }
  return region;
}
export function extractCells(region: Region): ChunkCells {
  const length = CHUNK_SIZE * CHUNK_SIZE;
  const cells: ChunkCells = { terrain: new Uint8Array(length), biomes: new Uint8Array(length), elevation: new Uint8Array(length), moisture: new Uint8Array(length) };
  for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const source = (y + CHUNK_PADDING) * region.width + x + CHUNK_PADDING, target = y * CHUNK_SIZE + x;
    cells.terrain[target] = region.terrain[source]; cells.biomes[target] = region.biomes[source];
    cells.elevation[target] = Math.round(region.elevation[source] * 255); cells.moisture[target] = Math.round(region.moisture[source] * 255);
  }
  return cells;
}
