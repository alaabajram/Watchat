// Serves the in-browser video converter (ffmpeg.wasm) from our own site: /ffmpeg/ffmpeg-core.{js,wasm}.
// Runs after npm install (locally and on Vercel), so the 32 MB file isn't kept in git.
// The loader (@ffmpeg/ffmpeg, /ffmpeg/lib) is served too and imported at runtime: its worker code uses a
// pattern the Next.js bundler can't compile.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const core = "node_modules/@ffmpeg/core/dist/esm";
const lib = "node_modules/@ffmpeg/ffmpeg/dist/esm";
if (!existsSync(core) || !existsSync(lib)) {
  console.warn("[copy-ffmpeg] @ffmpeg packages not installed; skipping");
  process.exit(0);
}
mkdirSync("public/ffmpeg/lib", { recursive: true });
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) copyFileSync(`${core}/${f}`, `public/ffmpeg/${f}`);
for (const f of readdirSync(lib).filter((f) => f.endsWith(".js"))) copyFileSync(`${lib}/${f}`, `public/ffmpeg/lib/${f}`);
console.log("[copy-ffmpeg] copied ffmpeg core and loader to public/ffmpeg");
