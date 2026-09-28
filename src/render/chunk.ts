import { Biome, Terrain, type Region } from '../world/types.ts';
import { CHUNK_SIZE, CHUNK_PADDING, WORLD_WIDTH, WORLD_HEIGHT } from '../world/config.ts';
import { fbm, hash, noise } from '../world/noise.ts';
import { forestCover, generatePlants } from '../world/vegetation.ts';
import { treeSprite, mountainSprite } from './sprites.ts';

const palettes = [
  ['#215d7a', '#286d85', '#32798c'],
  ['#55935b', '#639f60', '#70a866', '#78ae6a'],
  ['#79a66b', '#86b173', '#92b77b', '#a1be7e'],
  ['#66896d', '#759779', '#7e9e7e', '#89a785'],
  ['#b0b16c', '#bbba73', '#c5bf79', '#ceca84'],
  ['#cdb275', '#d6bd7e', '#dec789', '#e4ce94'],
  ['#a0b776', '#adbf80', '#b6c58a', '#c0cc95'],
  ['#9ea98e', '#aab59b', '#b8bfa6', '#c7cdb3'],
  ['#8b9b7d', '#99a385', '#a7ad8e', '#b3b498'],
  ['#c7dcda', '#d6e4de', '#e3ece2', '#edf0e3'],
];
function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const colors = palettes.map(palette => palette.map(rgb));
const ocean = ['#215d7a', '#24647f', '#286c86', '#2c738b', '#337f94', '#3b8d9d', '#509fa6', '#70b5b3', '#9acbc0'].map(rgb);

const treeCache = new Map<string, OffscreenCanvas>();
const mountains = [0,1,2].flatMap(v => [mountainSprite(v, false), mountainSprite(v, true)]);
export function renderChunk(region: Region): ImageBitmap {
  const canvas = new OffscreenCanvas(CHUNK_SIZE * 2, CHUNK_SIZE * 2), ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const terrain = new OffscreenCanvas(CHUNK_SIZE, CHUNK_SIZE), terrainCtx = terrain.getContext('2d')!;
  const pixels = terrainCtx.createImageData(CHUNK_SIZE, CHUNK_SIZE);
  const { step, seed, width } = region;
  for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const i = (y + CHUNK_PADDING) * width + x + CHUNK_PADDING;
    const gx = region.originX + (x + CHUNK_PADDING + 0.5) * step;
    const gy = region.originY + (y + CHUNK_PADDING + 0.5) * step;
    const type = region.terrain[i], biome = region.biomes[i];
    const broad = fbm(gx / 688, gy / 688, seed + 31);
    let color: readonly number[];
    if (type === Terrain.Ocean) {
      const coast = region.coastDistance[i] * step / 3;
      const depth = Math.max(0, Math.min(8, Math.floor(8 - coast / (1.2 + broad * 1.5))));
      const edge = Math.min(gx, gy, WORLD_WIDTH - gx, WORLD_HEIGHT - gy);
      const band = Math.max(depth, Math.floor(broad * 3 * Math.min(1, Math.max(0, edge - 128) / 1024)));
      color = ocean[edge < 128 ? 0 : band];
    } else if (type === Terrain.Lake || type === Terrain.River) {
      color = type === Terrain.Lake ? [80,150,159] : [102,162,163];
    } else {
      const texture = fbm(gx / 144, gy / 144, seed + 32) * 0.55 + broad * 0.25 + fbm(gx / 10, gy / 10, seed + 35) * 0.2;
      const shade = Math.max(0, Math.min(3, Math.floor(texture * 5 - 0.55)));
      color = colors[biome][shade];
      const coast = [i-1,i+1,i-width,i+width].some(n => region.terrain[n] === Terrain.Ocean);
      if (coast && biome !== Biome.Polar && biome !== Biome.Tundra) color = [196,192,132];
      else if (biome === Biome.Polar && noise(gx / 80, gy / 352, seed) > 0.64) color = [189,216,216];
      else if (biome === Biome.Mountain) {
        const elevation = region.elevation[i];
        const normal = Math.max(-0.13, Math.min(0.13, (region.elevation[i-1] - region.elevation[i+1] + region.elevation[i-width] - region.elevation[i+width]) * 8));
        const rock = elevation > 0.82 ? [221,230,217] : elevation > 0.7 ? [153,161,139] : color;
        color = rock.map(c => Math.round(c * (1 + normal)));
      } else if ([Biome.Tropical, Biome.Temperate, Biome.Taiga].includes(biome as 1 | 2 | 3)) {
        // Aggregate canopy remains visible when individual trees are subpixel.
        const cover = forestCover(gx, gy, biome, seed);
        const shadeFactor = 1 - cover * 0.38;
        color = color.map(c => Math.round(c * shadeFactor));
      }
    }
    const target = (y * CHUNK_SIZE + x) * 4;
    pixels.data[target] = color[0]; pixels.data[target+1] = color[1]; pixels.data[target+2] = color[2]; pixels.data[target+3] = 255;
  }
  terrainCtx.putImageData(pixels,0,0); ctx.drawImage(terrain,0,0,CHUNK_SIZE*2,CHUNK_SIZE*2);
  // Global coordinates, clipped by the canvas, give identical objects along shared edges.
  if (step <= 2) {
    const objects: {x:number;y:number;sprite:OffscreenCanvas}[] = [];
    for (const plant of generatePlants(region)) {
      const key = `${plant.biome}:${plant.variant}`;
      if (!treeCache.has(key)) treeCache.set(key,treeSprite(plant.biome,plant.variant));
      objects.push({x:plant.x,y:plant.y,sprite:treeCache.get(key)!});
    }
    for (let gy = Math.ceil(region.originY / 5)*5; gy < region.originY+region.height*step; gy+=5) {
      for (let gx = Math.ceil(region.originX / 5)*5; gx < region.originX+region.width*step; gx+=5) {
        const i = Math.floor((gy-region.originY)/step)*width+Math.floor((gx-region.originX)/step);
        if (region.terrain[i] !== Terrain.Land || region.biomes[i] !== Biome.Mountain || hash(gx,gy,seed+15) > 0.42) continue;
        const variant = Math.min(2,Math.floor(region.elevation[i]*3));
        objects.push({x:gx,y:gy,sprite:mountains[variant*2+Number(region.elevation[i]>0.78)]});
      }
    }
    objects.sort((a,b)=>a.y-b.y || a.x-b.x);
    for (const object of objects) {
      const x=(object.x-region.originX)/step-CHUNK_PADDING, y=(object.y-region.originY)/step-CHUNK_PADDING;
      ctx.drawImage(object.sprite,Math.round(x*2-object.sprite.width/step/2),Math.round(y*2-(object.sprite.height-2)/step),object.sprite.width/step,object.sprite.height/step);
    }
  }
  return canvas.transferToImageBitmap();
}
