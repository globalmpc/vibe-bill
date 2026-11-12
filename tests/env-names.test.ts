import { expect, test } from "vitest";
import { isEnvFile, namesFromCode, namesFromConfig, namesFromEnvText } from "../src/detect/env-names";

test("namesFromCode: all 7 patterns, builtins dropped", () => {
  const t = [
    "process.env.A1", "process.env['B1']", "import.meta.env.C1", "os.environ['D1']",
    "os.environ.get('E1')", "os.getenv('F1', 'x')", "Deno.env.get('G1')", "process.env.NODE_ENV", "import.meta.env.MODE",
  ].join("\n");
  expect(namesFromCode(t)).toEqual(["A1", "B1", "C1", "D1", "E1", "F1", "G1"]);
});

test("namesFromConfig", () => {
  expect(namesFromConfig("docker-compose.yml", "environment:\n  - LIST_A=1\n  - LIST_B\n  MAP_C: x\n  y: ${INTERP_D}\n")).toEqual(["INTERP_D", "LIST_A", "LIST_B", "MAP_C"]);
  expect(namesFromConfig("vercel.json", '{"env":{"V_A":"1"},"build":{"env":{"V_B":"2"}}}')).toEqual(["V_A", "V_B"]);
  expect(namesFromConfig("netlify.toml", "[build.environment]\n  N_A = \"1\"\n")).toEqual(["N_A"]);
  expect(namesFromConfig("wrangler.toml", "[vars]\nW_A = \"1\"\n")).toEqual(["W_A"]);
});

test("namesFromEnvText", () => {
  const v = "FAKE_VALUE_123";
  const t = `# c\n\nA=1\nexport B="${v}=x"\nlower=1\nPEM="-----BEGIN\nINNER=${v}\n-----END"\nC='x'\n`;
  const r = namesFromEnvText(t);
  expect(r).toEqual(["A", "B", "C", "PEM"]);
  expect(JSON.stringify(r)).not.toContain(v);
});

test("isEnvFile", () => {
  for (const f of [".env", ".env.local", ".env.example", "a/.env"]) expect(isEnvFile(f)).toBe(true);
  for (const f of [".envrc", "env.ts"]) expect(isEnvFile(f)).toBe(false);
});
