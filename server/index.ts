import express from "express";
import { randomUUID } from "node:crypto";
const instanceId = randomUUID();
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { db, GameError } from "./db.ts";
import {
  authenticate,
  hashPassword,
  verifyPassword,
  session,
  logout,
  sameOrigin,
  publicUser,
} from "./auth.ts";
import * as actions from "./actions.ts";
import { tick, cleanup } from "./simulation.ts";
import { BUILDINGS, CROPS, RESOURCE_KINDS } from "../shared/game.ts";
import {
  inView,
  type ViewBounds,
  type WorldUpdate,
} from "../shared/contracts.ts";
const viewSchema = z
  .object({
    west: z.coerce.number().min(-180).max(180),
    east: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-90).max(90),
    north: z.coerce.number().min(-90).max(90),
  })
  .refine((b) => b.south < b.north, "Limites inválidos.");
const interests = new WeakMap<WebSocket, ViewBounds>();
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(express.json({ limit: "160kb" }), cookieParser(), sameOrigin);
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 120,
    skip: (req) => req.method === "GET",
    message: {
      error: "Muitos comandos. Aguarde um minuto antes de tentar novamente.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 10000,
    limit: 500,
    skip: (req) => req.method !== "GET",
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Muitas consultas. Aguarde alguns segundos." },
  }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 40,
  message: { error: "Muitas tentativas de acesso. Aguarde 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});
const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,19}$/, "Use 3 a 20 letras, números ou _.")
    .max(20)
    .refine(
      (name) => !name.startsWith("demo_"),
      "O prefixo demo_ é reservado às comunidades demonstrativas.",
    ),
  password: z
    .string()
    .min(8, "Use uma senha com pelo menos 8 caracteres.")
    .max(128),
});
const cents = z.number().int().min(1).max(100000000);
const uuid = z.string().uuid();
const server = createServer(app),
  wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
