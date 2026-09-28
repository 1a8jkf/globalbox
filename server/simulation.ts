import { Prisma } from "@prisma/client";
import { transact, db } from "./db.ts";
import { event } from "./actions.ts";
import {
  BUILDINGS,
  CROPS,
  type BuildingKind,
  type CropKind,
} from "../shared/game.ts";
import { route } from "./pathfinding.ts";
export async function tick(now = new Date()) {
  return transact(async (tx) => {
    const state = await tx.worldState.findUniqueOrThrow({ where: { id: 1 } });
    const dt = Math.max(
      0,
      Math.min(300, (now.getTime() - state.lastTick.getTime()) / 1000),
    );
    const interval = (
      await tx.gameConfig.findUniqueOrThrow({ where: { id: 1 } })
    ).tickMs;
    if (dt < (interval / 1000) * 0.95) return [] as string[];
    const territories = await tx.territory.findMany({
      include: {
        buildings: { orderBy: { createdAt: "asc" } },
        characters: true,
        farms: true,
        resources: true,
      },
    });
    const changed: string[] = [];
    for (const t of territories) {
      const amounts = Object.fromEntries(
          t.resources.map((r) => [r.kind, r.amount]),
        ) as Record<string, number>,
        production: Record<string, number> = {},
        consumption: Record<string, number> = {};
      const unfinished = t.buildings.filter((b) => b.progress < 1),
        finished = t.buildings.filter((b) => b.progress >= 1);
      const jobs = new Map<string, number>();
      for (const character of t.characters) {
        let x = character.x,
          y = character.y,
          energy = character.energy,
          hunger = Math.min(100, character.hunger + dt * 0.02),
          health = character.health,
          task = character.task,
          job = character.job;
        let path = character.path as [number, number][];
        const hungry = hunger > 20 && (amounts.Food ?? 0) > 1;
        if (hungry) {
          amounts.Food -= 1;
          consumption.Food = (consumption.Food ?? 0) + 1 / dt;
          hunger = Math.max(0, hunger - 20);
          task = "Eating";
        } else if (energy < 20 || (task === "Resting" && energy < 85)) {
          task = "Resting";
          energy = Math.min(100, energy + dt * 2);
          path = [];
          job = null;
        } else {
          const workSites =
            character.profession === "Builder"
              ? unfinished
              : finished.filter(
                  (b) =>
                    b.type ===
                    (character.profession === "Farmer"
                      ? "Farm"
                      : character.profession === "Woodcutter"
                        ? "Lumberyard"
                        : character.profession === "Miner"
                          ? "Mine"
                          : "none"),
                );
          const peers = t.characters
            .filter((c) => c.profession === character.profession)
            .sort((a, b) => a.id.localeCompare(b.id));
          const slot = peers.findIndex((c) => c.id === character.id);
          const rotation = Math.floor(state.tick / 40);
          const target = workSites.length
            ? workSites[
                character.profession === "Builder"
                  ? 0
                  : (slot + rotation) % workSites.length
              ]
            : undefined;
          if (target) {
            if (job !== target.id) {
              path = route(t.grid, [x, y], [target.x + 0.5, target.y + 0.5]);
              job = target.id;
            }
            task = path.length
              ? "Walking"
              : target.progress < 1
                ? "Building"
                : target.type === "Farm"
                  ? "Farming"
                  : target.type === "Lumberyard"
                    ? "Gathering"
                    : "Mining";
            if (
              !path.length &&
              Math.hypot(x - target.x - 0.5, y - target.y - 0.5) < 1.6
            )
              jobs.set(target.id, (jobs.get(target.id) ?? 0) + 1);
          } else {
            job = null;
            task = "Exploring";
            if (!path.length) {
              const angle =
                ((state.tick * 17 + character.name.length * 47) * Math.PI) /
                180;
              const dest: [number, number] = [
                Math.max(0.5, Math.min(63.5, x + Math.cos(angle) * 5)),
                Math.max(0.5, Math.min(63.5, y + Math.sin(angle) * 5)),
              ];
              path = route(t.grid, [x, y], dest);
            }
          }
          let distance = Math.min(dt, 6) * 0.8;
          while (path.length && distance > 0) {
            const [px, py] = path[0],
              d = Math.hypot(px - x, py - y);
            if (d <= distance) {
              x = px;
              y = py;
              path.shift();
              distance -= d;
            } else {
              x += ((px - x) / d) * distance;
              y += ((py - y) / d) * distance;
              distance = 0;
            }
          }
          energy = Math.max(0, energy - dt * 0.04);
        }
        health = Math.max(
          1,
          Math.min(100, health + (hunger > 85 ? -dt * 0.025 : dt * 0.005)),
        );
        await tx.character.update({
          where: { id: character.id },
          data: {
            x,
            y,
            energy,
            hunger,
            health,
            task,
            job,
            path: path as Prisma.InputJsonValue,
            age: character.age + dt / (86400 * 12),
          },
        });
      }
      for (const building of unfinished) {
        const workers = jobs.get(building.id) ?? 0;
        if (!workers) continue;
        const progress = Math.min(
          1,
          building.progress +
            (dt * workers) / BUILDINGS[building.type as BuildingKind].seconds,
        );
        await tx.building.update({
          where: { id: building.id },
          data: { progress },
        });
        if (progress >= 1)
          await event(
            tx,
            t.id,
            "BUILD_COMPLETE",
            `${BUILDINGS[building.type as BuildingKind].label} concluída.`,
            t.ownerId,
          );
      }
      for (const farm of t.farms) {
        if (!finished.some((b) => b.id === farm.buildingId)) continue;
        const workers = jobs.get(farm.buildingId) ?? 0;
        if (!workers) continue;
        const crop = CROPS[farm.crop as CropKind],
          growth = farm.growth + (dt * Math.min(2, workers)) / crop.seconds,
          harvests = Math.floor(growth);
        if (harvests) {
          const yieldAmount = harvests * crop.yield * farm.fertility;
          amounts[crop.resource] = (amounts[crop.resource] ?? 0) + yieldAmount;
          await event(
            tx,
            t.id,
            "HARVEST",
            `Colheita de ${crop.label.toLowerCase()}: +${Math.floor(yieldAmount)} ${crop.resource}.`,
            t.ownerId,
          );
        }
        production[crop.resource] =
          (production[crop.resource] ?? 0) +
          (crop.yield * farm.fertility * Math.min(2, workers)) / crop.seconds;
        await tx.farm.update({
          where: { id: farm.id },
          data: { growth: growth % 1, harvests: { increment: harvests } },
        });
      }
      for (const b of finished) {
        const workers = jobs.get(b.id) ?? 0;
        if (workers && b.type === "Lumberyard") {
          amounts.Wood += dt * 0.08 * workers;
          production.Wood = (production.Wood ?? 0) + 0.08 * workers;
        }
        if (workers && b.type === "Mine") {
          amounts.Stone += dt * 0.05 * workers;
          amounts.Metal += dt * 0.012 * workers;
          production.Stone = (production.Stone ?? 0) + 0.05 * workers;
          production.Metal = (production.Metal ?? 0) + 0.012 * workers;
        }
      }
      const capacity =
        600 + finished.filter((b) => b.type === "Warehouse").length * 300;
      for (const r of t.resources)
        await tx.resource.update({
          where: { id: r.id },
          data: {
            amount: Math.max(0, Math.min(capacity, amounts[r.kind] ?? 0)),
            capacity,
            production: production[r.kind] ?? 0,
            consumption: consumption[r.kind] ?? 0,
          },
        });
      changed.push(t.id);
    }
    await tx.worldState.update({
      where: { id: 1 },
      data: {
        tick: { increment: 1 },
        revision: { increment: 1 },
        lastTick: now,
      },
    });
    return changed;
  });
}
export async function cleanup() {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.quote.deleteMany({
    where: {
      expiresAt: { lt: new Date(Date.now() - 86400000) },
      territoryId: null,
    },
  });
}
