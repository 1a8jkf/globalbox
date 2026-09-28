import { once } from "./commands.ts";
import { route } from "./pathfinding.ts";
import { Prisma } from "@prisma/client";
import type { Polygon } from "geojson";
import { randomUUID } from "node:crypto";
import { db, transact, requireValue, GameError, type Tx } from "./db.ts";
import {
  normalizePolygon,
  overlaps,
  makeGrid,
  insideFootprint,
} from "./geometry.ts";
import {
  GRID,
  BUILDINGS,
  RESOURCE_KINDS,
  RESOURCE_PRICE,
  DEFAULT_PRICING,
  estimatePrice,
  type PricingConfig,
  type BuildingKind,
  type CropKind,
  type ResourceKind,
} from "../shared/game.ts";
import { payment } from "./payments.ts";
export const territoryInclude = {
  owner: { select: { id: true, username: true } },
  geometry: true,
  resources: { orderBy: { kind: "asc" } },
  buildings: { orderBy: { createdAt: "asc" } },
  characters: { orderBy: { name: "asc" } },
  farms: true,
  listing: true,
} as const;
export async function config() {
  const value = await db.gameConfig.findUnique({ where: { id: 1 } });
  return {
    pricing: (value?.pricing ?? DEFAULT_PRICING) as unknown as PricingConfig,
    tickMs: value?.tickMs ?? 3000,
    resourcePrices: (value?.resourcePrices ?? RESOURCE_PRICE) as Record<
      ResourceKind,
      number
    >,
  };
}
export async function event(
  tx: Tx,
  territoryId: string,
  type: string,
  text: string,
  actorId?: string,
) {
  await tx.territoryHistory.create({
    data: { territoryId, type, text, actorId },
  });
  await tx.worldEvent.create({ data: { territoryId, type, text, actorId } });
}
export async function bump(tx: Tx) {
  await tx.worldState.upsert({
    where: { id: 1 },
    create: { id: 1, revision: 1 },
    update: { revision: { increment: 1 } },
  });
}
async function owner(tx: Tx, userId: string, territoryId: string) {
  const territory = await tx.territory.findUnique({
    where: { id: territoryId },
    include: {
      geometry: true,
      buildings: true,
      resources: true,
      characters: true,
    },
  });
  requireValue(territory, "Território não encontrado.", 404);
  requireValue(
    territory!.ownerId === userId,
    "Você não tem permissão neste território.",
    403,
  );
  return territory!;
}
async function available(tx: Tx, geometry: Polygon, bounds: number[]) {
  const candidates = await tx.territory.findMany({
    where: {
      minLon: { lte: bounds[2] },
      maxLon: { gte: bounds[0] },
      minLat: { lte: bounds[3] },
      maxLat: { gte: bounds[1] },
    },
    include: { geometry: true },
  });
  requireValue(
    !candidates.some(
      (t) =>
        t.geometry &&
        overlaps(geometry, t.geometry.polygon as unknown as Polygon),
    ),
    "Esta área se sobrepõe a um território existente.",
    409,
  );
  return candidates;
}
export async function quote(userId: string, input: unknown) {
  const normal = normalizePolygon(input),
    settings = await config();
  requireValue(
    normal.areaKm2 >= settings.pricing.minArea &&
      normal.areaKm2 <= settings.pricing.maxArea,
    `A área deve ter entre ${settings.pricing.minArea} e ${settings.pricing.maxArea} km².`,
  );
  makeGrid(normal.feature, normal.bounds);
  return transact(async (tx) => {
    await available(tx, normal.feature.geometry, normal.bounds);
    const [b0, b1, b2, b3] = normal.bounds;
    const nearby = await tx.territory.count({
      where: {
        minLon: { lte: b2 + 0.5 },
        maxLon: { gte: b0 - 0.5 },
        minLat: { lte: b3 + 0.5 },
        maxLat: { gte: b1 - 0.5 },
      },
    });
    const activity = await tx.purchase.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
        territory: {
          minLon: { lte: b2 + 0.5 },
          maxLon: { gte: b0 - 0.5 },
          minLat: { lte: b3 + 0.5 },
          maxLat: { gte: b1 - 0.5 },
        },
      },
    });
    const priceCents = estimatePrice(
      normal.areaKm2,
      settings.pricing,
      nearby,
      activity,
      [(b0 + b2) / 2, (b1 + b3) / 2],
    );
    const value = await tx.quote.create({
      data: {
        userId,
        polygon: normal.feature.geometry as unknown as Prisma.InputJsonValue,
        areaKm2: normal.areaKm2,
        priceCents,
        expiresAt: new Date(Date.now() + 120000),
      },
    });
    return {
      id: value.id,
      areaKm2: value.areaKm2,
      priceCents: value.priceCents,
      expiresAt: value.expiresAt,
      geometry: value.polygon,
    };
  });
}
const people = [
  "Lia",
  "Téo",
  "Nara",
  "Caio",
  "Íris",
  "Bento",
  "Mila",
  "Ravi",
  "Yara",
  "Otto",
];
export async function populate(tx: Tx, territoryId: string, grid: string) {
  const eligible = [...grid]
    .map((v, i) => (v !== "0" && v !== "w" ? i : -1))
    .filter((i) => i >= 0)
    .sort(
      (a, b) =>
        Math.hypot((a % GRID) - 32, Math.floor(a / GRID) - 32) -
        Math.hypot((b % GRID) - 32, Math.floor(b / GRID) - 32),
    );
  requireValue(
    eligible.length >= 6,
    "Terreno insuficiente para uma comunidade.",
  );
  await tx.character.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      territoryId,
      name: people[i],
      profession:
        i < 2 ? "Builder" : i < 4 ? "Farmer" : i === 4 ? "Woodcutter" : "Miner",
      x: (eligible[i] % GRID) + 0.5,
      y: Math.floor(eligible[i] / GRID) + 0.5,
      age: 20 + i * 3,
    })),
  });
  await tx.resource.createMany({
    data: RESOURCE_KINDS.map((kind) => ({
      territoryId,
      kind,
      amount:
        kind === "Food"
          ? 80
          : kind === "Wood"
            ? 100
            : kind === "Stone"
              ? 60
              : kind === "Metal"
                ? 20
                : 50,
      capacity: 600,
    })),
  });
}
export async function claim(userId: string, quoteId: string, name: string) {
  return transact(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id: quoteId } });
    requireValue(q && q.userId === userId, "Cotação não encontrada.", 404);
    if (q!.territoryId)
      return tx.territory.findUnique({
        where: { id: q!.territoryId },
        include: territoryInclude,
      });
    requireValue(
      q!.expiresAt > new Date(),
      "A cotação expirou. Solicite uma nova.",
      409,
    );
    const normal = normalizePolygon(q!.polygon);
    await available(tx, normal.feature.geometry, normal.bounds);
    const grid = makeGrid(normal.feature, normal.bounds);
    const debit = await tx.user.updateMany({
      where: { id: userId, money: { gte: q!.priceCents } },
      data: { money: { decrement: q!.priceCents } },
    });
    requireValue(debit.count === 1, "Saldo fictício insuficiente.", 409);
    await payment.confirm({ reference: q!.id, amountCents: q!.priceCents });
    const [minLon, minLat, maxLon, maxLat] = normal.bounds;
    const territory = await tx.territory.create({
      data: {
        name,
        ownerId: userId,
        areaKm2: q!.areaKm2,
        minLon,
        minLat,
        maxLon,
        maxLat,
        grid,
        geometry: { create: { polygon: q!.polygon as Prisma.InputJsonValue } },
      },
    });
    await tx.quote.update({
      where: { id: q!.id },
      data: { territoryId: territory.id },
    });
    await tx.purchase.create({
      data: {
        idempotencyKey: `claim:${q!.id}`,
        territoryId: territory.id,
        buyerId: userId,
        amountCents: q!.priceCents,
        type: "CLAIM",
      },
    });
    await populate(tx, territory.id, grid);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await event(
      tx,
      territory.id,
      "CLAIM",
      `@${user.username} fundou ${name}.`,
      userId,
    );
    await bump(tx);
    return tx.territory.findUnique({
      where: { id: territory.id },
      include: territoryInclude,
    });
  });
}
export async function listTerritory(
  userId: string,
  id: string,
  priceCents: number | null,
) {
  return transact(async (tx) => {
    await owner(tx, userId, id);
    if (priceCents === null) {
      await tx.marketplaceListing.updateMany({
        where: { territoryId: id, sellerId: userId, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
    } else {
      await tx.marketplaceListing.upsert({
        where: { territoryId: id },
        create: { territoryId: id, sellerId: userId, priceCents },
        update: { sellerId: userId, priceCents, status: "ACTIVE" },
      });
      await event(tx, id, "LISTED", "Território anunciado no mercado.", userId);
    }
    await bump(tx);
    return { ok: true };
  });
}
async function transfer(
  tx: Tx,
  input: {
    territoryId: string;
    buyerId: string;
    sellerId: string;
    amountCents: number;
    key: string;
    offerId?: string;
  },
) {
  const previous = await tx.purchase.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (previous) {
    requireValue(
      previous.buyerId === input.buyerId &&
        previous.territoryId === input.territoryId,
      "Identificador de compra já utilizado.",
      409,
    );
    return previous;
  }
  const t = await tx.territory.findUniqueOrThrow({
    where: { id: input.territoryId },
  });
  requireValue(
    t.ownerId === input.sellerId && input.buyerId !== input.sellerId,
    "A propriedade mudou. Atualize o mercado.",
    409,
  );
  const debit = await tx.user.updateMany({
    where: { id: input.buyerId, money: { gte: input.amountCents } },
    data: { money: { decrement: input.amountCents } },
  });
  requireValue(
    debit.count === 1,
    "O comprador não possui saldo fictício suficiente.",
    409,
  );
  await payment.confirm({
    reference: input.key,
    amountCents: input.amountCents,
  });
  await tx.user.update({
    where: { id: input.sellerId },
    data: { money: { increment: input.amountCents } },
  });
  await tx.territory.update({
    where: { id: t.id },
    data: { ownerId: input.buyerId },
  });
  await tx.marketplaceListing.updateMany({
    where: { territoryId: t.id, status: "ACTIVE" },
    data: { status: "SOLD" },
  });
  await tx.offer.updateMany({
    where: { territoryId: t.id, status: "OPEN" },
    data: { status: "INVALIDATED" },
  });
  if (input.offerId)
    await tx.offer.update({
      where: { id: input.offerId },
      data: { status: "ACCEPTED" },
    });
  const buyer = await tx.user.findUniqueOrThrow({
      where: { id: input.buyerId },
    }),
    seller = await tx.user.findUniqueOrThrow({ where: { id: input.sellerId } });
  await event(
    tx,
    t.id,
    "TRANSFER",
    `@${seller.username} vendeu para @${buyer.username} por R$ ${(input.amountCents / 100).toFixed(2)} simulados.`,
    input.buyerId,
  );
  await bump(tx);
  return tx.purchase.create({
    data: {
      idempotencyKey: input.key,
      territoryId: t.id,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      amountCents: input.amountCents,
      type: "RESALE",
    },
  });
}
export async function buy(
  userId: string,
  listingId: string,
  requestId: string,
) {
  return transact(async (tx) => {
    const key = `buy:${userId}:${requestId}`,
      previous = await tx.purchase.findUnique({
        where: { idempotencyKey: key },
      });
    const listing = await tx.marketplaceListing.findUnique({
      where: { id: listingId },
    });
    requireValue(listing, "Anúncio não encontrado.", 404);
    if (previous) {
      requireValue(
        previous.territoryId === listing!.territoryId,
        "Compra já utilizada.",
        409,
      );
      return previous;
    }
    requireValue(
      listing!.status === "ACTIVE",
      "Este anúncio não está mais disponível.",
      409,
    );
    return transfer(tx, {
      territoryId: listing!.territoryId,
      buyerId: userId,
      sellerId: listing!.sellerId,
      amountCents: listing!.priceCents,
      key,
    });
  });
}
export async function offer(
  userId: string,
  territoryId: string,
  amountCents: number,
) {
  return transact(async (tx) => {
    const territory = await tx.territory.findUnique({
      where: { id: territoryId },
    });
    requireValue(territory, "Território não encontrado.", 404);
    requireValue(
      territory!.ownerId !== userId,
      "Você já é dono deste território.",
    );
    const existing = await tx.offer.count({
      where: { territoryId, buyerId: userId, status: "OPEN" },
    });
    requireValue(
      existing < 1,
      "Você já possui uma oferta aberta para este território.",
      409,
    );
    const value = await tx.offer.create({
      data: {
        territoryId,
        buyerId: userId,
        sellerId: territory!.ownerId,
        fromUserId: userId,
        toUserId: territory!.ownerId,
        amountCents,
      },
    });
    await bump(tx);
    return value;
  });
}
export async function respondOffer(
  userId: string,
  id: string,
  action: "accept" | "reject" | "counter",
  amountCents?: number,
) {
  return transact(async (tx) => {
    const o = await tx.offer.findUnique({ where: { id } });
    requireValue(o && o.toUserId === userId, "Oferta não encontrada.", 404);
    if (o!.status === "ACCEPTED" && action === "accept")
      return tx.purchase.findUnique({
        where: { idempotencyKey: `offer:${id}` },
      });
    requireValue(o!.status === "OPEN", "A oferta já foi encerrada.", 409);
    const t = await tx.territory.findUniqueOrThrow({
      where: { id: o!.territoryId },
    });
    requireValue(
      t.ownerId === o!.sellerId,
      "O território mudou de proprietário.",
      409,
    );
    if (action === "accept")
      return transfer(tx, {
        territoryId: o!.territoryId,
        buyerId: o!.buyerId,
        sellerId: o!.sellerId,
        amountCents: o!.amountCents,
        key: `offer:${id}`,
        offerId: id,
      });
    await tx.offer.update({
      where: { id },
      data: { status: action === "counter" ? "COUNTERED" : "REJECTED" },
    });
    await bump(tx);
    if (action === "counter") {
      requireValue(amountCents, "Informe um valor para a contraproposta.");
      return tx.offer.create({
        data: {
          territoryId: o!.territoryId,
          buyerId: o!.buyerId,
          sellerId: o!.sellerId,
          fromUserId: userId,
          toUserId: o!.fromUserId,
          amountCents: amountCents!,
          parentId: id,
        },
      });
    }
    return { ok: true };
  });
}
export function canPlace(
  t: {
    grid: string;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    geometry: { polygon: unknown } | null;
    buildings: { x: number; y: number; type: string }[];
  },
  kind: BuildingKind,
  x: number,
  y: number,
): boolean {
  const size = BUILDINGS[kind].size;
  if (x < 0 || y < 0 || x + size > GRID || y + size > GRID || !t.geometry)
    return false;
  if (
    !insideFootprint(
      t.geometry.polygon as Polygon,
      [t.minLon, t.minLat, t.maxLon, t.maxLat],
      x,
      y,
      size,
    )
  )
    return false;
  for (let yy = y; yy < y + size; yy++)
    for (let xx = x; xx < x + size; xx++) {
      const terrain = t.grid[yy * GRID + xx];
      if (
        terrain === "0" ||
        terrain === "w" ||
        (kind === "Farm" && ["s", "m"].includes(terrain))
      )
        return false;
    }
  return !t.buildings.some((b) => {
    const bs = BUILDINGS[b.type as BuildingKind]?.size ?? 1;
    return x < b.x + bs && x + size > b.x && y < b.y + bs && y + size > b.y;
  });
}
export async function build(
  userId: string,
  territoryId: string,
  kind: BuildingKind,
  position: { x: number; y: number } | undefined,
  crop: CropKind = "Wheat",
  requestId: string = randomUUID(),
) {
  return transact(async (tx) =>
    once(
      tx,
      userId,
      requestId,
      { kind: "build", territoryId, type: kind, position, crop },
      async () => {
        const t = await owner(tx, userId, territoryId);
        requireValue(
          t.buildings.length < 128,
          "Limite de 128 construções por território neste MVP.",
        );
        const builders = t.characters.filter((c) => c.profession === "Builder");
        const reachable = (x: number, y: number) =>
          builders.some(
            (c) =>
              Math.hypot(c.x - x - 0.5, c.y - y - 0.5) < 1 ||
              route(t.grid, [c.x, c.y], [x + 0.5, y + 0.5]).length > 0,
          );
        let site = position;
        if (!site) {
          const candidates = Array.from({ length: GRID * GRID }, (_, i) => ({
            x: i % GRID,
            y: Math.floor(i / GRID),
          })).sort(
            (a, b) =>
              Math.hypot(a.x - 32, a.y - 32) - Math.hypot(b.x - 32, b.y - 32),
          );
          site = candidates.find(
            (p) => canPlace(t, kind, p.x, p.y) && reachable(p.x, p.y),
          );
        }
        requireValue(
          site &&
            canPlace(t, kind, site.x, site.y) &&
            reachable(site.x, site.y),
          "Escolha um espaço livre e compatível dentro da sua fronteira.",
        );
        for (const [resource, cost] of Object.entries(BUILDINGS[kind].cost)) {
          const updated = await tx.resource.updateMany({
            where: { territoryId, kind: resource, amount: { gte: cost } },
            data: { amount: { decrement: cost } },
          });
          requireValue(
            updated.count === 1,
            `Recursos insuficientes: ${resource}.`,
            409,
          );
        }
        const value = await tx.building.create({
          data: { territoryId, type: kind, x: site!.x, y: site!.y },
        });
        if (kind === "Farm")
          await tx.farm.create({
            data: {
              territoryId,
              buildingId: value.id,
              crop,
              fertility: 0.65 + ((site!.x * 17 + site!.y * 11) % 35) / 100,
            },
          });
        await event(
          tx,
          territoryId,
          "BUILD_ORDER",
          `Construção de ${BUILDINGS[kind].label.toLowerCase()} iniciada.`,
          userId,
        );
        await bump(tx);
        return value;
      },
    ),
  );
}
export async function exchange(
  userId: string,
  territoryId: string,
  kind: ResourceKind,
  side: "buy" | "sell",
  quantity: number,
  requestId: string = randomUUID(),
) {
  return transact(async (tx) =>
    once(
      tx,
      userId,
      requestId,
      { kind: "exchange", territoryId, resource: kind, side, quantity },
      async () => {
        await owner(tx, userId, territoryId);
        const r = await tx.resource.findUniqueOrThrow({
          where: { territoryId_kind: { territoryId, kind } },
        });
        const prices = (
          await tx.gameConfig.findUniqueOrThrow({ where: { id: 1 } })
        ).resourcePrices as Record<ResourceKind, number>;
        const total = prices[kind] * quantity;
        requireValue(
          Number.isSafeInteger(total) && total > 0,
          "Preço de recurso inválido.",
        );
        if (side === "buy") {
          requireValue(
            r.amount + quantity <= r.capacity,
            "Armazenamento cheio.",
          );
          const debit = await tx.user.updateMany({
            where: { id: userId, money: { gte: total } },
            data: { money: { decrement: total } },
          });
          requireValue(debit.count === 1, "Saldo fictício insuficiente.", 409);
          await tx.resource.update({
            where: { id: r.id },
            data: { amount: { increment: quantity } },
          });
        } else {
          requireValue(r.amount >= quantity, "Estoque insuficiente.");
          await tx.resource.update({
            where: { id: r.id },
            data: { amount: { decrement: quantity } },
          });
          await tx.user.update({
            where: { id: userId },
            data: { money: { increment: total } },
          });
        }
        await event(
          tx,
          territoryId,
          "RESOURCE_TRADE",
          `${quantity} ${kind}: ${side === "buy" ? "compra" : "venda"} na bolsa simulada.`,
          userId,
        );
        await bump(tx);
        return { ok: true };
      },
    ),
  );
}
export async function initializeConfig() {
  await db.gameConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      pricing: DEFAULT_PRICING as unknown as Prisma.InputJsonValue,
      tickMs: Math.max(
        1000,
        Math.min(60000, Number(process.env.TICK_MS) || 3000),
      ),
    },
    update: {},
  });
  await db.worldState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}
export { randomUUID, GameError };
