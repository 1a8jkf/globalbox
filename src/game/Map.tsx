import { TerrainTiles } from "../terrain/tiles.ts";
import { useEffect, useRef, useState } from "react";
import type { MapOptions } from "maplibre-gl";
import { createCanvasMap } from "./canvas-map.ts";
import type { Map as MapType, GeoJSONSource } from "maplibre-gl";
import { area, polygon, simplify } from "@turf/turf";
import type { Polygon, FeatureCollection } from "geojson";
import type { Territory, Person } from "./types.ts";
import { house, person } from "./sprites.ts";
import { CharacterMotion } from "./motion.ts";
const characterMotion = new CharacterMotion();
import { Icon } from "./icons.tsx";
import type { ViewBounds } from "../../shared/contracts.ts";
import { terrainCanvas, animal } from "./terrain.ts";
import "maplibre-gl/dist/maplibre-gl.css";
export let activeMap: MapType | undefined;
export interface MapProps {
  territories: Territory[];
  details: Territory[];
  resources: boolean;
  blocked: boolean;
  onView: (bounds: ViewBounds) => void;
  selected: Territory | null;
  drawing: boolean;
  draft: Polygon | null;
  ownerId?: string;
  destination: { center: [number, number]; zoom: number; nonce: number } | null;
  political: boolean;
  terrain: boolean;
  population: boolean;
  placing: string | null;
  onSelect: (id: string) => void;
  onDraw: (geometry: Polygon) => void;
  onArea: (area: number) => void;
  onPlace: (x: number, y: number) => void;
  onPerson: (p: Person) => void;
  onReady: () => void;
  onError: (text: string) => void;
}
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
export function WorldMap(props: MapProps) {
  const host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    drawCanvas = useRef<HTMLCanvasElement>(null),
    map = useRef<MapType | null>(null),
    latest = useRef(props),
    points = useRef<[number, number][]>([]),
    drawingPointer = useRef<number | null>(null);
  latest.current = props;
  const [vertexMode, setVertexMode] = useState(false),
    [vertexCount, setVertexCount] = useState(0);
  const cursor = useRef<[number, number]>([innerWidth / 2, innerHeight / 2]);
  const [zoom, setZoom] = useState(1.7),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let disposed = false,
      dispose = () => {};
    const setup = async () => {
      let disposeTerrain = () => {};
      const createMap = async (options: MapOptions) => {
        const probe = document.createElement("canvas");
        const gl = probe.getContext("webgl2");
        if (gl) {
          gl.getExtension("WEBGL_lose_context")?.loseContext();
          const { Map, addProtocol, removeProtocol } =
            await import("maplibre-gl");
          const tiles = new TerrainTiles();
          addProtocol("terrain", async (params, controller) => {
            const [z, x, y] = params.url
              .replace("terrain://", "")
              .split("/")
              .map(Number);
            if (
              ![z, x, y].every(Number.isInteger) ||
              z < 0 ||
              z > 20 ||
              x < 0 ||
              y < 0 ||
              x >= 2 ** z ||
              y >= 2 ** z
            )
              throw Error("Invalid terrain tile");
            return { data: await tiles.png({ z, x, y }, controller.signal) };
          });
          disposeTerrain = () => {
            tiles.dispose();
            removeProtocol("terrain");
          };
          try {
            return new Map({ ...options, maxTileCacheSize: 48 });
          } catch (error) {
            disposeTerrain();
            throw error;
          }
        }
        return createCanvasMap(options);
      };
      const m = await createMap({
        container,
        center: [0, 0],
        zoom: Math.log2(Math.min(innerWidth - 36, innerHeight - 140) / 512),
        minZoom: -1.5,
        maxZoom: 19,
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            earth: {
              type: "raster",
              tiles: ["terrain://{z}/{x}/{y}"],
              tileSize: 256,
              minzoom: 0,
              maxzoom: 20,
              attribution: "Natural Earth",
            },
          },
          layers: [
            {
              id: "ocean",
              type: "background",
              paint: { "background-color": "#144772" },
            },
            {
              id: "earth",
              type: "raster",
              source: "earth",
              paint: {
                "raster-resampling": "nearest",
                "raster-fade-duration": 0,
              },
            },
          ],
        },
      });
      if (disposed) {
        m.remove();
        disposeTerrain();
        return;
      }
      map.current = m;
      Object.defineProperty(container, "camera", {
        value: m,
        configurable: true,
      });
      activeMap = m;
      m.touchZoomRotate.disableRotation();
      m.on("load", () => {
        m.addSource("territories", { type: "geojson", data: empty });
        m.addLayer({
          id: "territory-fill",
          type: "fill",
          source: "territories",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.2 },
        });
        m.addLayer({
          id: "territory-border",
          type: "line",
          source: "territories",
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["case", ["get", "selected"], 3, 1.7],
          },
        });
        m.addSource("draft", { type: "geojson", data: empty });
        m.addLayer({
          id: "draft-fill",
          type: "fill",
          source: "draft",
          paint: { "fill-color": "#f4e4ab", "fill-opacity": 0.35 },
        });
        m.addLayer({
          id: "draft-line",
          type: "line",
          source: "draft",
          paint: {
            "line-color": "#fbf5dc",
            "line-width": 2.5,
            "line-dasharray": [3, 2],
          },
        });
        setReady(true);
        latest.current.onReady();
      });
      const reportView = () => {
        const b = m.getBounds();
        latest.current.onView({
          west: Math.max(-180, b.getWest()),
          east: Math.min(180, b.getEast()),
          south: Math.max(-85, b.getSouth()),
          north: Math.min(85, b.getNorth()),
        });
      };
      m.on("moveend", reportView);
      m.once("load", reportView);
      m.on("zoom", () => setZoom(m.getZoom()));
      m.on("error", (e) => latest.current.onError(`Mapa: ${e.error.message}`));
      m.on("click", (e) => {
        const p = latest.current;
        if (p.drawing || p.blocked || !m.getLayer("territory-fill")) return;
        if (p.placing && p.selected) {
          const t = p.selected;
          p.onPlace(
            Math.floor(
              ((e.lngLat.lng - t.minLon) / (t.maxLon - t.minLon)) * 64,
            ),
            Math.floor(
              ((t.maxLat - e.lngLat.lat) / (t.maxLat - t.minLat)) * 64,
            ),
          );
          return;
        }
        if (p.selected?.characters) {
          for (const character of p.selected.characters) {
            const pos = localPoint(m, p.selected, character.x, character.y);
            if (Math.hypot(pos.x - e.point.x, pos.y - e.point.y) < 12) {
              p.onPerson(character);
              return;
            }
          }
        }
        const features = m.queryRenderedFeatures(e.point, {
          layers: ["territory-fill"],
        });
        if (features[0]) p.onSelect(String(features[0].properties.id));
        else {
          const nearest = p.territories.find((t) => {
            const pos = m.project([
              (t.minLon + t.maxLon) / 2,
              (t.minLat + t.maxLat) / 2,
            ]);
            return Math.hypot(pos.x - e.point.x, pos.y - e.point.y) < 18;
          });
          if (nearest) p.onSelect(nearest.id);
        }
      });
      let resizeFrame = 0;
      const resize = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => m.resize());
      });
      resize.observe(container);
      const key = (e: KeyboardEvent) => {
        if (
          latest.current.blocked ||
          latest.current.drawing ||
          (e.target instanceof Element &&
            e.target.matches("input,textarea,select"))
        )
          return;
        if (e.key === "Home") {
          e.preventDefault();
          m.flyTo({
            center: [0, 0],
            zoom: Math.log2(Math.min(innerWidth - 36, innerHeight - 140) / 512),
          });
        }
      };
      window.addEventListener("keydown", key);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      let frame = 0,
        last = 0;
      const render = (time: number) => {
        frame = requestAnimationFrame(render);
        if (document.hidden || time - last < 32) return;
        last = time;
        paintOverlay(
          m,
          overlay.current,
          latest.current,
          reduced.matches ? 0 : time,
        );
      };
      frame = requestAnimationFrame(render);
      return () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        cancelAnimationFrame(resizeFrame);
        window.removeEventListener("keydown", key);
        m.remove();
        disposeTerrain();
        activeMap = undefined;
      };
    };
    void setup()
      .then((cleanup) => {
        dispose = cleanup ?? (() => {});
        if (disposed) dispose();
      })
      .catch((error) =>
        latest.current.onError(
          error instanceof Error ? error.message : "Mapa indisponível.",
        ),
      );
    return () => {
      disposed = true;
      dispose();
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const features: FeatureCollection = {
      type: "FeatureCollection",
      features: props.territories.map((t) => ({
        type: "Feature",
        geometry: t.geometry.polygon,
        properties: {
          id: t.id,
          selected: t.id === props.selected?.id,
          color:
            t.ownerId === props.ownerId
              ? "#4b713f"
              : t.listing?.status === "ACTIVE"
                ? "#c59347"
                : "#5a847e",
        },
      })),
    };
    (m.getSource("territories") as GeoJSONSource).setData(features);
    m.setLayoutProperty(
      "territory-border",
      "visibility",
      props.political ? "visible" : "none",
    );
    m.setLayoutProperty(
      "earth",
      "visibility",
      props.terrain ? "visible" : "none",
    );
    (m.getSource("draft") as GeoJSONSource).setData(
      props.draft
        ? { type: "Feature", geometry: props.draft, properties: {} }
        : empty,
    );
  }, [
    ready,
    props.territories,
    props.selected?.id,
    props.ownerId,
    props.political,
    props.terrain,
    props.draft,
  ]);
  useEffect(() => {
    if (props.destination)
      map.current?.flyTo({ ...props.destination, duration: 1400 });
  }, [props.destination]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (props.drawing || props.blocked) m.dragPan.disable();
    else m.dragPan.enable();
  }, [props.drawing, props.blocked]);
  useEffect(() => {
    if (props.drawing) {
      points.current = [];
      setVertexCount(0);
      drawingPointer.current = null;
      drawCanvas.current?.focus();
    }
  }, [props.drawing]);
  function complete() {
    const m = map.current;
    if (!m || points.current.length < 3) {
      latest.current.onError("Marque pelo menos três pontos.");
      return;
    }
    const coordinates = points.current.map((p) => m.unproject(p).toArray());
    coordinates.push(coordinates[0]);
    const tolerance =
      Math.abs(
        coordinates[0][0] -
          m.unproject([points.current[0][0] + 1, points.current[0][1]]).lng,
      ) * 1.5;
    latest.current.onDraw(
      simplify(polygon([coordinates]), { tolerance, highQuality: true })
        .geometry,
    );
  }
  function addVertex(p: [number, number]) {
    if (points.current.length >= 2046) return;
    points.current.push(p);
    setVertexCount(points.current.length);
    drawLine();
  }
  function drawLine() {
    const canvas = drawCanvas.current,
      m = map.current;
    if (!canvas || !m) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const c = canvas.getContext("2d")!;
    c.strokeStyle = "#fff8d8";
    c.fillStyle = "#fff0b52b";
    c.lineWidth = 2.5;
    c.setLineDash([5, 4]);
    c.beginPath();
    points.current.forEach(([x, y], i) =>
      i ? c.lineTo(x, y) : c.moveTo(x, y),
    );
    c.closePath();
    c.fill();
    c.stroke();
    if (vertexMode) {
      c.setLineDash([]);
      c.strokeRect(cursor.current[0] - 6, cursor.current[1] - 6, 12, 12);
      points.current.forEach((p) => c.fillRect(p[0] - 3, p[1] - 3, 6, 6));
    }
    if (points.current.length > 2) {
      const coords = points.current.map((p) => m.unproject(p).toArray());
      coords.push(coords[0]);
      latest.current.onArea(area(polygon([coords])) / 1e6);
    }
  }
  return (
    <>
      <div
        className={"map-host " + (props.placing ? "placing" : "")}
        ref={host}
      />
      <canvas ref={overlay} className="life-canvas" aria-hidden="true" />
      {props.drawing && (
        <canvas
          ref={drawCanvas}
          className="draw-canvas"
          aria-label="Desenhe seu território no mapa"
          tabIndex={0}
          onKeyDown={(e) => {
            if (!vertexMode) return;
            if (e.key.startsWith("Arrow")) {
              e.preventDefault();
              const delta = e.shiftKey ? 2 : 12;
              cursor.current = [
                Math.max(
                  0,
                  Math.min(
                    innerWidth,
                    cursor.current[0] +
                      (e.key === "ArrowRight"
                        ? delta
                        : e.key === "ArrowLeft"
                          ? -delta
                          : 0),
                  ),
                ),
                Math.max(
                  0,
                  Math.min(
                    innerHeight,
                    cursor.current[1] +
                      (e.key === "ArrowDown"
                        ? delta
                        : e.key === "ArrowUp"
                          ? -delta
                          : 0),
                  ),
                ),
              ];
              drawLine();
            } else if (e.key === " ") {
              e.preventDefault();
              addVertex([...cursor.current]);
            } else if (e.key === "Enter") {
              e.preventDefault();
              complete();
            } else if (e.key === "Backspace") {
              e.preventDefault();
              points.current.pop();
              setVertexCount(points.current.length);
              drawLine();
            }
          }}
          onPointerDown={(e) => {
            if (vertexMode) {
              cursor.current = [e.clientX, e.clientY];
              addVertex([...cursor.current]);
              return;
            }
            if (drawingPointer.current !== null) return;
            drawingPointer.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            points.current = [[e.clientX, e.clientY]];
            drawLine();
          }}
          onPointerMove={(e) => {
            if (drawingPointer.current !== e.pointerId) return;
            const p = points.current.at(-1)!;
            if (
              Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 3 &&
              points.current.length < 2046
            ) {
              points.current.push([e.clientX, e.clientY]);
              drawLine();
            }
          }}
          onPointerUp={(e) => {
            if (drawingPointer.current !== e.pointerId) return;
            drawingPointer.current = null;
            complete();
          }}
          onPointerCancel={() => {
            drawingPointer.current = null;
            points.current = [];
            drawLine();
          }}
        />
      )}
      {props.drawing && (
        <div className="drawing-controls">
          <button
            className="secondary"
            onClick={() => {
              setVertexMode(!vertexMode);
              points.current = [];
              setVertexCount(0);
              drawCanvas.current?.focus();
            }}
          >
            Modo: {vertexMode ? "vértices" : "traço livre"}
          </button>
          {vertexMode && (
            <>
              <span>
                {vertexCount} pontos · Setas: mover · Espaço: marcar · Enter:
                fechar
              </span>
              <button
                className="primary"
                disabled={vertexCount < 3}
                onClick={complete}
              >
                Fechar fronteira
              </button>
            </>
          )}
        </div>
      )}
      <div className="map-controls">
        <button
          title="Aproximar"
          aria-label="Aproximar"
          onClick={() => map.current?.zoomIn()}
        >
          <Icon name="plus" />
        </button>
        <button
          title="Afastar"
          aria-label="Afastar"
          onClick={() => map.current?.zoomOut()}
        >
          <Icon name="minus" />
        </button>
        <span>
          {zoom < 4
            ? "MUNDO"
            : zoom < 9
              ? "REGIÃO"
              : zoom < 13
                ? "TERRITÓRIO"
                : "LOCAL"}
        </span>
        <button
          title="Visão global (Home)"
          aria-label="Visão global"
          onClick={() =>
            map.current?.flyTo({
              center: [0, 0],
              zoom: Math.log2(
                Math.min(innerWidth - 36, innerHeight - 140) / 512,
              ),
            })
          }
        >
          <Icon name="globe" />
        </button>
        <button
          title="Tela cheia"
          aria-label="Tela cheia"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void document.documentElement.requestFullscreen().catch(() => {});
          }}
        >
          <Icon name="fullscreen" />
        </button>
      </div>
      <div className="map-attribution">
        Geografia: Natural Earth · Propriedade exclusivamente virtual
      </div>
    </>
  );
}
function localPoint(m: MapType, t: Territory, x: number, y: number) {
  return m.project([
    t.minLon + (x / 64) * (t.maxLon - t.minLon),
    t.maxLat - (y / 64) * (t.maxLat - t.minLat),
  ]);
}
function paintOverlay(
  m: MapType,
  canvas: HTMLCanvasElement | null,
  props: MapProps,
  time: number,
) {
  if (!canvas) return;
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  c.imageSmoothingEnabled = false;
  for (const t of props.territories) {
    const p = m.project([(t.minLon + t.maxLon) / 2, (t.minLat + t.maxLat) / 2]);

    const selected = t.id === props.selected?.id;
    const a = m.project([t.minLon, t.maxLat]),
      b = m.project([t.maxLon, t.minLat]);
    const width = b.x - a.x;
    if (b.x < 0 || a.x > w || b.y < 0 || a.y > h) continue;
    const detail =
      props.details.find((d) => d.id === t.id) ??
      (selected ? props.selected : null);
    if (detail?.grid && width > 130) {
      c.save();
      c.globalAlpha = Math.min(1, (width - 130) / 130);
      drawLocal(c, m, detail, time, w, h);
      c.restore();
    }
    if (width < 100) {
      c.fillStyle = t.ownerId === props.ownerId ? "#38563c" : "#faf3db";
      c.strokeStyle = "#63826b";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, selected ? 7 : 5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (m.getZoom() > 4 || selected) {
      c.font = "600 11px system-ui";
      c.textAlign = "center";
      c.fillStyle = "#f7f4e9";
      const label = props.resources
        ? `${t.name} · ${detail?.resources?.map((r) => `${r.kind}: ${Math.floor(r.amount)}`).join(" / ") ?? "aproxime para ver estoques"}`
        : props.population
          ? `${t.name} · ${t._count?.characters ?? t.characters?.length ?? 0} habitantes`
          : t.name;
      const widthText = c.measureText(label).width;
      c.fillRect(p.x - widthText / 2 - 9, b.y + 10, widthText + 18, 24);
      c.fillStyle = "#394c3e";
      c.fillText(label, p.x, b.y + 26);
    }
  }
}
function drawLocal(
  c: CanvasRenderingContext2D,
  m: MapType,
  t: Territory,
  time: number,
  w: number,
  h: number,
) {
  const nw = localPoint(m, t, 0, 0),
    se = localPoint(m, t, 64, 64),
    sx = (se.x - nw.x) / 64,
    scale = Math.max(0.4, Math.min(5, sx / 8));
  c.save();
  c.beginPath();
  t.geometry.polygon.coordinates[0].forEach((pt, i) => {
    const p = m.project(pt as [number, number]);
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  });
  c.closePath();
  c.clip();
  const terrain = terrainCanvas(t);
  c.drawImage(terrain, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  const animals = [...(t.grid ?? "")]
    .map((v, i) => (v === "g" && i % 137 === 0 ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 3);
  animals.forEach((i, index) => {
    const p = localPoint(m, t, (i % 64) + 0.5, Math.floor(i / 64) + 0.5);
    if (p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h)
      animal(c, p.x, p.y, scale, index, time);
  });
  const entities = [
    ...(t.buildings ?? []).map((b) => ({
      y: b.y + 0.8,
      building: b,
      character: null,
    })),
    ...(t.characters ?? []).map((p) => ({
      y: p.y,
      character: p,
      building: null,
    })),
  ].sort((a, b) => a.y - b.y);
  for (const e of entities) {
    if (e.building) {
      const b = e.building,
        p = localPoint(m, t, b.x, b.y + 1);
      house(
        c,
        b,
        p.x,
        p.y,
        scale,
        t.farms?.find((f) => f.buildingId === b.id),
        time,
      );
    } else if (e.character) {
      const char = e.character;
      const { x, y } = characterMotion.sample(char.id, char, time);
      const p = localPoint(m, t, x, y);
      if (p.x < -64 || p.y < -80 || p.x > w + 64 || p.y > h + 80) continue;
      person(c, char, p.x, p.y, scale, time);
    }
  }
  c.restore();
}
