import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL("../data/characters/reference.png", import.meta.url);
const image = await loadImage(await readFile(source));
// Hand-framed crops: the supplied sheet has variable spacing, not a uniform grid.
const groups = {
  Worker: [
    [16, 40, 80, 96],
    [110, 40, 78, 96],
    [206, 40, 78, 96],
    [299, 40, 79, 96],
    [391, 40, 80, 96],
    [484, 40, 89, 96],
    [582, 40, 86, 96],
    [676, 40, 82, 96],
  ],
  Farmer: [
    [778, 35, 96, 106],
    [877, 35, 96, 106],
    [973, 35, 93, 106],
    [1073, 35, 91, 106],
    [1171, 35, 84, 106],
    [1265, 35, 81, 106],
    [1358, 35, 83, 106],
    [1447, 35, 84, 106],
  ],
  Builder: [
    [16, 167, 99, 99],
    [124, 167, 105, 99],
    [230, 167, 96, 99],
    [335, 167, 102, 99],
    [440, 167, 96, 99],
    [544, 167, 94, 99],
    [650, 167, 96, 99],
  ],
  Miner: [
    [774, 166, 104, 102],
    [883, 166, 94, 102],
    [987, 166, 98, 102],
    [1093, 166, 100, 102],
    [1201, 166, 93, 102],
    [1304, 166, 107, 102],
    [1420, 166, 100, 102],
  ],
  Woodcutter: [
    [12, 293, 100, 112],
    [112, 293, 122, 112],
    [236, 293, 91, 112],
    [334, 293, 102, 112],
    [445, 293, 98, 112],
    [550, 293, 100, 112],
    [655, 293, 95, 112],
  ],
  Trader: [
    [774, 293, 99, 112],
    [881, 293, 99, 112],
    [988, 293, 96, 112],
    [1093, 293, 101, 112],
    [1200, 293, 93, 112],
    [1296, 293, 111, 112],
    [1411, 293, 111, 112],
  ],
};
await mkdir(new URL("../public/characters/", import.meta.url), {
  recursive: true,
});
const manifest = {
  source: "User attachment, 2026-09-27",
  sha256: createHash("sha256")
    .update(await readFile(source))
    .digest("hex"),
  frameWidth: 40,
  frameHeight: 48,
  groups: {},
};
for (const [name, crops] of Object.entries(groups)) {
  const atlas = createCanvas(crops.length * 40, 48),
    out = atlas.getContext("2d");
  out.imageSmoothingEnabled = false;
  for (let index = 0; index < crops.length; index++) {
    const [x, y, w, h] = crops[index],
      crop = createCanvas(w, h),
      c = crop.getContext("2d");
    c.drawImage(image, x, y, w, h, 0, 0, w, h);
    const pixels = c.getImageData(0, 0, w, h),
      d = pixels.data;
    // The checkerboard is baked into the attachment. Flood only neutral background
    // connected to crop edges, preserving enclosed pale clothing/tool highlights.
    const seen = new Uint8Array(w * h),
      queue = [];
    const push = (i) => {
      if (i < 0 || i >= w * h || seen[i]) return;
      const k = i * 4,
        r = d[k],
        g = d[k + 1],
        b = d[k + 2];
      if (
        d[k + 3] === 0 ||
        (Math.max(r, g, b) - Math.min(r, g, b) < 26 && Math.min(r, g, b) > 153)
      ) {
        seen[i] = 1;
        queue.push(i);
      }
    };
    for (let xx = 0; xx < w; xx++) {
      push(xx);
      push((h - 1) * w + xx);
    }
    for (let yy = 0; yy < h; yy++) {
      push(yy * w);
      push(yy * w + w - 1);
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      d[i * 4 + 3] = 0;
      if (i % w) push(i - 1);
      if (i % w < w - 1) push(i + 1);
      push(i - w);
      push(i + w);
    }
    c.putImageData(pixels, 0, 0);
    // Common scale and feet baseline preserve relative sizes through animations.
    const dw = Math.round(w * 0.39),
      dh = Math.round(h * 0.39);
    out.drawImage(
      crop,
      Math.round(index * 40 + (40 - dw) / 2),
      47 - dh,
      dw,
      dh,
    );
  }
  await writeFile(
    new URL(`../public/characters/${name}.png`, import.meta.url),
    atlas.toBuffer("image/png"),
  );
  manifest.groups[name] = { frames: crops.length, crops };
}
await writeFile(
  new URL("../public/characters/source.json", import.meta.url),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Prepared six transparent character strips, 44 frames, 40 × 48 px.",
);
