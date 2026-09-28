import type { Territory } from "./types.ts";
import { tree } from "./sprites.ts";
import { BUILDINGS, type BuildingKind } from "../../shared/game.ts";
const cache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
/** At most 8 × 1024² RGBA images = 32 MiB (64 MiB reserved for global tiles); refresh only on geometry/building changes. */
export function terrainCanvas(t: Territory) {
  const key =
    t.grid + "|" + t.buildings?.map((b) => `${b.type}:${b.x}:${b.y}`).join(";");
  const hit = cache.get(t.id);
  if (hit?.key === key) {
    cache.delete(t.id);
    cache.set(t.id, hit);
    return hit.canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  const hash = (x: number, y: number, salt = 0) => {
    let v =
      Math.imul(x + 8191, 374761393) ^ Math.imul(y + 4093, 668265263) ^ salt;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const cell = (x: number, y: number) =>
    x < 0 || y < 0 || x >= 64 || y >= 64 ? "0" : t.grid![y * 64 + x];
  const occupied = (x: number, y: number) =>
    t.buildings?.some((b) => {
      const size = BUILDINGS[b.type as BuildingKind].size;
      return (
        x >= b.x - 0.5 &&
        x < b.x + size + 0.5 &&
        y >= b.y - 0.5 &&
        y < b.y + size + 0.5
      );
    });
  // Geography and soil are supplied by the global terrain tiles. This layer
  // contains only the local simulation vegetation/objects, with transparent ground.
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const v = cell(x, y),
        px = x * 16,
        py = y * 16;
      if (v === "0") continue;
      if (occupied(x, y)) continue;
      if (
        (v === "f" && hash(x, y, 51) > 0.22) ||
        (v === "g" && hash(x, y, 73) > 0.975)
      ) {
        const variant =
          Math.abs((t.minLat + t.maxLat) / 2) > 45
            ? 2
            : hash(x, y, 17) > 0.5
              ? 1
              : 0;
        tree(
          c,
          px + 4 + Math.floor(hash(x, y, 22) * 8),
          py + 9 + Math.floor(hash(x, y, 31) * 6),
          1.05 + hash(x, y, 85) * 0.45,
          variant,
        );
      }
      if (v === "m" && hash(x, y, 45) > 0.3) {
        c.fillStyle = "#5c6d5f";
        c.fillRect(px + 1, py + 10, 14, 5);
        c.fillStyle = "#7e8b7b";
        c.fillRect(px + 3, py + 5, 10, 8);
        c.fillStyle = "#c8ceb1";
        c.fillRect(px + 5, py + 2, 5, 6);
        c.fillStyle = "#e3e2c8";
        c.fillRect(px + 6, py + 2, 3, 2);
      }
    }
  cache.delete(t.id);
  cache.set(t.id, { key, canvas });
  while (cache.size > 8) {
    const id = cache.keys().next().value!;
    const old = cache.get(id)!;
    old.canvas.width = old.canvas.height = 0;
    cache.delete(id);
  }
  return canvas;
}
export function animal(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  index: number,
  time: number,
) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(scale, scale);
  c.fillStyle = "#50664b33";
  c.fillRect(-3, 1, 8, 2);
  c.fillStyle = index === 1 ? "#d5a6a0" : "#ece4c9";
  c.fillRect(-3, -3, 7, 4);
  c.fillRect(3, -5, 3, 4);
  c.fillStyle = "#766450";
  c.fillRect(-2, 1, 1, 2);
  c.fillRect(2, 1, 1, 2);
  if (index === 0) c.fillRect(-1, -3, 3, 2);
  c.fillStyle = "#4c5140";
  c.fillRect(5, -4, 1, 1);
  if (time && Math.floor(time / 900) % 2) c.fillRect(-4, -3, 1, 2);
  c.restore();
}
export const terrainCacheBytes = () => cache.size * 1024 * 1024 * 4;
