import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once as eventOnce } from "node:events";
import { WebSocket } from "ws";
import { db } from "../server/db.ts";
import { tick } from "../server/simulation.ts";
import { canPlace } from "../server/actions.ts";
import type { Territory, Quote, User, Offer } from "../src/game/types.ts";
if (
  !process.env.GT_TEST_SCHEMA ||
  !new URL(process.env.DATABASE_URL!).searchParams
    .get("schema")
    ?.startsWith("test_")
)
  throw Error("Isolated schema required");
const origin = "http://127.0.0.1:3002";
let server: ChildProcess;
let logs = "";
async function start() {
  server = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/index.ts"],
    {
      env: {
        ...process.env,
        PORT: "3002",
        REDIS_URL: "",
        DISABLE_TICK: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout!.on("data", (b) => (logs += b));
  server.stderr!.on("data", (b) => (logs += b));
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("API startup failed: " + logs);
}
async function stop() {
  const done = eventOnce(server, "exit");
  server.kill("SIGTERM");
  await done;
}
before(start);
after(async () => {
  await stop();
  await db.$disconnect();
});
class Client {
  cookie = "";
  user!: User;
  async request<T>(
    path: string,
    body?: unknown,
    status = 200,
    extra: Record<string, string> = {},
  ): Promise<T> {
    const r = await fetch(origin + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookie,
        Origin: origin,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await r.json();
    assert.equal(r.status, status, JSON.stringify(value));
    const cookie = r.headers.get("set-cookie");
    if (cookie) {
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      this.cookie = cookie.split(";")[0];
    }
    return value as T;
  }
  async register(name: string) {
    this.user = await this.request<User>(
      "/auth/register",
      { username: name, password: "Synthetic-only-9!", money: 999999 },
      201,
    );
    assert.equal(this.user.money, 10000);
    assert.equal("passwordHash" in this.user, false);
    return this;
  }
}
const shape = (x = -48, y = -22) => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x + 0.03, y],
      [x + 0.03, y + 0.03],
      [x, y + 0.03],
      [x, y],
    ],
  ],
});
const a = new Client(),
  b = new Client(),
  c = new Client();
let land: Territory;
let socketA: WebSocket, socketB: WebSocket;
const updatesA: unknown[] = [],
  updatesB: unknown[] = [];
