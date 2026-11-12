import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  test: { include: ["tests/**/*.test.ts"], exclude: ["fixtures/**", "node_modules/**"] },
});
