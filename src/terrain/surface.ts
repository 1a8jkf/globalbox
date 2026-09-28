import { Biome, Terrain, type Region } from "../world/types.ts";
import { noise, hash } from "../world/noise.ts";
import { CLUSTERS, GROUND_PALETTES, type ClusterKind } from "./clusters.ts";
const rgb = (s: string) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];
const palette = GROUND_PALETTES.map((p) => p.map(rgb));
const water = [
  "#10365d",
  "#144772",
  "#195982",
  "#216c95",
  "#2b83a8",
  "#3c9cb8",
  "#61bcc6",
  "#92d5cf",
  "#d8eee0",
].map(rgb);
/** Bounded chamfer distances. The 32-cell geographic gutter exceeds every visual shore radius. */
export function shoreDistance(
  mask: Uint8Array,
  width: number,
  landSource: boolean,
) {
  const d = new Uint16Array(mask.length);
  for (let i = 0; i < d.length; i++)
    d[i] = (mask[i] === Terrain.Land) === landSource ? 0 : 96;
  for (let i = 0; i < d.length; i++) {
    const x = i % width,
      y = Math.floor(i / width);
    if (x) d[i] = Math.min(d[i], d[i - 1] + 3);
    if (y) d[i] = Math.min(d[i], d[i - width] + 3);
    if (x && y) d[i] = Math.min(d[i], d[i - width - 1] + 4);
    if (x < width - 1 && y) d[i] = Math.min(d[i], d[i - width + 1] + 4);
  }
  for (let i = d.length - 1; i >= 0; i--) {
    const x = i % width;
    if (x < width - 1) d[i] = Math.min(d[i], d[i + 1] + 3);
    if (i + width < d.length) d[i] = Math.min(d[i], d[i + width] + 3);
    if (x < width - 1 && i + width < d.length)
      d[i] = Math.min(d[i], d[i + width + 1] + 4);
    if (x && i + width < d.length) d[i] = Math.min(d[i], d[i + width - 1] + 4);
  }
  return d;
}
export interface SurfaceOptions {
  size?: number;
  padding?: number;
  detail?: number;
  vegetation?: boolean;
}
/** 2× visual raster independent of the simulation grid. Never writes geographic arrays. */
export function renderSurface(
  region: Region,
  {
    size = 256,
    padding = 32,
    detail = 0,
    vegetation = false,
  }: SurfaceOptions = {},
) {
  const n = size * 2,
    pixels = new Uint8ClampedArray(n * n * 4),
    w = region.width;
  const dry = shoreDistance(region.terrain, w, true),
    wet = shoreDistance(region.terrain, w, false),
    oceanDistance = shoreDistance(
      region.terrain.map((t) =>
        t === Terrain.Ocean ? Terrain.Ocean : Terrain.Land,
      ),
      w,
      false,
    );
  const ox = Math.round((region.originX / region.step) * 2) + padding * 2,
    oy = Math.round((region.originY / region.step) * 2) + padding * 2;
  const index = (x: number, y: number) =>
    (Math.floor(y / 2) + padding) * w + Math.floor(x / 2) + padding;
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n;
  const put = (x: number, y: number, color: readonly number[]) => {
    const p = (y * n + x) * 4;
    pixels[p] = color[0];
    pixels[p + 1] = color[1];
    pixels[p + 2] = color[2];
    pixels[p + 3] = 255;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y + padding) * w + x + padding,
        t = region.terrain[i],
        b = region.biomes[i];
      const gx = ox + x * 2,
        gy = oy + y * 2;
      // Noise chooses a few solid color terraces. It is never displayed as per-pixel grain.
      const patch =
        noise(gx / 52, gy / 52, region.seed + 81) * 0.65 +
        noise(gx / 17, gy / 23, region.seed + 82) * 0.35;
      let color: readonly number[];
      if (t !== Terrain.Land) {
        const depth = dry[i] / 3;
        const band =
          depth < 1.4
            ? 7
            : depth < 3
              ? 6
              : depth < 6
                ? 5
                : depth < 10
                  ? 4
                  : depth < 17
                    ? 3
                    : Math.floor(patch * 3);
        color =
          water[
            t === Terrain.River
              ? Math.min(5, Math.max(3, band - 3))
              : t === Terrain.Lake
                ? Math.min(6, Math.max(2, band - 1))
                : band
          ];
      } else {
        let shade = Math.max(0, Math.min(4, Math.floor(patch * 5)));
        if (
          b === Biome.Mountain ||
          (b !== Biome.Polar && b !== Biome.Tundra && region.elevation[i] > 0.5)
        ) {
          const ridge = noise(gx / 32, gy / 39, region.seed + 19),
            left = noise((gx - 3) / 32, (gy - 2) / 39, region.seed + 19);
          shade = ridge - left > 0.015 ? 3 : ridge - left < -0.015 ? 0 : shade;
          color = palette[Biome.Mountain][shade];
          if (region.elevation[i] > 0.78 && ridge > 0.52)
            color = palette[Biome.Polar][3 + Number(ridge > 0.67)];
        } else color = palette[b][shade];
        if (
          oceanDistance[i] <= 3 &&
          b !== Biome.Polar &&
          b !== Biome.Tundra &&
          b !== Biome.Mountain
        )
          color = rgb("#dbc987");
        else if (
          wet[i] <= 9 &&
          b !== Biome.Desert &&
          b !== Biome.Polar &&
          b !== Biome.Mountain
        )
          color = palette[b][Math.max(0, shade - 1)];
      }
      put(x * 2, y * 2, color);
      put(x * 2 + 1, y * 2, color);
      put(x * 2, y * 2 + 1, color);
      put(x * 2 + 1, y * 2 + 1, color);
    }
  const stamp = (
    kind: ClusterKind,
    x: number,
    y: number,
    colors: readonly (readonly number[])[],
    type: number,
  ) => {
    CLUSTERS[kind].forEach((row, sy) => {
      for (let sx = 0; sx < row.length; sx++) {
        const k = row[sx],
          px = x + sx,
          py = y + sy;
        if (
          k === " " ||
          !valid(px, py) ||
          region.terrain[index(px, py)] !== type
        )
          continue;
        put(px, py, colors[k === "l" ? 0 : k === "m" ? 1 : 2]);
      }
    });
  };
  // Anchors extend over tile borders; shared global coordinates reproduce identical fragments.
  const pitch = detail >= 2 ? 13 : 18;
  for (let gy = Math.floor((oy - 24) / pitch) * pitch; gy < oy + n; gy += pitch)
    for (
      let gx = Math.floor((ox - 24) / pitch) * pitch;
      gx < ox + n;
      gx += pitch
    ) {
      const r = hash(gx, gy, region.seed + 431),
        x = gx - ox + Math.floor(hash(gx, gy, region.seed + 432) * 7),
        y = gy - oy + Math.floor(hash(gx, gy, region.seed + 433) * 7);
      const i = index(x, y);
      if (i < 0 || i >= region.terrain.length) continue;
      const t = region.terrain[i],
        b = region.biomes[i],
        p = palette[b];
      const density = noise((gx + 8) / 83, (gy + 8) / 83, region.seed + 99);
      if (t !== Terrain.Land) {
        if (r > 0.16 + density * 0.16) continue;
        const near = t === Terrain.Ocean && dry[i] <= 6;
        stamp(
          near
            ? "ShallowWaterCluster"
            : r < 0.12
              ? "WaterCluster"
              : "WaveCluster",
          x,
          y,
          near
            ? [water[8], water[6], water[5]]
            : [water[3], water[2], water[1]],
          t,
        );
        continue;
      }
      if (r > 0.28 + density * 0.6) continue;
      let kind: ClusterKind = "GrassCluster",
        colors: readonly (readonly number[])[] = [p[4], p[2], p[0]];
      if (oceanDistance[i] <= 3 && b !== Biome.Polar && b !== Biome.Mountain) {
        kind = "BeachCluster";
        colors = [rgb("#f3dfa2"), rgb("#d2bc78"), rgb("#a89461")];
      } else if (b === Biome.Mountain) {
        kind = r < 0.48 ? "MountainCluster" : "RockCluster";
        colors =
          region.elevation[i] > 0.78
            ? [palette[9][4], palette[8][3], palette[8][0]]
            : [p[3], p[2], p[0]];
      } else if (b === Biome.Desert) {
        kind =
          r < 0.45
            ? "SandCluster"
            : r < 0.65
              ? "RockCluster"
              : "DryGrassCluster";
        colors = [p[4], p[2], p[0]];
      } else if (b === Biome.Polar) {
        kind = r < 0.38 ? "SnowCluster" : "IceCrackCluster";
        colors = [p[4], p[1], p[0]];
      } else if (b === Biome.Tundra) {
        kind =
          r < 0.3 ? "RockCluster" : r < 0.5 ? "SnowCluster" : "DryGrassCluster";
      } else if (b === Biome.Savanna) {
        kind = r < 0.45 ? "DryGrassCluster" : "DirtCluster";
      } else if (b === Biome.Taiga) {
        kind =
          r < 0.22 ? "RockCluster" : r < 0.35 ? "SnowCluster" : "LeafCluster";
      } else if (b === Biome.Tropical) {
        kind =
          r < 0.4 ? "LeafCluster" : r < 0.58 ? "RootCluster" : "DirtCluster";
      } else if (r < 0.22) kind = "DirtCluster";
      else if (r < 0.3) kind = "RockCluster";
      if (kind === "DirtCluster" || kind === "RootCluster")
        colors = [rgb("#84964a"), rgb("#667339"), rgb("#4b5732")];
      if (kind === "RockCluster")
        colors = [rgb("#b2ba97"), rgb("#828d79"), rgb("#566b5c")];
      stamp(kind, x, y, colors, t);
      if (vegetation && detail >= 2 && r < 0.17 && [1, 2, 3].includes(b))
        stamp("CanopyCluster", x + 5, y - 6, [p[3], p[1], p[0]], t);
    }
  return pixels;
}