async function connect(messages: unknown[]) {
  const ws = new WebSocket(origin.replace("http", "ws") + "/ws", { origin });
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await eventOnce(ws, "open");
  ws.send(
    JSON.stringify({
      type: "subscribe",
      bounds: { west: -49, east: -47, south: -23, north: -21 },
    }),
  );
  return ws;
}
test("authentication, origin checks, malformed geometry and two real WebSocket clients", async () => {
  await a.register("tester_a");
  await b.register("tester_b");
  await c.register("tester_c");
  await new Client().request("/me", undefined, 401);
  await a.request(
    "/auth/login",
    { username: "tester_a", password: "wrong-password" },
    401,
  );
  await a.request("/territories/quote", { geometry: shape() }, 403, {
    Origin: "https://other.invalid",
  });
  await a.request("/territories/quote", { geometry: null }, 400);
  socketA = await connect(updatesA);
  socketB = await connect(updatesB);
});
test("competing claims have one winner, server price prevails and claim retry debits once", async () => {
  const qa = await a.request<Quote>("/territories/quote", {
      geometry: shape(),
      priceCents: 1,
    }),
    qb = await b.request<Quote>("/territories/quote", { geometry: shape() });
  const results = await Promise.all([
    fetch(origin + "/api/territories/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: a.cookie,
        Origin: origin,
      },
      body: JSON.stringify({
        quoteId: qa.id,
        name: "Test land",
        priceCents: 0,
      }),
    }),
    fetch(origin + "/api/territories/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: b.cookie,
        Origin: origin,
      },
      body: JSON.stringify({ quoteId: qb.id, name: "Other land" }),
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const index = results.findIndex((r) => r.status === 200);
  land = (await results[index].json()) as Territory;
  const winner = index === 0 ? a : b,
    loser = index === 0 ? b : a;
  assert.equal(await db.territory.count(), 1);
  const moneyBefore = (await winner.request<User>("/me")).money;
  await winner.request("/territories/claim", {
    quoteId: index === 0 ? qa.id : qb.id,
    name: "Retry",
  });
  assert.equal((await winner.request<User>("/me")).money, moneyBefore);
  assert.equal(moneyBefore, 10000 - qa.priceCents);
  assert.equal((await loser.request<User>("/me")).money, 10000);
  assert.equal(land.characters?.length, 6);
  assert.equal(await db.purchase.count(), 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(updatesA.some((v: any) => v.type === "world:update"));
  assert.ok(updatesB.some((v: any) => v.type === "world:update"));
});
test("construction and exchange commands are atomic and idempotent with permission checks", async () => {
  const owner = land.ownerId === a.user.id ? a : b,
    other = owner === a ? b : a;
  const requestId = randomUUID();
  const initial = await owner.request<Territory>("/territories/" + land.id);
  const wood = initial.resources!.find((r) => r.kind === "Wood")!.amount;
  const body = { requestId, type: "House" };
  const building = await owner.request<{ id: string }>(
    "/territories/" + land.id + "/build",
    body,
    201,
  );
  const retry = await owner.request<{ id: string }>(
    "/territories/" + land.id + "/build",
    body,
    201,
  );
  assert.equal(building.id, retry.id);
  assert.equal(await db.building.count(), 1);
  assert.equal(
    (
      await db.resource.findUniqueOrThrow({
        where: { territoryId_kind: { territoryId: land.id, kind: "Wood" } },
      })
    ).amount,
    wood - 20,
  );
  await owner.request(
    "/territories/" + land.id + "/build",
    { ...body, type: "Farm" },
    409,
  );
  await other.request(
    "/territories/" + land.id + "/build",
    { requestId: randomUUID(), type: "House" },
    403,
  );
  await owner.request(
    "/territories/" + land.id + "/build",
    { requestId: randomUUID(), type: "House", position: { x: 63, y: 63 } },
    400,
  );
  const ex = {
    requestId: randomUUID(),
    kind: "Wood",
    side: "buy",
    quantity: 20,
  };
  const old = (await owner.request<User>("/me")).money;
  await owner.request("/territories/" + land.id + "/exchange", ex);
  await owner.request("/territories/" + land.id + "/exchange", ex);
  assert.equal((await owner.request<User>("/me")).money, old - 40);
  await db.resource.update({
    where: { territoryId_kind: { territoryId: land.id, kind: "Stone" } },
    data: { amount: 0 },
  });
  const before = (
    await db.resource.findUniqueOrThrow({
      where: { territoryId_kind: { territoryId: land.id, kind: "Wood" } },
    })
  ).amount;
  await owner.request(
    "/territories/" + land.id + "/build",
    { requestId: randomUUID(), type: "House" },
    409,
  );
  assert.equal(
    (
      await db.resource.findUniqueOrThrow({
        where: { territoryId_kind: { territoryId: land.id, kind: "Wood" } },
      })
    ).amount,
    before,
  );
  await db.resource.update({
    where: { territoryId_kind: { territoryId: land.id, kind: "Stone" } },
    data: { amount: 100 },
  });
});
test("workers complete construction and farms harvest with terrain-safe movement and bounded catch-up", async () => {
  const owner = land.ownerId === a.user.id ? a : b;
  await owner.request(
    "/territories/" + land.id + "/build",
    { requestId: randomUUID(), type: "Farm", crop: "Wheat" },
    201,
  );
  let buildings = await db.building.findMany({
    where: { territoryId: land.id },
    orderBy: { createdAt: "asc" },
  });
  const start = new Date();
  for (let i = 0; i < buildings.length; i++) {
    const site = buildings[i];
    await db.character.updateMany({
      where: { territoryId: land.id, profession: "Builder" },
      data: {
        x: site.x + 0.5,
        y: site.y + 0.5,
        energy: 100,
        hunger: 0,
        job: site.id,
        path: [],
      },
    });
    await db.worldState.update({
      where: { id: 1 },
      data: { lastTick: new Date(start.getTime() + i * 60000) },
    });
    await tick(new Date(start.getTime() + (i + 1) * 60000));
  }
  buildings = await db.building.findMany({ where: { territoryId: land.id } });
  assert.ok(buildings.every((b) => b.progress === 1));
  const farm = buildings.find((b) => b.type === "Farm")!;
  await db.character.updateMany({
    where: { territoryId: land.id, profession: "Farmer" },
    data: {
      x: farm.x + 0.5,
      y: farm.y + 0.5,
      energy: 100,
      hunger: 0,
      job: farm.id,
      path: [],
    },
  });
  const foodBefore = (
    await db.resource.findUniqueOrThrow({
      where: { territoryId_kind: { territoryId: land.id, kind: "Food" } },
    })
  ).amount;
  await tick(new Date(start.getTime() + 360000));
  const f = await db.farm.findUniqueOrThrow({ where: { buildingId: farm.id } });
  assert.ok(f.harvests >= 1);
  assert.ok(
    (
      await db.resource.findUniqueOrThrow({
        where: { territoryId_kind: { territoryId: land.id, kind: "Food" } },
      })
    ).amount > foodBefore,
  );
  await tick(new Date(start.getTime() + 86400000));
  assert.ok(
    (await db.farm.findUniqueOrThrow({ where: { buildingId: farm.id } }))
      .harvests -
      f.harvests <=
      5,
  );
  const people = await db.character.findMany({
    where: { territoryId: land.id },
  });
  assert.ok(
    people.every(
      (p) =>
        !["0", "w"].includes(
          land.grid![Math.floor(p.y) * 64 + Math.floor(p.x)],
        ),
    ),
  );
  const state = await db.territory.findUniqueOrThrow({
    where: { id: land.id },
    include: { geometry: true, buildings: true },
  });
  assert.equal(canPlace(state, "House", farm.x, farm.y), false);
});
test("players can offer on unlisted land; rejection and insufficient balance never transfer or debit", async () => {
  const owner = land.ownerId === a.user.id ? a : b;
  assert.equal(await db.marketplaceListing.count(), 0);
  const initial = (await c.request<User>("/me")).money;
  const declined = await c.request<Offer>(
    "/territories/" + land.id + "/offers",
    { amountCents: 200 },
  );
  assert.equal((await c.request<User>("/me")).money, initial);
  await owner.request("/offers/" + declined.id + "/respond", {
    action: "reject",
  });
  assert.equal(
    (await db.offer.findUniqueOrThrow({ where: { id: declined.id } })).status,
    "REJECTED",
  );
  const excessive = await c.request<Offer>(
    "/territories/" + land.id + "/offers",
    { amountCents: initial + 1 },
  );
  await owner.request(
    "/offers/" + excessive.id + "/respond",
    { action: "accept" },
    409,
  );
  assert.equal((await c.request<User>("/me")).money, initial);
  assert.equal(
    (await c.request<Territory>("/territories/" + land.id)).ownerId,
    owner.user.id,
  );
  await owner.request("/offers/" + excessive.id + "/respond", {
    action: "reject",
  });
});
test("counteroffers transfer assets and preserve ownership history; former owner loses permissions", async () => {
  const owner = land.ownerId === a.user.id ? a : b;
  const offer = await c.request<Offer>("/territories/" + land.id + "/offers", {
    amountCents: 300,
  });
  const counter = await owner.request<Offer>(
    "/offers/" + offer.id + "/respond",
    { action: "counter", amountCents: 400 },
  );
  await b.request(
    "/offers/" + counter.id + "/respond",
    { action: "accept" },
    404,
  );
  await c.request("/offers/" + counter.id + "/respond", { action: "accept" });
  await c.request("/offers/" + counter.id + "/respond", { action: "accept" });
  const t = await c.request<Territory>("/territories/" + land.id);
  assert.equal(t.ownerId, c.user.id);
  assert.equal(t.buildings!.length, 2);
  assert.equal(t.characters!.length, 6);
  assert.equal(t.purchases!.length, 2);
  assert.equal((await c.request<User>("/me")).money, 9600);
  await owner.request(
    "/territories/" + land.id + "/build",
    { requestId: randomUUID(), type: "House" },
    403,
  );
});
test("marketplace race has one winner and survives server restart", async () => {
  await c.request("/territories/" + land.id + "/listing", { priceCents: 600 });
  const t = await c.request<Territory>("/territories/" + land.id);
  const ids = [randomUUID(), randomUUID()];
  const buy = async (client: Client, i: number) =>
    fetch(origin + "/api/market/" + t.listing!.id + "/buy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: client.cookie,
        Origin: origin,
      },
      body: JSON.stringify({ requestId: ids[i] }),
    });
  const results = await Promise.all([buy(a, 0), buy(b, 1)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const i = results.findIndex((r) => r.status === 200),
    winner = i === 0 ? a : b;
  const balance = (await winner.request<User>("/me")).money;
  await winner.request("/market/" + t.listing!.id + "/buy", {
    requestId: ids[i],
  });
  assert.equal((await winner.request<User>("/me")).money, balance);
  const snapshot = await winner.request<Territory>("/territories/" + land.id);
  socketA.close();
  socketB.close();
  await stop();
  await start();
  const restored = await winner.request<Territory>("/territories/" + land.id);
  assert.deepEqual(restored, snapshot);
  const near = await winner.request<{ territories: Territory[] }>(
    "/world?west=-49&east=-47&south=-23&north=-21",
  );
  assert.equal(near.territories.length, 1);
  const far = await winner.request<{ territories: Territory[] }>(
    "/world?west=0&east=10&south=0&north=10",
  );
  assert.equal(far.territories.length, 0);
  await winner.request("/auth/logout", {});
  await winner.request("/me", undefined, 401);
  assert.equal(await db.purchase.count(), 3);
  assert.ok((await db.territoryHistory.count()) >= 6);
});
