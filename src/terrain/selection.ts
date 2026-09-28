import { mercatorPoint, tileId, type TileKey } from "./geography.ts";
export interface GeographicView {
  west: number;
  east: number;
  north: number;
  south: number;
  zoom: number;
}
/** Overview + two parent resolutions. Bound the complete working set, not only
 * leaf tiles, so deep exploration cannot churn the cache on missing ancestors. */
export function terrainRequests(view: GeographicView): {
  level: number;
  keys: TileKey[];
  visible: TileKey[];
} {
  let z = Math.max(0, Math.min(20, Math.ceil(view.zoom) + 1));
  while (true) {
    const n = 2 ** z,
      a = mercatorPoint(Math.max(-180, view.west), view.north),
      b = mercatorPoint(Math.min(180, view.east), view.south);
    const minX = Math.max(0, Math.floor(a[0] * n)),
      maxX = Math.min(n - 1, Math.floor(b[0] * n)),
      minY = Math.max(0, Math.floor(a[1] * n)),
      maxY = Math.min(n - 1, Math.floor(b[1] * n));
    if ((maxX - minX + 1) * (maxY - minY + 1) > 40 && z > 0) {
      z--;
      continue;
    }
    const visible: TileKey[] = [];
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) visible.push({ z, x, y });
    visible.sort(
      (a, b) =>
        Math.hypot(a.x - (minX + maxX) / 2, a.y - (minY + maxY) / 2) -
        Math.hypot(b.x - (minX + maxX) / 2, b.y - (minY + maxY) / 2),
    );
    const keys = new Map<string, TileKey>([["0/0/0", { z: 0, x: 0, y: 0 }]]);
    const append = (key: TileKey) => {
      if (key.z > Math.max(0, z - 2))
        append({
          z: key.z - 1,
          x: Math.floor(key.x / 2),
          y: Math.floor(key.y / 2),
        });
      keys.set(tileId(key), key);
    };
    for (const key of visible) append(key);
    if (keys.size <= 60 || !z)
      return { level: z, keys: [...keys.values()], visible };
    z--;
  }
}
