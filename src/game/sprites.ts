import type { Building, Person, Farm } from "./types.ts";
import { BUILDINGS, type BuildingKind } from "../../shared/game.ts";
import { characterArt, characterFrame } from "./characters.ts";
type C = CanvasRenderingContext2D;
export function tree(c: C, x: number, y: number, s: number, variant = 0) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(s, s);
  c.fillStyle = "#183d3444";
  c.fillRect(-2, 1, 10, 3);
  c.fillStyle = "#533b29";
  c.fillRect(-1, -5, 3, 8);
  c.fillStyle = "#b18a4d";
  c.fillRect(-1, -3, 1, 5);
  if (variant === 2) {
    c.fillStyle = "#234d42";
    c.fillRect(-5, -7, 11, 5);
    c.fillRect(-4, -11, 9, 5);
    c.fillRect(-2, -15, 5, 5);
    c.fillStyle = "#428b58";
    c.fillRect(-4, -8, 6, 2);
    c.fillRect(-3, -12, 5, 2);
    c.fillRect(-1, -16, 2, 3);
  } else {
    c.fillStyle = variant ? "#285c39" : "#376329";
    c.fillRect(-6, -9, 13, 6);
    c.fillRect(-4, -13, 9, 10);
    c.fillStyle = variant ? "#45964d" : "#65a83e";
    c.fillRect(-5, -11, 10, 6);
    c.fillRect(-3, -14, 6, 5);
    c.fillStyle = variant ? "#80c360" : "#a6cf57";
    c.fillRect(-3, -13, 4, 2);
    c.fillRect(-5, -9, 3, 2);
    c.fillStyle = "#5c8b38";
    c.fillRect(3, -7, 2, 3);
  }
  c.restore();
}
function paintHouse(
  c: C,
  b: Building,
  x: number,
  y: number,
  s: number,
  farm?: Farm,
  time = 0,
) {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(s, s);
  const kind = b.type as BuildingKind,
    size = BUILDINGS[kind]?.size ?? 2,
    w = size * 8;
  c.fillStyle = "#39574a33";
  c.fillRect(1, 2, w, 4);
  if (b.progress < 1) {
    c.fillStyle = "#a79874";
    c.fillRect(0, -2, w, 4);
    c.strokeStyle = "#78603f";
    c.lineWidth = 1;
    for (let i = 0; i <= w; i += 4) {
      c.strokeRect(i, -8, 1, 10);
    }
    c.fillStyle = "#b5d779";
    c.fillRect(0, -12, w * b.progress, 2);
    c.restore();
    return;
  }
  if (kind === "Farm") {
    const growth = farm?.growth ?? 0;
    const crop = farm?.crop ?? "Wheat";
    c.fillStyle = crop === "Rice" ? "#599fa4" : "#77502f";
    c.fillRect(0, -w / 2, w, w / 2 + 3);
    for (let row = 0; row < 4; row++) {
      c.fillStyle = crop === "Rice" ? "#87bfc0" : "#a67540";
      c.fillRect(0, 1 - row * 3, w, 1);
      for (let col = 0; col < 6; col++) {
        const px = col * 4 + 1,
          py = 2 - row * 3;
        c.fillStyle = growth > 0.65 && crop === "Wheat" ? "#f5d45c" : "#76b541";
        c.fillRect(px, py, 1, -2 - Math.floor(growth * 4));
        if (growth > 0.35) c.fillRect(px - 1, py - 2, 3, 1);
        if (growth > 0.65 && (crop === "Corn" || crop === "Fruit")) {
          c.fillStyle = crop === "Corn" ? "#ffd75f" : "#e6714c";
          c.fillRect(px + 1, py - 4, 2, 2);
        }
      }
    }
    if (crop === "Wood")
      for (let col = 0; col < 3; col++)
        tree(c, col * 8 + 4, 1, 0.3 + growth * 0.35, 1);
    c.restore();
    return;
  }
  if (kind === "Road") {
    c.fillStyle = "#c9bd98";
    c.fillRect(0, 0, w, 5);
    c.fillStyle = "#b0a483";
    c.fillRect(2, 1, 2, 2);
    c.restore();
    return;
  }
  c.fillStyle = "#e6d4aa";
  c.fillRect(0, -9, w, 11);
  c.fillStyle = "#c2b08c";
  c.fillRect(w - 4, -9, 4, 11);
  c.fillStyle =
    kind === "TownHall" ? "#698d87" : kind === "Market" ? "#a48062" : "#b67559";
  c.fillRect(-2, -12, w + 4, 5);
  c.fillRect(0, -15, w, 4);
  c.fillRect(3, -17, w - 6, 3);
  c.fillStyle = "#d59974";
  c.fillRect(1, -14, w - 3, 2);
  c.fillStyle = "#596352";
  c.fillRect(w / 2 - 2, -5, 4, 7);
  c.fillStyle = "#92b7bb";
  c.fillRect(2, -7, 3, 3);
  if (kind === "Lumberyard") {
    c.fillStyle = "#8b674a";
    c.fillRect(w - 2, -1, 6, 3);
  }
  if (kind === "Mine") {
    c.fillStyle = "#788580";
    c.fillRect(-4, -3, 6, 5);
  }
  if (kind === "TownHall") {
    c.fillStyle = "#eee4bd";
    c.fillRect(w / 2, -24, 1, 8);
    c.fillStyle = "#97b568";
    c.fillRect(w / 2 + 1, -24, 5, 3);
  }
  if (time > 0 && kind === "House") {
    c.fillStyle = "#e9e8ce66";
    c.fillRect(w - 4, -22 - (Math.floor(time / 800) % 3), 2, 3);
  }
  c.restore();
}
const characterImages = new Map<string, HTMLImageElement>();
function characterImage(profession: string) {
  const name = characterArt(profession);
  let image = characterImages.get(name);
  if (!image) {
    image = new Image();
    image.src = `/characters/${name}.png`;
    characterImages.set(name, image);
  }
  return image;
}

