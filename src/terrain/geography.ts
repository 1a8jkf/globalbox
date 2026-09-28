import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { climateAt } from "../world/climate.ts";
import { WORLD_SEED } from "../world/config.ts";
import { Terrain, type Region } from "../world/types.ts";
export interface VectorShape {
  path: Path2D;
  bounds: [[number, number], [number, number]];
  rank: number;
}
export interface TerrainVectors {
  land: VectorShape[];
  lakes: VectorShape[];
  rivers: VectorShape[];
}
export interface TileKey {
  z: number;
  x: number;
  y: number;
}
export const tileId = (t: TileKey) => `${t.z}/${t.x}/${t.y}`;
export const mercatorPoint = (lon: number, lat: number): [number, number] => [
  (lon + 180) / 360,
  (1 -
    Math.asinh(
      Math.tan(
        (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180,
      ),
    ) /
      Math.PI) /
    2,
];
export const mercatorInverse = (x: number, y: number): [number, number] => [
  x * 360 - 180,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
];
/** Keep original rings and holes. Only projection/rasterization changes between LODs. */
export function prepareVectors(collection: FeatureCollection): VectorShape[] {
  const projection = geoMercator()
    .scale(1 / (2 * Math.PI))
    .translate([0.5, 0.5])
    .clipExtent([
      [0, 0],
      [1, 1],
    ])
    .precision(0.000001);
  const path = geoPath(projection).digits(12),
    result: VectorShape[] = [];
  for (const f of collection.features) {
    const geometries: Geometry[] =
      f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates.map((coordinates) => ({
            type: "Polygon",
            coordinates,
          }))
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates.map((coordinates) => ({
              type: "LineString",
              coordinates,
            }))
          : [f.geometry];
    for (const g of geometries) {
      const s = path(g);
      if (s) {
        const bounds = path.bounds(g);
        const span = Math.max(
          bounds[1][0] - bounds[0][0],
          bounds[1][1] - bounds[0][1],
        );
        result.push({
          path: new Path2D(s),
          bounds,
          rank: Number(
            f.properties?.scalerank ??
              Math.max(0, Math.floor(-Math.log2(Math.max(span, 1e-8)))),
          ),
        });
      }
    }
  }
  return result;
}
export function rasterRegion(key: TileKey, vectors: TerrainVectors): Region {
  const width = 320,
    pad = 32,
    size = 256,
    scale = size * 2 ** key.z,
    ox = key.x * size - pad,
    oy = key.y * size - pad;
  const canvas = new OffscreenCanvas(width, width),
    c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.imageSmoothingEnabled = false;
  c.setTransform(scale, 0, 0, scale, -ox, -oy);
  const bounds = [
    ox / scale,
    oy / scale,
    (ox + width) / scale,
    (oy + width) / scale,
  ];
  const visible = (s: VectorShape) =>
    s.bounds[0][0] <= bounds[2] &&
    s.bounds[1][0] >= bounds[0] &&
    s.bounds[0][1] <= bounds[3] &&
    s.bounds[1][1] >= bounds[1];
  c.fillStyle = "#ff0000";
  for (const s of vectors.land) if (visible(s)) c.fill(s.path);
  c.fillStyle = "#00ff00";
  for (const s of vectors.lakes) if (visible(s)) c.fill(s.path);
  // Stroke is used only to create a binary geographic river mask. Visible pixels
  // are painted by the terrain renderer, including banks and shallow channels.
  const land = c.getImageData(0, 0, width, width).data;
  c.strokeStyle = "#0000ff";
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const s of vectors.rivers)
    if (s.rank <= key.z + 2 && visible(s)) {
      c.lineWidth = (0.55 + Math.max(0, 8 - s.rank) * 0.07) / scale;
      c.stroke(s.path);
    }
  const raw = c.getImageData(0, 0, width, width).data,
    len = width * width;
  const r: Region = {
    width,
    height: width,
    originX: ox,
    originY: oy,
    step: 1,
    seed: WORLD_SEED,
    terrain: new Uint8Array(len),
    biomes: new Uint8Array(len),
    elevation: new Float32Array(len),
    moisture: new Float32Array(len),
    coastDistance: new Uint16Array(len),
  };
  for (let i = 0; i < len; i++) {
    const k = i * 4;
    r.terrain[i] =
      land[k + 3] < 128
        ? Terrain.Ocean
        : land[k + 1] > land[k]
          ? Terrain.Lake
          : raw[k + 2] > 96
            ? Terrain.River
            : Terrain.Land;
  }
  // Climate sampling is independent of visual clusters; no artistic operation
  // changes the mask. Global even anchors keep adjoining tiles identical.
  for (let y = 0; y < width; y += 2)
    for (let x = 0; x < width; x += 2) {
      const [lon, lat] = mercatorInverse(
        (ox + x + 1) / scale,
        (oy + y + 1) / scale,
      );
      const climate = climateAt(lon, lat, WORLD_SEED);
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = (y + dy) * width + x + dx;
          r.biomes[i] = climate.biome;
          r.elevation[i] = climate.elevation;
          r.moisture[i] = climate.moisture;
        }
    }
  return r;
}
