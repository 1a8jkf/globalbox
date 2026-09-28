import { Biome, type BiomeId } from './types.ts';
import { fbm, noise } from './noise.ts';

type Point = readonly [number, number];
// Geographic spines, not screen-space decorations. Longitude, latitude.
const ranges: readonly (readonly Point[])[] = [
  [[-149, 62], [-132, 57], [-121, 48], [-112, 40], [-105, 29], [-100, 20]],
  [[-74, 10], [-77, -3], [-72, -15], [-68, -27], [-71, -43], [-70, -54]],
  [[5, 45], [10, 47], [15, 46]],
  [[68, 35], [76, 35], [85, 29], [94, 29], [101, 25]],
  [[40, 42], [48, 43]], [[57, 53], [61, 62], [64, 68]],
  [[-8, 30], [0, 34], [9, 35]], [[37, 7], [39, 14]],
  [[145, -17], [148, -27], [148, -37]], [[167, -45], [173, -41]],
  [[98, 47], [110, 52], [121, 54]],
];
function segmentDistance(lon: number, lat: number, a: Point, b: Point) {
  const scale = Math.max(0.3, Math.cos(lat * Math.PI / 180));
  const vx = (b[0] - a[0]) * scale, vy = b[1] - a[1];
  const px = (lon - a[0]) * scale, py = lat - a[1];
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - vx * t, py - vy * t);
}
function region(lon: number, lat: number, cx: number, cy: number, rx: number, ry: number) {
  return Math.exp(-(((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2) * 1.4);
}
export function climateAt(lon: number, lat: number, seed = 271828): { biome: BiomeId; elevation: number; moisture: number } {
  const variation = (fbm(lon * 0.19 + 61, lat * 0.19 + 83, seed) - 0.5);
  // Atlantic influence keeps western Europe temperate despite its latitude.
  const oceanicWarmth = lat > 0 ? region(lon, lat, -4, 54, 25, 17) * 10 : 0;
  const latitude = Math.abs(lat) + variation * 7 - oceanicWarmth;
  const greenland = region(lon, lat, -41, 75, 18, 14);
  if (lat < -61 || (greenland > 0.32 && lat > 60) || lat > 77) {
    return { biome: Biome.Polar, elevation: 0.4 + variation * 0.2, moisture: 0.15 };
  }
  let distance = 100;
  for (const line of ranges) for (let i = 1; i < line.length; i++) distance = Math.min(distance, segmentDistance(lon, lat, line[i - 1], line[i]));
  const ridge = Math.exp(-distance * distance / 3.8);
  const elevation = Math.min(1, 0.08 + ridge * (0.65 + noise(lon * 1.5, lat * 1.5, seed) * 0.25) + variation * 0.12);
  const aridity = Math.max(
    region(lon, lat, 15, 25, 35, 10), // Sahara
    region(lon, lat, 46, 24, 17, 13), // Arabian peninsula
    region(lon, lat, 63, 32, 14, 8),
    region(lon, lat, 99, 42, 21, 9), // Gobi and central Asia
    region(lon, lat, 133, -25, 20, 12),
    region(lon, lat, 19, -24, 10, 10),
    region(lon, lat, -113, 31, 10, 9),
    region(lon, lat, -70, -23, 3, 11),
  );
  const rainforest = Math.max(
    region(lon, lat, -63, -5, 21, 13), region(lon, lat, 23, 0, 17, 11),
    region(lon, lat, 112, 2, 34, 17), region(lon, lat, -84, 11, 10, 9),
    region(lon, lat, 143, -6, 13, 9), region(lon, lat, 49, -18, 5, 14),
  );
  const moisture = Math.max(0, Math.min(1, 0.57 + rainforest * 0.4 - aridity * 0.78 + variation * 0.32));
  let biome: BiomeId;
  if (elevation > 0.54) biome = Biome.Mountain;
  else if (latitude > 65 || region(lon, lat, -19, 65, 8, 6) > 0.4) biome = Biome.Tundra;
  else if (latitude > 51) biome = Biome.Taiga;
  else if (aridity + variation * 0.25 > 0.48) biome = Biome.Desert;
  else if (latitude < 24 && rainforest + variation * 0.3 > 0.38) biome = Biome.Tropical;
  else if (latitude < 25) biome = Biome.Savanna;
  else if (moisture < 0.44 || (lon > -112 && lon < -91 && lat > 30 && lat < 51) || (lon > 38 && lon < 110 && lat > 42 && lat < 52)) biome = Biome.Grassland;
  else biome = Biome.Temperate;
  return { biome, elevation, moisture };
}
