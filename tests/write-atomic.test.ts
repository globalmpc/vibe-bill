import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeAtomic } from "../src/questions/config";

it("writes normally and leaves no tmp file", () => {
  const root = mkdtempSync(join(tmpdir(), "vb-"));
  mkdirSync(join(root, ".vibe-bill", "out"), { recursive: true });
  writeAtomic(join(root, ".vibe-bill", "out", "a.json"), "x");
  expect(readFileSync(join(root, ".vibe-bill", "out", "a.json"), "utf8")).toBe("x");
  expect(readdirSync(join(root, ".vibe-bill", "out"))).toEqual(["a.json"]);
});

it("refuses a symlinked .vibe-bill/out and does not touch the target", () => {
  const root = mkdtempSync(join(tmpdir(), "vb-"));
  const outside = mkdtempSync(join(tmpdir(), "vb-outside-"));
  writeFileSync(join(outside, "detect.json"), "keep");
  mkdirSync(join(root, ".vibe-bill"));
  symlinkSync(outside, join(root, ".vibe-bill", "out"));
  expect(() => writeAtomic(join(root, ".vibe-bill", "out", "detect.json"), "x")).toThrow(/symlink/);
  expect(readFileSync(join(outside, "detect.json"), "utf8")).toBe("keep");
});
