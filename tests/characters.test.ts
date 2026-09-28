import { test } from "node:test";
import assert from "node:assert/strict";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  characterArt,
  characterFrame,
  CHARACTER_ART,
} from "../src/game/characters.ts";
import { CharacterMotion } from "../src/game/motion.ts";
test("supplied character strips have valid task frames, transparent backgrounds and pinned provenance", async () => {
  const manifest = JSON.parse(
    readFileSync("public/characters/source.json", "utf8"),
  );
  assert.equal(
    manifest.sha256,
    createHash("sha256")
      .update(readFileSync("data/characters/reference.png"))
      .digest("hex"),
  );
  for (const [role, art] of Object.entries(CHARACTER_ART)) {
    const im = await loadImage(`public/characters/${role}.png`);
    assert.equal(im.height, 48);
    assert.equal(im.width, manifest.groups[role].frames * 40);
    const c = createCanvas(im.width, 48),
      ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0);
    const pixels = ctx.getImageData(0, 0, im.width, 48).data;
    for (const frame of new Set([art.idle, ...art.walk, ...art.work])) {
      assert.ok(frame >= 0 && frame < im.width / 40);
      let opaque = 0,
        transparent = 0;
      for (let y = 0; y < 48; y++)
        for (let x = frame * 40; x < (frame + 1) * 40; x++) {
          if (pixels[(y * im.width + x) * 4 + 3]) opaque++;
          else transparent++;
        }
      assert.ok(opaque > 100);
      assert.ok(transparent > opaque, "background removed");
    }
    assert.equal(characterFrame(role, "Building", 0), art.idle);
    assert.equal(characterFrame(role, "Resting", 1234), art.idle);
    assert.ok(
      art.walk.includes(characterFrame(role, "Walking", 1234) as never),
    );
  }
  assert.equal(characterArt("Unknown"), "Worker");
});
test("display movement converges without modulo jumps and does not cut corners", () => {
  const motion = new CharacterMotion();
  assert.deepEqual(motion.sample("a", { x: 2, y: 2 }, 100), { x: 2, y: 2 });
  assert.deepEqual(motion.sample("a", { x: 3, y: 2 }, 3100), { x: 2, y: 2 });
  assert.deepEqual(motion.sample("a", { x: 3, y: 2 }, 3550), { x: 2.5, y: 2 });
  assert.deepEqual(motion.sample("a", { x: 3, y: 2 }, 4100), { x: 3, y: 2 });
  assert.deepEqual(motion.sample("a", { x: 4, y: 3 }, 6100), { x: 4, y: 3 });
  assert.deepEqual(motion.sample("a", { x: 5, y: 3 }, 0), { x: 5, y: 3 });
});
