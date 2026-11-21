// Serves the in-browser video converter (ffmpeg.wasm) from our own site: /ffmpeg/ffmpeg-core.{js,wasm},
// plus the font used to burn subtitles (/ffmpeg/fonts).
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
// A font for burning English subtitles into WhatsApp versions (libass needs a real font file).
const fonts = "node_modules/dejavu-fonts-ttf/ttf";
if (existsSync(`${fonts}/DejaVuSans-Bold.ttf`)) {
  mkdirSync("public/ffmpeg/fonts", { recursive: true });
  copyFileSync(`${fonts}/DejaVuSans-Bold.ttf`, "public/ffmpeg/fonts/DejaVuSans-Bold.ttf");
}
console.log("[copy-ffmpeg] copied ffmpeg core, loader and subtitle font to public/ffmpeg");
