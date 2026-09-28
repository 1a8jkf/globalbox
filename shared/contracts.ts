export interface ViewBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}
export const WORLD_BOUNDS: ViewBounds = {
  west: -180,
  east: 180,
  south: -80,
  north: 80,
};
export interface RegionBox {
  id: string;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}
export interface WorldUpdate {
  type: "world:update";
  revision: number;
  territoryIds: string[];
  regions?: RegionBox[];
  global?: boolean;
}
export function inView(t: RegionBox, b: ViewBounds) {
  return (
    t.minLat <= b.north &&
    t.maxLat >= b.south &&
    (b.west <= b.east
      ? t.minLon <= b.east && t.maxLon >= b.west
      : t.minLon <= b.east || t.maxLon >= b.west)
  );
}