let redis: ReturnType<typeof createClient> | undefined;
let latestRevision = 0;
const send = (message: WorldUpdate) => {
  for (const client of wss.clients)
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 256000) client.close(1013);
      else {
        const bounds = interests.get(client),
          regions = message.regions ?? [];
        const ids = bounds
          ? regions.filter((t) => inView(t, bounds)).map((t) => t.id)
          : message.territoryIds;
        if (message.global || ids.length)
          client.send(
            JSON.stringify({
              type: message.type,
              revision: message.revision,
              territoryIds: ids,
            }),
          );
      }
    }
};
async function changed(ids: string[] = []) {
  try {
    const state = await db.worldState.findUnique({ where: { id: 1 } });
    latestRevision = state?.revision ?? 0;
    const message = {
      type: "world:update" as const,
      global: ids.length === 0,
      regions: ids.length
        ? await db.territory.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              minLon: true,
              maxLon: true,
              minLat: true,
              maxLat: true,
            },
          })
        : [],
      revision: latestRevision,
      territoryIds: ids,
    };
    send(message);
    if (redis?.isReady)
      await redis
        .publish(
          "global-territory:events",
          JSON.stringify({ ...message, server: instanceId }),
        )
        .catch(() => {});
  } catch (error) {
    console.error(
      "Notification failed; committed state is retained",
      error instanceof Error ? error.message : error,
    );
  }
}
server.on("upgrade", (req, socket, head) => {
  try {
    if (
      req.url !== "/ws" ||
      !req.headers.origin ||
      new URL(req.headers.origin).host !== req.headers.host ||
      wss.clients.size >= 500
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } catch {
    socket.destroy();
  }
});
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "connected", revision: latestRevision }));
  socket.on("error", () => socket.close());
  let lastSubscription = 0;
  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type !== "subscribe") throw Error();
      if (Date.now() - lastSubscription < 100) return;
      const bounds = viewSchema.parse(message.bounds);
      interests.set(socket, bounds);
      lastSubscription = Date.now();
      socket.send(
        JSON.stringify({ type: "subscribed", revision: latestRevision }),
      );
    } catch {
      socket.close(1008, "Invalid subscription");
    }
  });
});
app.get("/api/health", async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({
    ok: true,
    cache: redis?.isReady ? "redis" : "disabled",
    tickMs: (await actions.config()).tickMs,
  });
});
app.get("/api/config", async (_req, res) =>
  res.json({
    ...(await actions.config()),
    buildings: BUILDINGS,
    crops: CROPS,
    payment: "SIMULATED",
  }),
);
app.post("/api/auth/register", authLimit, async (req, res) => {
  const body = credentials.parse(req.body);
  const passwordHash = await hashPassword(body.password);
  const user = await db.user.create({
    data: { username: body.username, passwordHash },
  });
  await session(res, user.id);
  res.status(201).json(publicUser(user));
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const body = credentials.parse(req.body);
  const user = await db.user.findUnique({ where: { username: body.username } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash)))
    throw new GameError("Usuário ou senha incorretos.", 401);
  await session(res, user.id);
  res.json(publicUser(user));
});
app.post("/api/auth/logout", async (req, res) => {
  await logout(req, res);
  res.json({ ok: true });
});
app.get("/api/me", authenticate, async (_req, res) =>
  res.json(publicUser(res.locals.user)),
);
app.get("/api/me/territories", authenticate, async (_req, res) =>
  res.json(
    await db.territory.findMany({
      where: { ownerId: res.locals.user.id },
      include: actions.territoryInclude,
      orderBy: { createdAt: "desc" },
    }),
  ),
);
app.get("/api/me/offers", authenticate, async (_req, res) => {
  const offers = await db.offer.findMany({
    where: {
      OR: [
        { fromUserId: res.locals.user.id },
        { toUserId: res.locals.user.id },
      ],
    },
    include: { territory: { select: { name: true, number: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const ids = [...new Set(offers.flatMap((o) => [o.fromUserId, o.toUserId]))],
    users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true },
    });
  res.json(
    offers.map((o) => ({
      ...o,
      from: users.find((u) => u.id === o.fromUserId)?.username,
      to: users.find((u) => u.id === o.toUserId)?.username,
    })),
  );
});
app.get("/api/world", async (req, res) => {
  const bounds =
    req.query.west !== undefined ? viewSchema.parse(req.query) : undefined;
  const spatial = bounds
    ? {
        minLat: { lte: bounds.north },
        maxLat: { gte: bounds.south },
        ...(bounds.west <= bounds.east
          ? { minLon: { lte: bounds.east }, maxLon: { gte: bounds.west } }
          : {
              OR: [
                { minLon: { lte: bounds.east } },
                { maxLon: { gte: bounds.west } },
              ],
            }),
      }
    : {};
  const cursor = z.coerce
    .number()
    .int()
    .min(0)
    .parse(req.query.cursor ?? 0);
  const where = { ...spatial, number: { gt: cursor } };
  const [territories, events, state, total, players] = await Promise.all([
    db.territory.findMany({
      where,
      include: {
        owner: { select: { id: true, username: true } },
        geometry: true,
        listing: true,
        _count: { select: { characters: true, buildings: true } },
      },
      take: 201,
      orderBy: { number: "asc" },
    }),
    db.worldEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.worldState.findUnique({ where: { id: 1 } }),
    db.territory.count(),
    db.user.count(),
  ]);
  res.json({
    nextCursor: territories.length > 200 ? territories[199].number : null,
    territories: territories.slice(0, 200).map(({ grid, ...t }) => t),
    events,
    state,
    total,
    players,
  });
});
app.get("/api/regions", async (req, res) => {
  const ids = z
    .array(uuid)
    .min(1)
    .max(12)
    .parse(String(req.query.ids ?? "").split(","));
  res.json(
    await db.territory.findMany({
      where: { id: { in: ids } },
      include: actions.territoryInclude,
    }),
  );
});
app.get("/api/territories/:id", async (req, res) => {
  const t = await db.territory.findUnique({
    where: { id: uuid.parse(req.params.id) },
    include: {
      ...actions.territoryInclude,
      history: { orderBy: { createdAt: "desc" }, take: 40 },
      purchases: {
        orderBy: { createdAt: "asc" },
        select: { amountCents: true, createdAt: true, type: true },
      },
    },
  });
  if (!t) throw new GameError("Território não encontrado.", 404);
  res.json(t);
});
app.get("/api/market", async (_req, res) =>
  res.json(
    await db.marketplaceListing
      .findMany({
        where: { status: "ACTIVE" },
        include: {
          territory: {
            include: {
              owner: { select: { username: true } },
              _count: { select: { characters: true, buildings: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
      .then((list) =>
        list.map((l) => ({
          ...l,
          territory: {
            id: l.territory.id,
            name: l.territory.name,
            areaKm2: l.territory.areaKm2,
            number: l.territory.number,
            owner: l.territory.owner,
            _count: l.territory._count,
            minLon: l.territory.minLon,
            minLat: l.territory.minLat,
            maxLon: l.territory.maxLon,
            maxLat: l.territory.maxLat,
          },
        })),
      ),
  ),
);
app.post("/api/territories/quote", authenticate, async (req, res) =>
  res.json(await actions.quote(res.locals.user.id, req.body.geometry)),
);
app.post("/api/territories/claim", authenticate, async (req, res) => {
  const data = z
    .object({ quoteId: uuid, name: z.string().trim().min(2).max(48) })
    .parse(req.body);
  const result = await actions.claim(
    res.locals.user.id,
    data.quoteId,
    data.name,
  );
  await changed();
  res.json(result);
});
app.post("/api/territories/:id/listing", authenticate, async (req, res) => {
  const data = z.object({ priceCents: cents.nullable() }).parse(req.body);
  const result = await actions.listTerritory(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.priceCents,
  );
  await changed();
  res.json(result);
});
app.post("/api/market/:id/buy", authenticate, async (req, res) => {
  const data = z.object({ requestId: uuid }).parse(req.body);
  const result = await actions.buy(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.requestId,
  );
  await changed();
  res.json(result);
});
app.post("/api/territories/:id/offers", authenticate, async (req, res) => {
  const data = z.object({ amountCents: cents }).parse(req.body);
  const result = await actions.offer(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.amountCents,
  );
  await changed();
  res.json(result);
});
app.post("/api/offers/:id/respond", authenticate, async (req, res) => {
  const data = z
    .object({
      action: z.enum(["accept", "reject", "counter"]),
      amountCents: cents.optional(),
    })
    .parse(req.body);
  const result = await actions.respondOffer(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.action,
    data.amountCents,
  );
  await changed();
  res.json(result);
});
app.post("/api/territories/:id/build", authenticate, async (req, res) => {
  const data = z
    .object({
      requestId: uuid,
      type: z.enum(
        Object.keys(BUILDINGS) as [
          keyof typeof BUILDINGS,
          ...(keyof typeof BUILDINGS)[],
        ],
      ),
      position: z
        .object({
          x: z.number().int().min(0).max(63),
          y: z.number().int().min(0).max(63),
        })
        .optional(),
      crop: z
        .enum(
          Object.keys(CROPS) as [keyof typeof CROPS, ...(keyof typeof CROPS)[]],
        )
        .optional(),
    })
    .parse(req.body);
  const result = await actions.build(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.type,
    data.position,
    data.crop,
    data.requestId,
  );
  await changed();
  res.status(201).json(result);
});
app.post("/api/territories/:id/exchange", authenticate, async (req, res) => {
  const data = z
    .object({
      requestId: uuid,
      kind: z.enum(RESOURCE_KINDS),
      side: z.enum(["buy", "sell"]),
      quantity: z.number().int().min(1).max(500),
    })
    .parse(req.body);
  const result = await actions.exchange(
    res.locals.user.id,
    uuid.parse(req.params.id),
    data.kind,
    data.side,
    data.quantity,
    data.requestId,
  );
  await changed();
  res.json(result);
});
app.get("/api/profiles/:username", async (req, res) => {
  const user = await db.user.findUnique({
    where: { username: req.params.username.toLowerCase() },
    select: { id: true, username: true, createdAt: true },
  });
  if (!user) throw new GameError("Jogador não encontrado.", 404);
  const territories = await db.territory.findMany({
    where: { ownerId: user.id },
    include: {
      resources: true,
      _count: { select: { characters: true, buildings: true } },
    },
  });
  const trades = await db.purchase.aggregate({
    where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
    _sum: { amountCents: true },
    _count: true,
  });
  res.json({
    ...user,
    territories: territories.map(({ grid, ...t }) => t),
    tradingVolume: trades._sum.amountCents ?? 0,
    trades: trades._count,
  });
});
const placesFile = resolve("public/map/places.json");
let places: { name: string; country: string; coordinates: [number, number] }[] =
  [];
if (existsSync(placesFile))
  places = JSON.parse(readFileSync(placesFile, "utf8"));
app.get("/api/search", (req, res) => {
  const q = String(req.query.q ?? "")
    .slice(0, 80)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  res.json(
    q.length < 2
      ? []
      : places
          .filter((p) =>
            `${p.name} ${p.country}`
              .normalize("NFD")
              .replace(/\p{Diacritic}/gu, "")
              .toLowerCase()
              .includes(q),
          )
          .slice(0, 10),
  );
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint não encontrado." }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "JSON inválido." });
      return;
    }
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ error: error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }
    if (error instanceof GameError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({ error: "Esse usuário ou operação já existe." });
      return;
    }
    console.error(
      error instanceof Error ? error.message : "Unexpected server error",
    );
    res
      .status(500)
      .json({ error: "Não foi possível concluir. Tente novamente." });
  },
);
await actions.initializeConfig();
if (process.env.REDIS_URL) {
  redis = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
  });
  redis.on("error", () => {});
  await redis.connect();
  const subscriber = redis.duplicate();
  subscriber.on("error", () => {});
  await subscriber.connect();
  await subscriber.subscribe("global-territory:events", (text) => {
    try {
      const message = JSON.parse(text);
      if (message.server !== instanceId) send(message);
    } catch {}
  });
}
const tickMs = (await actions.config()).tickMs;
let busy = false;
const timer = setInterval(async () => {
  if (busy || process.env.DISABLE_TICK === "true") return;
  busy = true;
  try {
    const ids = await tick();
    if (ids.length) await changed(ids);
  } catch (error) {
    console.error(
      "Simulation tick failed:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    busy = false;
  }
}, tickMs);
const cleanupTimer = setInterval(() => {
  void cleanup().catch(() => {});
}, 3600000);
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if ((client as WebSocket & { alive?: boolean }).alive === false) {
      client.terminate();
      continue;
    }
    (client as WebSocket & { alive?: boolean }).alive = false;
    client.ping();
  }
}, 30000);
wss.on("connection", (client) => {
  (client as WebSocket & { alive?: boolean }).alive = true;
  client.on("pong", () => {
    (client as WebSocket & { alive?: boolean }).alive = true;
  });
});
server.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () =>
  console.log(
    `GLOBAL TERRITORY server ready on ${Number(process.env.PORT) || 3001}; simulated payments only.`,
  ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(cleanupTimer);
  clearInterval(heartbeat);
  wss.clients.forEach((c) => c.close());
  server.close();
  await db.$disconnect();
  if (redis?.isOpen) await redis.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
