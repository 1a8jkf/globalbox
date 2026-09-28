import type { ChunkKey } from './config.ts';
export { WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED } from './config.ts';
export const Biome = {
  Ocean: 0, Tropical: 1, Temperate: 2, Taiga: 3, Savanna: 4,
  Desert: 5, Grassland: 6, Tundra: 7, Mountain: 8, Polar: 9,
} as const;
export type BiomeId = typeof Biome[keyof typeof Biome];
export const Terrain = { Ocean: 0, Land: 1, Lake: 2, River: 3 } as const;
export interface Cell {
  terrain: number;
  biome: BiomeId;
  elevation: number;
  moisture: number;
  longitude: number;
  latitude: number;
}
export interface World {
  width: number;
  height: number;
  seed: number;
  /** Missing cells are unknown, never implicitly water. Exact means finest resolution. */
  getCell(x: number, y: number, exact?: boolean): Cell | undefined;
}
export interface Region {
  width: number;
  height: number;
  originX: number;
  originY: number;
  step: number;
  seed: number;
  terrain: Uint8Array;
  biomes: Uint8Array;
  elevation: Float32Array;
  moisture: Float32Array;
  coastDistance: Uint16Array;
}
export interface ChunkCells {
  terrain: Uint8Array;
  biomes: Uint8Array;
  elevation: Uint8Array;
  moisture: Uint8Array;
}
export type GeographicEntry = { uniform: number } | { file: string; bytes: number; sha256: string };
export interface GeographyManifest {
  version: number;
  width: number;
  height: number;
  chunkSize: number;
  padding: number;
  levels: number;
  projection: string;
  chunks: Record<string, GeographicEntry>;
}
export interface WorldChunk extends ChunkCells {
  key: ChunkKey;
  bitmap: ImageBitmap;
  bytes: number;
  generationMs: number;
}
export interface GenerateRequest { id: number; key: ChunkKey; entry: GeographicEntry; baseUrl: string; seed: number }
export type GenerateReply =
  | ({ type: 'ready'; id: number; key: ChunkKey; bitmap: ImageBitmap; generationMs: number } & ChunkCells)
  | { type: 'error'; id: number; key: ChunkKey; message: string };
export interface Plant { x: number; y: number; biome: BiomeId; variant: number }
export type Species = 'chicken' | 'pig' | 'cow' | 'deer' | 'elephant' | 'camel' | 'penguin';
export interface Animal {
  id: number;
  species: Species;
  x: number; y: number;
  originX: number; originY: number;
  targetX: number; targetY: number;
  heading: number;
  waiting: number;
  steps: number;
}
