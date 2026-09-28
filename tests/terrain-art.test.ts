import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { renderSurface } from "../src/terrain/surface.ts";
import {
  prepareVectors,
  rasterRegion,
  mercatorPoint,
  mercatorInverse,
} from "../src/terrain/geography.ts";
import { Biome, Terrain, type Region } from "../src/world/types.ts";
Object.defineProperty(globalThis, "Path2D", {
  value: Path2D,
  configurable: true,
});
Object.defineProperty(globalThis, "OffscreenCanvas", {
  value: class {
    constructor(w: number, h: number) {
      return createCanvas(w, h);
    }
  },
  configurable: true,
});
function region(ox = -32, oy = -32, biome: number = Biome.Tropical): Region {
  const width = 320,
    r: Region = {
      width,
      height: width,
      originX: ox,
      originY: oy,
      step: 1,
      seed: 271828,
      terrain: new Uint8Array(width * width),
      biomes: new Uint8Array(width * width).fill(biome),
      elevation: new Float32Array(width * width).fill(
        biome === Biome.Mountain ? 0.8 : 0.1,
      ),
      moisture: new Float32Array(width * width).fill(0.7),
      coastDistance: new Uint16Array(width * width),
    };
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++)
      r.terrain[y * width + x] =
        x + ox > 150 + Math.sin((y + oy) / 40) * 10
          ? Terrain.Land
          : Terrain.Ocean;
  return r;
}
test("terrain art is deterministic, non-mutating, opaque and varied in every biome and ocean", () => {
  const signatures = new Set<string>();
  for (let biome = 0; biome <= 9; biome++) {
    const r = region(-32, -32, biome);
    if (biome === 0) r.terrain.fill(Terrain.Ocean);
    const original = structuredClone(r),
      a = renderSurface(r, { detail: 3 }),
      b = renderSurface(r, { detail: 3 });
    assert.deepEqual(a, b);
    assert.deepEqual(r, original);
    const colors = new Set<number>();
    for (let i = 0; i < a.length; i += 4) {
      assert.equal(a[i + 3], 255);
      colors.add(a[i] * 65536 + a[i + 1] * 256 + a[i + 2]);
    }
    assert.ok(
      colors.size >= (biome === 0 ? 4 : 7),
      `biome ${biome} reveals clusters and depth`,
    );
    signatures.add([...colors].sort().join(","));
  }
  assert.equal(signatures.size, 10);
});
test("terrain clusters and water depth agree across overlapping tile windows", () => {
  const a = renderSurface(region(-32, -32), { detail: 3 }),
    b = renderSurface(region(96, -32), { detail: 3 });
  // Shift 128 geographic cells / 256 visual pixels: the shared 128-cell strip must match exactly.
  for (let y = 0; y < 512; y++)
    assert.deepEqual(
      a.slice((y * 512 + 256) * 4, (y * 512 + 512) * 4),
      b.slice(y * 512 * 4, (y * 512 + 256) * 4),
    );
  assert.notDeepEqual(
    renderSurface(region(), { detail: 0 }),
    renderSurface(region(), { detail: 3 }),
  );
});
test("Natural Earth Mercator masks preserve land, inland water and tile gutters", () => {
  const vectors = {
    land: prepareVectors(
      JSON.parse(readFileSync("data/geography/land.json", "utf8")),
    ),
    lakes: prepareVectors(
      JSON.parse(readFileSync("data/geography/lakes.json", "utf8")),
    ),
    rivers: prepareVectors(
      JSON.parse(
        readFileSync("data/geography/rivers_lake_centerlines.json", "utf8"),
      ),
    ),
  };
  for (const [lon, lat, land] of [
    [-63, -5, true],
    [-45, -20, true],
    [15, 25, true],
    [85, 29, true],
    [133, -25, true],
    [0, -78, true],
    [-25, -20, false],
  ] as const) {
    const p = mercatorPoint(lon, lat),
      n = 16,
      key = { z: 4, x: Math.floor(p[0] * n), y: Math.floor(p[1] * n) },
      r = rasterRegion(key, vectors),
      x = Math.floor(p[0] * n * 256) - key.x * 256 + 32,
      y = Math.floor(p[1] * n * 256) - key.y * 256 + 32;
    assert.equal(
      r.terrain[y * 320 + x] === Terrain.Land,
      land,
      `${lon},${lat}`,
    );
    const ll = mercatorInverse(...p);
    assert.ok(Math.abs(ll[0] - lon) < 1e-8 && Math.abs(ll[1] - lat) < 1e-8);
  }
  const a = rasterRegion({ z: 4, x: 5, y: 8 }, vectors),
    b = rasterRegion({ z: 4, x: 6, y: 8 }, vectors);
  for (let y = 0; y < 320; y++)
    for (let x = 0; x < 64; x++)
      assert.equal(a.terrain[y * 320 + 256 + x], b.terrain[y * 320 + x]);
});

