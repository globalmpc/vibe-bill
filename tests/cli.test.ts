import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { run } from "../src/cli";

test("--version prints package.json version", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(run(["--version"])).toEqual({ code: 0, out: pkg.version + "\n", err: "" });
});

test("unknown command fails, render without path prints usage", () => {
  expect(run(["nope"]).code).toBe(1);
  expect(run(["render"]).err).toContain("render <path> [--tier N]");
});
