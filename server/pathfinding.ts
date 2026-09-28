import { GRID } from "../shared/game.ts";
export function route(
  grid: string,
  from: [number, number],
  to: [number, number],
): [number, number][] {
  const sx = Math.floor(from[0]),
    sy = Math.floor(from[1]),
    tx = Math.floor(to[0]),
    ty = Math.floor(to[1]);
  const walk = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < GRID &&
    y < GRID &&
    grid[y * GRID + x] !== "0" &&
    grid[y * GRID + x] !== "w";
  if (!walk(sx, sy) || !walk(tx, ty)) return [];
  const start = sy * GRID + sx,
    end = ty * GRID + tx,
    parents = new Int32Array(GRID * GRID).fill(-1),
    queue = [start];
  parents[start] = start;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current === end) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = (current % GRID) + dx,
        y = Math.floor(current / GRID) + dy,
        n = y * GRID + x;
      if (walk(x, y) && parents[n] === -1) {
        parents[n] = current;
        queue.push(n);
      }
    }
  }
  if (parents[end] === -1) return [];
  const result: [number, number][] = [];
  let current = end;
  while (current !== start) {
    result.push([(current % GRID) + 0.5, Math.floor(current / GRID) + 0.5]);
    current = parents[current];
  }
  return result.reverse();
}
