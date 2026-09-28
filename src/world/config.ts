import { geoEqualEarth, type GeoProjection } from 'd3-geo';

export const WORLD_WIDTH = 16384;
export const WORLD_HEIGHT = 8192;
export const WORLD_SEED = 271828;
export const CHUNK_SIZE = 256;
export const CHUNK_PADDING = 32;
export const LEVELS = 5;
export const CACHE_BYTES = 96 * 1024 * 1024;
export const MAX_ZOOM = 128;
export const stepAt = (level: number): number => 2 ** (LEVELS - 1 - level);
export interface ChunkKey { level: number; x: number; y: number }
export function keyOf(key: ChunkKey): string { return `${key.level}/${key.x}/${key.y}`; }
export function chunkBounds(key: ChunkKey) {
  const size = CHUNK_SIZE * stepAt(key.level);
  return { x: key.x * size, y: key.y * size, size };
}
export function parentOf(key: ChunkKey): ChunkKey | undefined {
  return key.level > 0 ? { level: key.level - 1, x: Math.floor(key.x / 2), y: Math.floor(key.y / 2) } : undefined;
}
export function createProjection(width = WORLD_WIDTH, height = WORLD_HEIGHT): GeoProjection {
  return geoEqualEarth().fitExtent([[width * 12 / 1024, height * 12 / 512], [width * 1012 / 1024, height * 500 / 512]], { type: 'Sphere' });
}
