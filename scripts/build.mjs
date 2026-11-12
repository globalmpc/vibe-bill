import { copyFileSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const out = "skills/vibe-bill/scripts";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: `${out}/vibe-bill.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  define: { __VERSION__: JSON.stringify(version), __BUNDLED__: "true" },
});

// PNG assets live next to the bundle and are located via import.meta.url (D-037).
for (const [from, to] of [
  ["node_modules/@resvg/resvg-wasm/index_bg.wasm", "resvg.wasm"],
  ["scripts/LICENSE-resvg-wasm.txt", "resvg-wasm.LICENSE.txt"],
  ["fonts/LiberationMono-Regular.ttf", "LiberationMono-Regular.ttf"],
  ["fonts/LICENSE-LiberationMono.txt", "LICENSE-LiberationMono.txt"],
]) copyFileSync(from, `${out}/${to}`);