test("deep-zoom requests fit the bitmap cache including ancestors and retain global coverage", async () => {
  const { terrainRequests } = await import("../src/terrain/selection.ts");
  for (const zoom of [0, 2, 4, 8, 12, 19])
    for (const aspect of [1, 4, 10]) {
      const span = 180 / 2 ** zoom;
      const plan = terrainRequests({
        zoom,
        west: -60 - span * aspect,
        east: -60 + span * aspect,
        north: span,
        south: -span,
      });
      assert.ok(plan.keys.length <= 60);
      assert.ok(plan.visible.length <= 40);
      assert.deepEqual(plan.keys[0], { z: 0, x: 0, y: 0 });
      const seen = new Set(plan.keys.map((k) => `${k.z}/${k.x}/${k.y}`));
      for (const key of plan.visible)
        assert.ok(seen.has(`${key.z}/${key.x}/${key.y}`));
    }
});

test("terrain worker queue drops obsolete camera replies, aborts requests and releases images", async () => {
  const { TerrainTiles } = await import("../src/terrain/tiles.ts");
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let worker: FakeWorker;
  class FakeWorker {
    onmessage?: (e: { data: unknown }) => void;
    onerror?: (e: { message: string }) => void;
    sent: {
      id: number;
      key: { z: number; x: number; y: number };
      format: string;
    }[] = [];
    terminated = false;
    constructor() {
      worker = this;
    }
    postMessage(job: (typeof this.sent)[number]) {
      this.sent.push(job);
    }
    terminate() {
      this.terminated = true;
    }
    reply(bitmap: { close(): void }) {
      const job = this.sent.at(-1)!;
      this.onmessage?.({ data: { ...job, bitmap, ms: 1 } });
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    value: FakeWorker,
    configurable: true,
  });
  let closed = 0;
  const bitmap = () => ({
    close() {
      closed++;
    },
  });
  const tiles = new TerrainTiles();
  const bounds = { west: -62, east: -60, north: -4, south: -6 };
  const map = {
    getZoom: () => 8,
    getBounds: () => ({
      getWest: () => bounds.west,
      getEast: () => bounds.east,
      getNorth: () => bounds.north,
      getSouth: () => bounds.south,
    }),
    project: () => ({ x: 0, y: 0 }),
  };
  const ctx = { canvas: { width: 800, height: 600 }, drawImage() {} };
  const draw = () =>
    tiles.draw(
      ctx as unknown as CanvasRenderingContext2D,
      map as unknown as Parameters<typeof tiles.draw>[1],
    );
  const flush = () => new Promise((r) => setImmediate(r));
  try {
    draw();
    const { terrainRequests } = await import("../src/terrain/selection.ts");
    const required = terrainRequests({ zoom: 8, ...bounds }).keys.map(
      (k) => `${k.z}/${k.x}/${k.y}`,
    );
    assert.deepEqual(
      [...tiles.cache.pinned],
      required,
      "protect parents as well as visible tiles from cache churn",
    );
    assert.equal(worker!.sent.length, 1);
    worker!.reply(bitmap());
    await flush(); // overview is retained
    const stale = worker!.sent.at(-1)!;
    bounds.west = 120;
    bounds.east = 122;
    draw();
    worker!.reply(bitmap());
    await flush();
    assert.equal(tiles.metrics.dropped, 1);
    assert.equal(closed, 1);
    assert.equal(tiles.cache.entries.size, 1);
    assert.notDeepEqual(worker!.sent.at(-1)!.key, stale.key);
    const controller = new AbortController();
    controller.abort();
    const png = tiles.png({ z: 1, x: 0, y: 0 }, controller.signal);
    const rejected = assert.rejects(png, { name: "AbortError" });
    tiles.dispose();
    await rejected;
    await flush();
    assert.equal(worker!.terminated, true);
    assert.equal(tiles.cache.bytes, 0);
    assert.equal(closed, 2);
    assert.equal(tiles.metrics.failures, 0);
    // A late transferable arriving after teardown must be closed too.
    worker!.reply(bitmap());
    assert.equal(closed, 3);
  } finally {
    tiles.dispose();
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
});

test("atlas detail stays consistent when the camera crosses tile boundaries", async () => {
  const { desiredLevel, selectRequests, visibleKeys } =
    await import("../src/streaming/selection.ts");
  const { keyOf } = await import("../src/world/config.ts");
  for (const zoom of [1, 2, 4, 8]) {
    const levels = new Set<number>();
    for (let x = 0; x < 1800; x += 113) {
      const view = {
        x: -x,
        y: -700,
        width: 1440,
        height: 900,
        scale: (1440 / 16384) * 0.98 * zoom,
      };
      const level = desiredLevel(view);
      levels.add(level);
      const selected = new Set(
        selectRequests(view, level).slice(0, 64).map(keyOf),
      );
      for (const key of visibleKeys(view, level))
        assert.ok(selected.has(keyOf(key)));
    }
    assert.equal(levels.size, 1, `consistent ${zoom}x LOD`);
  }
});
