// Refresh data/openrouter-snapshot.json from the live OpenRouter list. Not part of build/test.
import { writeFileSync } from "node:fs";

const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const { data } = await res.json();
const per1m = (s) => {
  const n = Number(s);
  return typeof s === "string" && s.trim() !== "" && Number.isFinite(n) && n >= 0 ? Number((n * 1e6).toPrecision(12)) : null;
};
const models = {};
for (const m of [...data].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const input_per_1m = per1m(m.pricing?.prompt);
  const output_per_1m = per1m(m.pricing?.completion);
  if (input_per_1m === null || output_per_1m === null) continue;
  models[m.id] = { name: m.name, context_length: m.context_length ?? 0, input_per_1m, output_per_1m };
}
const out = { schema: 1, source: "openrouter", fetched_at: new Date().toISOString().slice(0, 10), models };
writeFileSync("data/openrouter-snapshot.json", JSON.stringify(out, null, 1) + "\n");
console.log(`${Object.keys(models).length} models`);
