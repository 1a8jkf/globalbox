export function hash(x: number, y: number, seed = 271828): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
export function noise(x: number, y: number, seed = 271828): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = smooth(x - ix), ty = smooth(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
export function fbm(x: number, y: number, seed = 271828): number {
  return noise(x, y, seed) * 0.6 + noise(x * 2, y * 2, seed + 1) * 0.27 + noise(x * 4, y * 4, seed + 2) * 0.13;
}
