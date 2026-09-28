import { TerrainTiles } from "../terrain/tiles.ts";
/** Geographic Canvas fallback for devices without WebGL2. Same camera/interaction contract. */
import { booleanPointInPolygon, point } from "@turf/turf";
import type {
  FeatureCollection,
  Feature,
  Polygon,
  MultiPolygon,
} from "geojson";
import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
type XY = { x: number; y: number };
type Handler = (event: any) => void;
const merc = (lng: number, lat: number): [number, number] => [
  (lng + 180) / 360,
  (1 -
    Math.log(
      Math.tan(
        Math.PI / 4 +
          (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 360,
      ),
    ) /
      Math.PI) /
    2,
];
const inverse = (x: number, y: number): [number, number] => [
  x * 360 - 180,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
];
class CanvasMap {
  canvas: HTMLCanvasElement;
  center: [number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
  frame = 0;
  disposed = false;
  pan = true;
  loaded = false;
  image = new Image();
  flat: HTMLCanvasElement | null = null;
  terrainVisible = true;
  terrainTiles: TerrainTiles;
  sources = new Map<
    string,
    {
      data: FeatureCollection | Feature;
      setData: (d: FeatureCollection | Feature) => void;
    }
  >();
  layers = new Map<string, any>();
  events = new Map<string, Set<Handler>>();
  pointers = new Map<number, XY>();
  dragStart: XY | null = null;
  lastPinch = 0;
  dragged = false;
  cleanup: (() => void)[] = [];
  dragPan = {
    enable: () => {
      this.pan = true;
    },
    disable: () => {
      this.pan = false;
    },
  };
  touchZoomRotate = { disableRotation: () => {} };
  constructor(options: MapOptions) {
    const host = options.container as HTMLElement;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "maplibregl-canvas canvas-fallback";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Mapa mundial interativo");
    host.append(this.canvas);
    this.center = (options.center as [number, number]) ?? [0, 0];
    this.zoom = options.zoom ?? 1.7;
    this.minZoom = options.minZoom ?? 1;
    this.maxZoom = options.maxZoom ?? 19;
    this.terrainTiles = new TerrainTiles(() => this.draw());
    this.resize();
    const listen = (type: string, handler: EventListener) => {
      this.canvas.addEventListener(type, handler, { passive: false });
      this.cleanup.push(() => this.canvas.removeEventListener(type, handler));
    };
    listen("wheel", ((e: WheelEvent) => {
      e.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.zoomAt(this.zoom - e.deltaY * 0.002, { x: e.offsetX, y: e.offsetY });
    }) as EventListener);
    listen("pointerdown", ((e: PointerEvent) => {
      if (!this.pan) return;
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.dragStart = { x: e.offsetX, y: e.offsetY };
      this.dragged = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }) as EventListener);
    listen("pointermove", ((e: PointerEvent) => {
      const old = this.pointers.get(e.pointerId);
      if (!old || !this.pan) return;
      const pos = { x: e.offsetX, y: e.offsetY };
      this.pointers.set(e.pointerId, pos);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()],
          d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.lastPinch > 0 && d > 0)
          this.zoomAt(
            this.zoom + Math.log2(d / this.lastPinch),
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            false,
          );
        this.lastPinch = d;
        this.dragged = true;
      } else {
        const [cx, cy] = merc(...this.center),
          size = 512 * 2 ** this.zoom;
        this.center = inverse(
          cx - (pos.x - old.x) / size,
          cy - (pos.y - old.y) / size,
        );
        this.clamp();
        if (
          this.dragStart &&
          Math.hypot(pos.x - this.dragStart.x, pos.y - this.dragStart.y) > 3
        )
          this.dragged = true;
        this.draw();
      }
    }) as EventListener);
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      this.lastPinch = 0;
      this.emit("moveend");
    };
    listen("pointerup", end as EventListener);
    listen("pointercancel", end as EventListener);
    listen("click", ((e: MouseEvent) => {
      if (!this.dragged) {
        const p = { x: e.offsetX, y: e.offsetY };
        this.emit("click", { point: p, lngLat: this.unproject(p) });
      }
    }) as EventListener);
    listen("keydown", ((e: KeyboardEvent) => {
      if (!this.pan) return;
      const delta = 60 / (512 * 2 ** this.zoom);
      const [cx, cy] = merc(...this.center);
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        this.center = inverse(
          cx +
            (e.key === "ArrowRight"
              ? delta
              : e.key === "ArrowLeft"
                ? -delta
                : 0),
          cy +
            (e.key === "ArrowDown" ? delta : e.key === "ArrowUp" ? -delta : 0),
        );
        this.clamp();
        this.draw();
        this.emit("moveend");
      } else if (e.key === "+" || e.key === "=") this.zoomIn();
      else if (e.key === "-") this.zoomOut();
    }) as EventListener);
    this.image.onload = () => {
      if (this.disposed) return;
      this.loaded = true;
      this.flat = document.createElement("canvas");
      this.flat.width = this.image.width;
      this.flat.height = this.image.height;
      const c = this.flat.getContext("2d")!;
      c.drawImage(this.image, 0, 0);
      const pixels = c.getImageData(0, 0, this.flat.width, this.flat.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 2] < pixels.data[i] * 1.2) {
          pixels.data[i] = 166;
          pixels.data[i + 1] = 183;
          pixels.data[i + 2] = 138;
        }
      }
      c.putImageData(pixels, 0, 0);
      this.draw();
      this.emit("load");
    };
    this.image.onerror = () =>
      this.emit("error", {
        error: new Error("Não foi possível carregar a geografia local."),
      });
    this.image.src = "/map/earth.png";
  }
  emit(type: string, event: any = {}) {
    for (const handler of this.events.get(type) ?? []) handler(event);
  }
  on(type: string, handler: Handler) {
    if (!this.events.has(type)) this.events.set(type, new Set());
    this.events.get(type)!.add(handler);
    return this;
  }
  once(type: string, handler: Handler) {
    const once: Handler = (e) => {
      this.events.get(type)?.delete(once);
      handler(e);
    };
    return this.on(type, once);
  }
  project(input: [number, number] | { lng: number; lat: number }): XY {
    const lonlat = Array.isArray(input) ? input : [input.lng, input.lat];
    const [x, y] = merc(lonlat[0], lonlat[1]),
      [cx, cy] = merc(...this.center),
      size = 512 * 2 ** this.zoom;
    return {
      x: (x - cx) * size + this.canvas.clientWidth / 2,
      y: (y - cy) * size + this.canvas.clientHeight / 2,
    };
  }
  unproject(input: [number, number] | XY) {
    const p = Array.isArray(input) ? { x: input[0], y: input[1] } : input,
      [cx, cy] = merc(...this.center),
      size = 512 * 2 ** this.zoom;
    const [lng, lat] = inverse(
      cx + (p.x - this.canvas.clientWidth / 2) / size,
      cy + (p.y - this.canvas.clientHeight / 2) / size,
    );
    return { lng, lat, toArray: () => [lng, lat] as [number, number] };
  }
  clamp() {
    this.center = [
      Math.max(-180, Math.min(180, this.center[0])),
      Math.max(-85, Math.min(85, this.center[1])),
    ];
  }
  zoomAt(value: number, p: XY, notify = true) {
    const fixed = this.unproject(p);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, value));
    const after = this.unproject(p),
      [fx, fy] = merc(fixed.lng, fixed.lat),
      [ax, ay] = merc(after.lng, after.lat),
      [cx, cy] = merc(...this.center);
    this.center = inverse(cx + fx - ax, cy + fy - ay);
    this.clamp();
    this.draw();
    this.emit("zoom");
    if (notify) this.emit("moveend");
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return {
      lng: this.center[0],
      lat: this.center[1],
      toArray: () => this.center,
    };
  }
  getCanvas() {
    return this.canvas;
  }
  getBounds() {
    const a = this.unproject([0, 0]),
      b = this.unproject([this.canvas.clientWidth, this.canvas.clientHeight]);
    return {
      getWest: () => Math.max(-180, a.lng),
      getEast: () => Math.min(180, b.lng),
      getNorth: () => a.lat,
      getSouth: () => b.lat,
    };
  }
  flyTo(options: {
    center?: [number, number];
    zoom?: number;
    duration?: number;
  }) {
    cancelAnimationFrame(this.frame);
    const from = merc(...this.center),
      to = merc(...(options.center ?? this.center)),
      z = this.zoom,
      target = options.zoom ?? z,
      duration = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : (options.duration ?? 600),
      start = performance.now();
    const frame = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1,
        e = t * t * (3 - 2 * t);
      this.center = inverse(
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
      );
      this.zoom = z + (target - z) * e;
      this.clamp();
      this.draw();
      this.emit("zoom");
      if (t < 1) this.frame = requestAnimationFrame(frame);
      else this.emit("moveend");
    };
    this.frame = requestAnimationFrame(frame);
    return this;
  }
  jumpTo(options: { center?: [number, number]; zoom?: number }) {
    return this.flyTo({ ...options, duration: 0 });
  }
  zoomIn() {
    this.zoomAt(this.zoom + 1, {
      x: this.canvas.clientWidth / 2,
      y: this.canvas.clientHeight / 2,
    });
  }
  zoomOut() {
    this.zoomAt(this.zoom - 1, {
      x: this.canvas.clientWidth / 2,
      y: this.canvas.clientHeight / 2,
    });
  }
  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.style.width = parent.clientWidth + "px";
    this.canvas.style.height = parent.clientHeight + "px";
    this.canvas.style.touchAction = "none";
    this.canvas.width = parent.clientWidth * dpr;
    this.canvas.height = parent.clientHeight * dpr;
    this.draw();
  }
  addSource(id: string, source: { data: FeatureCollection | Feature }) {
    const entry = {
      data: source.data,
      setData: (data: FeatureCollection | Feature) => {
        entry.data = data;
        this.draw();
      },
    };
    this.sources.set(id, entry);
    return this;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: any) {
    this.layers.set(layer.id, layer);
    this.draw();
    return this;
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  setLayoutProperty(id: string, key: string, value: string) {
    if (id === "earth") this.terrainVisible = value !== "none";
    const layer = this.layers.get(id);
    if (layer) {
      layer.layout ??= {};
      layer.layout[key] = value;
    }
    this.draw();
  }
  queryRenderedFeatures(p: XY) {
    const g = this.unproject(p),
      data = this.sources.get("territories")?.data;
    if (data?.type !== "FeatureCollection") return [];
    return data.features.filter(
      (f) =>
        (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") &&
        booleanPointInPolygon(
          point([g.lng, g.lat]),
          f as Feature<Polygon | MultiPolygon>,
        ),
    );
  }
  draw() {
    const c = this.canvas.getContext("2d");
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2),
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#85b7bd";
    c.fillRect(0, 0, w, h);
    c.imageSmoothingEnabled = false;
    const a = this.project([-180, 85.05112878]),
      size = 512 * 2 ** this.zoom;
    if (this.loaded)
      c.drawImage(
        this.terrainVisible ? this.image : (this.flat ?? this.image),
        a.x,
        a.y,
        size,
        size,
      );
    if (this.terrainVisible)
      this.terrainTiles.draw(c, this as unknown as MapLibreMap);
    for (const layer of this.layers.values()) {
      if (layer.layout?.visibility === "none") continue;
      const data = this.sources.get(layer.source)?.data;
      if (!data) continue;
      const features =
        data.type === "FeatureCollection" ? data.features : [data];
      for (const f of features) {
        if (f.geometry.type !== "Polygon") continue;
        c.beginPath();
        for (const ring of f.geometry.coordinates) {
          ring.forEach((p, i) => {
            const xy = this.project(p as [number, number]);
            if (i) c.lineTo(xy.x, xy.y);
            else c.moveTo(xy.x, xy.y);
          });
          c.closePath();
        }
        const color = f.properties?.color ?? "#fff6d4";
        if (layer.type === "fill") {
          c.fillStyle = color;
          c.globalAlpha = 0.22;
          c.fill();
          c.globalAlpha = 1;
        } else {
          c.strokeStyle = color;
          c.lineWidth = f.properties?.selected ? 3 : 2;
          c.setLineDash(layer.id === "draft-line" ? [6, 4] : []);
          c.stroke();
        }
      }
    }
    c.setLineDash([]);
  }
  remove() {
    this.disposed = true;
    this.terrainTiles.dispose();
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((f) => f());
    this.events.clear();
    this.canvas.remove();
  }
}
export function createCanvasMap(options: MapOptions): MapLibreMap {
  return new CanvasMap(options) as unknown as MapLibreMap;
}