// Original sprites share reusable frames; simulation attributes never live in this cache.
const atlas = new Map<string, HTMLCanvasElement>();
function frame(key: string, paint: (ctx: C) => void) {
  let canvas = atlas.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  paint(canvas.getContext("2d")!);
  atlas.set(key, canvas);
  if (atlas.size > 256) atlas.delete(atlas.keys().next().value!);
  return canvas;
}
export function house(
  c: C,
  b: Building,
  x: number,
  y: number,
  s: number,
  farm?: Farm,
  time = 0,
) {
  const stage = Math.floor(b.progress * 10),
    growth = Math.floor((farm?.growth ?? 0) * 10),
    smoke = time ? Math.floor(time / 800) % 3 : 0;
  const sprite = frame(
    `b:${b.type}:${stage}:${farm?.crop}:${growth}:${smoke}`,
    (ctx) =>
      paintHouse(
        ctx,
        { ...b, progress: stage / 10 },
        16,
        48,
        1,
        farm ? { ...farm, growth: growth / 10 } : undefined,
        smoke * 800,
      ),
  );
  c.drawImage(
    sprite,
    Math.round(x - 16 * s),
    Math.round(y - 48 * s),
    64 * s,
    64 * s,
  );
}
export function person(
  c: C,
  p: Person,
  x: number,
  y: number,
  s: number,
  time: number,
) {
  const image = characterImage(p.profession);
  if (!image.complete || !image.naturalWidth) return;
  const frame = characterFrame(p.profession, p.task, time, p.id);
  const unit = s / 3;
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.fillStyle = "#183d3444";
  c.fillRect(-4 * s, 0, 8 * s, 2 * s);
  const target = p.path?.[0];
  if (target && target[0] < p.x) c.scale(-1, 1);
  c.imageSmoothingEnabled = false;
  c.drawImage(
    image,
    frame * 40,
    0,
    40,
    48,
    -20 * unit,
    -46 * unit,
    40 * unit,
    48 * unit,
  );
  c.restore();
  if (p.task === "Resting" && s > 1.1) {
    c.fillStyle = "#effbd3";
    c.font = `${Math.round(5 * s)}px monospace`;
    c.fillText("z", Math.round(x + 4 * s), Math.round(y - 14 * s));
  }
}
