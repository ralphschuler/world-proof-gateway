import { build } from "esbuild";

await build({
  entryPoints: ["src/minikit-browser-entry.js"],
  outfile: "src/static/minikit.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
});
