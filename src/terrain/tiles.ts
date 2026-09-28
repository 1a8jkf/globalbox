import { terrainRequests } from "./selection.ts";
import type { Map as MapType } from "maplibre-gl";
import { BudgetCache } from "../streaming/cache.ts";
import { mercatorInverse, tileId, type TileKey } from "./geography.ts";
interface Reply {
  id: number;
  key: TileKey;
  bitmap?: ImageBitmap;
  data?: ArrayBuffer;
  error?: string;
  ms: number;
}
interface Job {
  id: number;
  key: TileKey;
  format: "bitmap" | "png";
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
}
/** One active job, camera-priority queue, bounded cache, explicit bitmap disposal. */
export class TerrainTiles {
  readonly cache = new BudgetCache<{
    key: TileKey;
    bitmap: ImageBitmap;
    bytes: number;
  }>(64 * 1024 * 1024, (t) => t.bitmap.close());
  readonly metrics = {
    generated: 0,
    dropped: 0,
    lastGenerationMs: 0,
    failures: 0,
  };
  private worker: Worker;
  private queue: Job[] = [];
  private active?: Job;
  private next = 1;
  private wanted = new Map<string, TileKey>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private signature = "";
  private level = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private changed: () => void;
  constructor(changed: () => void = () => {}) {
    this.changed = changed;
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data,
        job = this.active;
      if (!job || job.id !== r.id) {
        r.bitmap?.close();
        return;
      }
      clearTimeout(this.timer);
      this.active = undefined;
      if (r.error) {
        this.metrics.failures++;
        job.reject(Error(r.error));
      } else {
        this.metrics.generated++;
        this.metrics.lastGenerationMs = r.ms;
        job.resolve(r);
      }
      this.pump();
    };
    this.worker.onerror = (e) =>
      this.fail(Error(e.message || "Terrain worker failed"));
  }
  private fail(error: Error) {
    clearTimeout(this.timer);
    this.metrics.failures++;
    this.active?.reject(error);
    this.active = undefined;
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    this.worker.terminate();
    this.disposed = true;
  }
  private pump() {
    if (this.active || this.disposed) return;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      if (job.signal?.aborted) {
        job.reject(new DOMException("Cancelled", "AbortError"));
        continue;
      }
      this.active = job;
      this.timer = setTimeout(
        () => this.fail(Error("Terrain generation timeout")),
        30000,
      );
      this.worker.postMessage({ id: job.id, key: job.key, format: job.format });
      break;
    }
  }
  private request(
    key: TileKey,
    format: "bitmap" | "png",
    signal?: AbortSignal,
  ): Promise<Reply> {
    if (this.disposed)
      return Promise.reject(Error("Terrain renderer unavailable"));
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.next++,
        key,
        format,
        signal,
        resolve,
        reject,
      });
      this.pump();
    });
  }
  async png(key: TileKey, signal: AbortSignal) {
    const result = await this.request(key, "png", signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return result.data!;
  }
  private setView(m: MapType) {
    const b = m.getBounds();
    const plan = terrainRequests({
      zoom: m.getZoom(),
      west: b.getWest(),
      east: b.getEast(),
      north: b.getNorth(),
      south: b.getSouth(),
    });
    const signature = plan.keys.map(tileId).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    this.level = plan.level;
    const keys = new Map(plan.keys.map((key) => [tileId(key), key]));
    this.wanted = keys;
    const keep: Job[] = [];
    for (const job of this.queue) {
      if (keys.has(tileId(job.key))) keep.push(job);
      else job.reject(new DOMException("Camera moved", "AbortError"));
    }
    this.queue = keep;
    this.cache.pinned.clear();
    // Protect the entire <=60-tile working set, including fallback parents.
    // Drawing an old cached tile must not evict a parent still being requested.
    for (const id of keys.keys()) this.cache.pinned.add(id);
    for (const [id, key] of keys) {
      if (this.cache.peek(id) || this.pending.has(id) || this.failed.has(id))
        continue;
      this.pending.add(id);
      void this.request(key, "bitmap")
        .then((r) => {
          if (!this.wanted.has(id) || this.disposed) {
            r.bitmap!.close();
            this.metrics.dropped++;
            return;
          }
          this.cache.set(id, { key, bitmap: r.bitmap!, bytes: 512 * 512 * 4 });
          this.changed();
        })
        .catch((e) => {
          if (e.name !== "AbortError") {
            this.failed.add(id);
            console.error(e);
          }
        })
        .finally(() => {
          this.pending.delete(id);
          this.signature = "";
        });
    }
  }
  draw(c: CanvasRenderingContext2D, m: MapType) {
    this.setView(m);
    const w = c.canvas.clientWidth || c.canvas.width,
      h = c.canvas.clientHeight || c.canvas.height;
    for (const [id, t] of [...this.cache.entries].sort(
      (a, b) => a[1].key.z - b[1].key.z,
    )) {
      const { z, x, y } = t.key,
        n = 2 ** z;
      const a = m.project(mercatorInverse(x / n, y / n)),
        b = m.project(mercatorInverse((x + 1) / n, (y + 1) / n));
      if (b.x < 0 || a.x > w || b.y < 0 || a.y > h) continue;
      // Never draw obsolete finer LOD over a newly zoomed-out view.
      if (z > this.level) continue;
      this.cache.get(id);
      const left = Math.round(a.x),
        top = Math.round(a.y);
      c.drawImage(
        t.bitmap,
        left,
        top,
        Math.round(b.x) - left,
        Math.round(b.y) - top,
      );
    }
  }
  dispose() {
    const error = new DOMException("Terrain renderer disposed", "AbortError");
    clearTimeout(this.timer);
    this.disposed = true;
    this.active?.reject(error);
    this.active = undefined;
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    this.worker.terminate();
    this.cache.clear();
  }
}
