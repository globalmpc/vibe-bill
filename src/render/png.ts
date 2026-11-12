import { readFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

declare const __BUNDLED__: boolean;
const here = (bundled: string, src: string) => new URL(typeof __BUNDLED__ !== "undefined" ? bundled : src, import.meta.url);

let ready: Promise<(svg: string) => Uint8Array> | undefined;

/** Async init once; wasm and font are files next to the bundle (D-037). No network. */
export function loadPng(): Promise<(svg: string) => Uint8Array> {
  return (ready ??= (async () => {
    await initWasm(readFileSync(here("./resvg.wasm", "../../node_modules/@resvg/resvg-wasm/index_bg.wasm")));
    const ttf = new Uint8Array(readFileSync(here("./LiberationMono-Regular.ttf", "../../fonts/LiberationMono-Regular.ttf")));
    return (svg: string) => new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: { fontBuffers: [ttf], loadSystemFonts: false, defaultFontFamily: "Liberation Mono" },
    }).render().asPng();
  })());
}
