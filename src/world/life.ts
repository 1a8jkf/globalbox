import { Biome, Terrain, type Animal, type Species, type World } from './types.ts';
import { hash } from './noise.ts';

const habitats: Record<Species, readonly number[]> = {
  chicken: [Biome.Temperate, Biome.Grassland, Biome.Savanna],
  pig: [Biome.Temperate, Biome.Tropical],
  cow: [Biome.Grassland, Biome.Temperate],
  deer: [Biome.Temperate, Biome.Taiga],
  elephant: [Biome.Savanna, Biome.Tropical],
  camel: [Biome.Desert], penguin: [Biome.Polar],
};
export function isHabitat(world: World, species: Species, x: number, y: number, exact = false): boolean {
  if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return false;
  const cell = world.getCell(x, y, exact);
  if (!cell || cell.terrain !== Terrain.Land || !habitats[species].includes(cell.biome)) return false;
  const lon = cell.longitude, lat = cell.latitude;
  if (species === 'penguin') return lat < -60;
  if (species === 'elephant') return (lon > -18 && lon < 43 && lat > -33 && lat < 16) || (lon > 75 && lon < 105 && lat > 5 && lat < 26);
  if (species === 'camel') return lon > -18 && lon < 110 && lat > 10 && lat < 49;
  if (species === 'deer') return lat > 25;
  return true;
}
export function generateAnimals(world: World): Animal[] {
  const roster: Species[] = ['chicken', 'pig', 'cow', 'deer', 'elephant', 'camel', 'penguin', 'cow', 'deer'];
  const animals: Animal[] = [];
  for (let id = 0; id < 36; id++) {
    const species = roster[id % roster.length];
    let found = false;
    for (let attempt = 0; attempt < 50000; attempt++) {
      const x = 2 + hash(id * 50000 + attempt, 11, world.seed) * (world.width - 4);
      const y = 2 + hash(id * 50000 + attempt, 29, world.seed) * (world.height - 4);
      if (!isHabitat(world, species, x, y) || [[24,0],[-24,0],[0,24],[0,-24]].some(([dx,dy]) => !isHabitat(world, species, x+dx, y+dy)) || animals.some(a => Math.hypot(a.x - x, a.y - y) < 144)) continue;
      animals.push({ id, species, x, y, originX: x, originY: y, targetX: x, targetY: y, heading: 1, waiting: hash(id, 33, world.seed) * 5, steps: 0 });
      found = true;
      break;
    }
    if (!found) throw new Error(`Habitat insuficiente para ${species}.`);
  }
  return animals;
}
export function habitatPath(world: World, animal: Animal, x: number, y: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x - animal.x, y - animal.y) * 3));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    if (!isHabitat(world, animal.species, animal.x + (x - animal.x) * t, animal.y + (y - animal.y) * t, true)) return false;
  }
  return true;
}
/** The caller advances a fixed clock. Destinations depend on identity and step, never wall time. */
export function updateAnimals(world: World, animals: Animal[], dt: number): void {
  for (const animal of animals) {
    // Preserve identity, time and position while a region is unloaded.
    if (!world.getCell(animal.x, animal.y, true)) continue;
    if (!isHabitat(world, animal.species, animal.x, animal.y, true)) continue;
    if (animal.waiting > 0) { animal.waiting -= dt; continue; }
    const dx = animal.targetX - animal.x, dy = animal.targetY - animal.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1) {
      animal.steps++;
      const x = animal.originX + (hash(animal.id, animal.steps, world.seed + 8) - 0.5) * 14;
      const y = animal.originY + (hash(animal.id, animal.steps, world.seed + 9) - 0.5) * 14;
      if (habitatPath(world, animal, x, y)) { animal.targetX = x; animal.targetY = y; }
      animal.waiting = 1 + hash(animal.id, animal.steps, world.seed + 10) * 5;
    } else {
      const stride = Math.min(distance, dt * (animal.species === 'penguin' ? 0.6 : 1.05));
      const x = animal.x + dx / distance * stride, y = animal.y + dy / distance * stride;
      if (habitatPath(world, animal, x, y)) { animal.x = x; animal.y = y; animal.heading = dx < 0 ? -1 : 1; }
      else { animal.targetX = animal.x; animal.targetY = animal.y; animal.waiting = 1; }
    }
  }
}
