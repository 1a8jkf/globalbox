/** Optional synthetic communities; never creates a shared login password. */
import { randomBytes } from "node:crypto";
import { db, transact } from "./db.ts";
import { hashPassword } from "./auth.ts";
import {
  quote,
  claim,
  build,
  listTerritory,
  initializeConfig,
} from "./actions.ts";
await initializeConfig();
const examples = [
  {
    username: "demo_jardineira",
    name: "Vale das Sementes",
    lon: -47.5,
    lat: -22.5,
    sale: 1200,
  },
  {
    username: "demo_cartografo",
    name: "Bosque do Horizonte",
    lon: 2.1,
    lat: 47.1,
    sale: 1800,
  },
  {
    username: "demo_viajante",
    name: "Colina do Sol",
    lon: 138.5,
    lat: 36.1,
    sale: 900,
  },
];
for (const e of examples) {
  if (await db.user.findUnique({ where: { username: e.username } })) continue;
  const u = await db.user.create({
    data: {
      username: e.username,
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
    },
  });
  const x = e.lon,
    y = e.lat;
  const geometry = {
    type: "Polygon",
    coordinates: [
      [
        [x - 0.03, y - 0.025],
        [x + 0.006, y - 0.03],
        [x + 0.029, y - 0.011],
        [x + 0.032, y + 0.019],
        [x + 0.008, y + 0.032],
        [x - 0.022, y + 0.023],
        [x - 0.03, y - 0.025],
      ],
    ],
  };
  try {
    const q = await quote(u.id, geometry),
      t = await claim(u.id, q.id, e.name);
    if (!t) throw Error("Claim missing");
    for (const kind of ["House", "Farm", "Road"] as const)
      await build(u.id, t.id, kind, undefined);
    await transact(async (tx) => {
      await tx.building.updateMany({
        where: { territoryId: t.id },
        data: { progress: 1 },
      });
      await tx.farm.updateMany({
        where: { territoryId: t.id },
        data: { growth: 0.7 },
      });
    });
    await listTerritory(u.id, t.id, e.sale);
    console.log("Synthetic community ready:", e.name);
  } catch (e) {
    console.error(e);
    throw e;
  }
}
await db.$disconnect();
