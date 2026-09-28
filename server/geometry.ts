import {
  area,
  bbox,
  polygon,
  cleanCoords,
  simplify,
  kinks,
  booleanPointInPolygon,
  intersect,
  featureCollection,
  bboxClip,
  difference,
  lineIntersect,
} from "@turf/turf";
import type {
  Polygon,
  MultiPolygon,
  Feature,
  FeatureCollection,
} from "geojson";
import { readFileSync } from "node:fs";
import { climateAt } from "../src/world/climate.ts";
import { hash, noise } from "../src/world/noise.ts";
import { GRID } from "../shared/game.ts";
import { GameError, requireValue } from "./db.ts";
const vectors = (name: string) =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../data/geography/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as FeatureCollection<Polygon | MultiPolygon>
  ).features
    .flatMap((f) =>
      f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates.map((c) => polygon(c))
        : [f as Feature<Polygon>],
    )
    .map((feature) => ({ feature, bounds: bbox(feature) }));
const coast = vectors("land"),
  lakes = vectors("lakes");
function candidates(source: typeof coast, b: number[]) {
  return source.filter(
    ({ bounds: a }) =>
      a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1],
  );
}
/** Clip once per territory. Individual local cells never scan the global coastline. */
export function landParts(
  feature: Feature<Polygon>,
): Feature<Polygon | MultiPolygon>[] {
  const bounds = bbox(feature) as [number, number, number, number];
  const water = candidates(lakes, bounds);
  const result: Feature<Polygon | MultiPolygon>[] = [];
  for (const item of candidates(coast, bounds)) {
    const clipped = bboxClip(item.feature, bounds) as Feature<
      Polygon | MultiPolygon
    >;
    if (!clipped.geometry.coordinates.length) continue;
    let land = intersect(featureCollection([feature, clipped]));
    for (const lake of water) {
      if (!land) break;
      land = difference(
        featureCollection([
          land,
          bboxClip(lake.feature, bounds) as Feature<Polygon | MultiPolygon>,
        ]),
      );
    }
    if (land && area(land) > 0) result.push(land);
  }
  return result;
}
export function terrainAt(lon: number, lat: number): number {
  const bounds = [lon, lat, lon, lat];
  return candidates(coast, bounds).some((f) =>
    booleanPointInPolygon([lon, lat], f.feature),
  ) &&
    !candidates(lakes, bounds).some((f) =>
      booleanPointInPolygon([lon, lat], f.feature),
    )
    ? 1
    : 0;
}
function normalizeRaw(input: unknown): {
  feature: Feature<Polygon>;
  areaKm2: number;
  bounds: [number, number, number, number];
} {
  const value = input as Polygon;
  requireValue(
    value?.type === "Polygon" &&
      Array.isArray(value.coordinates) &&
      value.coordinates.length === 1,
    "Desenhe uma única fronteira, sem buracos.",
  );
  const ring = value.coordinates[0];
  requireValue(
    Array.isArray(ring) && ring.length >= 4 && ring.length <= 2048,
    "A fronteira precisa de 3 a 2.047 pontos.",
  );
  requireValue(
    ring.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        p[0] >= -180 &&
        p[0] <= 180 &&
        p[1] >= -80 &&
        p[1] <= 80,
    ),
    "Coordenadas fora da área permitida.",
  );
  requireValue(
    ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1],
    "Feche a fronteira antes de continuar.",
  );
  let feature = cleanCoords(
    polygon([ring.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)])]),
  );
  const bounds = bbox(feature) as [number, number, number, number];
  requireValue(
    bounds[2] - bounds[0] < 180,
    "Desenhe em um único lado da linha internacional de data.",
  );
  requireValue(
    kinks(feature).features.length === 0,
    "A fronteira não pode cruzar a si mesma.",
  );
  let tolerance =
    Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.001;
  while (feature.geometry.coordinates[0].length > 256 && tolerance < 10) {
    feature = simplify(feature, { tolerance, highQuality: true });
    tolerance *= 1.6;
  }
  requireValue(
    feature.geometry.coordinates[0].length <= 256 &&
      feature.geometry.coordinates[0].length >= 4 &&
      kinks(feature).features.length === 0,
    "Fronteira complexa demais. Desenhe novamente.",
  );
  const areaKm2 = area(feature) / 1e6;
  requireValue(
    Number.isFinite(areaKm2) && areaKm2 > 0,
    "A fronteira precisa ter uma área maior que zero.",
  );
  return {
    feature,
    areaKm2,
    bounds: bbox(feature) as [number, number, number, number],
  };
}
export function normalizePolygon(
  input: unknown,
): ReturnType<typeof normalizeRaw> {
  try {
    return normalizeRaw(input);
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError("Geometria inválida. Desenhe novamente.");
  }
}
export function overlaps(a: Polygon, b: Polygon): boolean {
  const result = intersect(
    featureCollection([polygon(a.coordinates), polygon(b.coordinates)]),
  );
  return !!result && area(result) > 0.01;
}
export function makeGrid(
  feature: Feature<Polygon>,
  bounds: [number, number, number, number],
): string {
  const parts = landParts(feature);
  requireValue(
    parts.reduce((sum, p) => sum + area(p), 0) / area(feature) >= 0.8,
    "Escolha uma região com pelo menos 80% de terra firme.",
  );
  let grid = "",
    inside = 0,
    land = 0;
  const seed = Math.floor((bounds[0] + 180) * 10000 + (bounds[1] + 90) * 137);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const lon = bounds[0] + ((x + 0.5) / GRID) * (bounds[2] - bounds[0]),
        lat = bounds[3] - ((y + 0.5) / GRID) * (bounds[3] - bounds[1]);
      const dx = ((bounds[2] - bounds[0]) / GRID) * 0.499,
        dy = ((bounds[3] - bounds[1]) / GRID) * 0.499;
      const cell = polygon([
        [
          [lon - dx, lat - dy],
          [lon + dx, lat - dy],
          [lon + dx, lat + dy],
          [lon - dx, lat + dy],
          [lon - dx, lat - dy],
        ],
      ]);
      if (
        !booleanPointInPolygon([lon, lat], feature) ||
        lineIntersect(cell, feature).features.length > 0
      ) {
        grid += "0";
        continue;
      }
      inside++;
      if (
        !parts.some(
          (p) =>
            cell.geometry.coordinates[0].every((c) =>
              booleanPointInPolygon(c, p),
            ) && lineIntersect(cell, p).features.length === 0,
        )
      ) {
        grid += "w";
        continue;
      }
      land++;
      const climate = climateAt(lon, lat),
        n = noise(x / 7, y / 7, seed);
      grid +=
        climate.biome === 9
          ? "s"
          : climate.biome === 8 && n > 0.58
            ? "m"
            : climate.biome === 5
              ? "s"
              : n > 0.56 && hash(x, y, seed) > 0.1
                ? "f"
                : "g";
    }
  requireValue(
    inside > 12 && land >= 6,
    "Escolha uma região com pelo menos 80% de terra firme.",
  );
  return grid;
}
export function insideFootprint(
  geometry: Polygon,
  bounds: number[],
  x: number,
  y: number,
  size: number,
): boolean {
  for (const [dx, dy] of [
    [0.03, 0.03],
    [size - 0.03, 0.03],
    [0.03, size - 0.03],
    [size - 0.03, size - 0.03],
  ]) {
    const lon = bounds[0] + ((x + dx) / GRID) * (bounds[2] - bounds[0]),
      lat = bounds[3] - ((y + dy) / GRID) * (bounds[3] - bounds[1]);
    if (!booleanPointInPolygon([lon, lat], geometry)) return false;
  }
  return true;
}
export function parsePolygon(value: unknown): Polygon {
  try {
    return normalizePolygon(value).feature.geometry;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError("Geometria inválida.");
  }
}
