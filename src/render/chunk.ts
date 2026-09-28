import { type Region } from "../world/types.ts";
import { CHUNK_SIZE, CHUNK_PADDING } from "../world/config.ts";
import { generatePlants } from "../world/vegetation.ts";
import { treeSprite } from "./sprites.ts";

import { renderSurface } from "../terrain/surface.ts";
const treeCache = new Map<string, OffscreenCanvas>();
export function renderChunk(region: Region): ImageBitmap {
  const canvas = new OffscreenCanvas(CHUNK_SIZE * 2, CHUNK_SIZE * 2),
    ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const { step } = region;
  const pixels = renderSurface(region, { detail: 4 - Math.log2(step) });
  ctx.putImageData(new ImageData(pixels, 512, 512), 0, 0);
  // Global coordinates, clipped by the canvas, give identical objects along shared edges.
  if (step <= 2) {
    const objects: { x: number; y: number; sprite: OffscreenCanvas }[] = [];
    for (const plant of generatePlants(region)) {
      const key = `${plant.biome}:${plant.variant}`;
      if (!treeCache.has(key))
        treeCache.set(key, treeSprite(plant.biome, plant.variant));
      objects.push({ x: plant.x, y: plant.y, sprite: treeCache.get(key)! });
    }
    objects.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const object of objects) {
      const x = (object.x - region.originX) / step - CHUNK_PADDING,
        y = (object.y - region.originY) / step - CHUNK_PADDING;
      ctx.drawImage(
        object.sprite,
        Math.round(x * 2 - object.sprite.width / step / 2),
        Math.round(y * 2 - (object.sprite.height - 2) / step),
        object.sprite.width / step,
        object.sprite.height / step,
      );
    }
  }
  return canvas.transferToImageBitmap();
}
