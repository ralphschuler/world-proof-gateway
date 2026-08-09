import { build } from "esbuild";

await build({
  entryPoints: ["node_modules/@worldcoin/minikit-js/build/index.js"],
  outfile: "src/static/minikit.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
});
