import esbuild from "esbuild"
import { copy } from "esbuild-plugin-copy"

const config = {
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: ["vscode", "esbuild", "./xhr-sync-worker.js", "sodium-native", "udx-native", "b4a"],
  format: "cjs",
  outdir: "out",
  platform: "node",
  sourcemap: true,
  loader: { ".node": "file" },
  plugins: [copy({ resolveFrom: "cwd", assets: [
    { from: "./node_modules/tree-sitter-wasms/out/**/*.wasm", to: "./out/tree-sitter-wasms" },
    { from: "./node_modules/web-tree-sitter/tree-sitter.wasm", to: "./out/tree-sitter.wasm" }
  ] })]
}

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(config)
  await context.watch()
} else {
  await esbuild.build(config)
}
