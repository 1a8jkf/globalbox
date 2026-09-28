import { Biome, Terrain, type Plant, type BiomeId, type Region } from './types.ts';
import { fbm, hash } from './noise.ts';
export const densities = [0, 0.67, 0.4, 0.58, 0.06, 0.004, 0.018, 0.013, 0, 0];
export function forestCover(x: number, y: number, biome: number, seed: number): number {
  const grouping = fbm(x / 170, y / 170, seed + 5) * 0.65 + fbm(x / 23, y / 23, seed + 17) * 0.35;
  return densities[biome] * Math.max(0.08, (grouping - 0.2) * 1.8);
}
export function generatePlants(region: Region): Plant[] {
  const plants: Plant[] = [];
  if (region.step > 2) return plants;
  const at = (x: number, y: number) => {
    const cx = Math.floor((x - region.originX) / region.step), cy = Math.floor((y - region.originY) / region.step);
    if (cx < 0 || cy < 0 || cx >= region.width || cy >= region.height) return -1;
    return cy * region.width + cx;
  };
  for (let y = Math.ceil((region.originY + 2) / 3) * 3; y < region.originY + region.height * region.step - 2; y += 3) {
    for (let x = Math.ceil((region.originX + 2) / 3) * 3; x < region.originX + region.width * region.step - 2; x += 3) {
      const px = x + Math.floor(hash(x, y, region.seed + 3) * 3), py = y + Math.floor(hash(x, y, region.seed + 4) * 3);
      const i = at(px, py), biome = region.biomes[i] as BiomeId;
      if (i < 0 || region.terrain[i] !== Terrain.Land || biome === Biome.Polar || hash(x, y, region.seed + 6) >= forestCover(px, py, biome, region.seed)) continue;
      if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => region.terrain[at(px+dx,py+dy)] !== Terrain.Land)) continue;
      plants.push({ x: px, y: py, biome, variant: Math.floor(hash(px, py, region.seed + 7) * 4) });
    }
  }
  return plants.sort((a,b) => a.y-b.y || a.x-b.x);
}
