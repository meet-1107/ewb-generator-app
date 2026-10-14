// Bundles each test with esbuild, then runs them with node:test.
import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, "..", "dist-test");
await rm(out, { recursive: true, force: true });
const entries = (await readdir(dir)).filter((name) => name.endsWith(".test.ts")).map((name) => path.join(dir, name));
// npm packages stay external; workspace packages (@workspace/*) are TypeScript sources, so they are bundled.
const externalNpm = { name: "external-npm", setup(b) { b.onResolve({ filter: /^[^./]/ }, (args) => (args.kind === "entry-point" || args.path.startsWith("@workspace/") ? undefined : { path: args.path, external: true })); } };
await build({ entryPoints: entries, outdir: out, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, plugins: [externalNpm], logLevel: "warning" });
const result = spawnSync(process.execPath, ["--test", ...entries.map((file) => path.join(out, path.basename(file).replace(/\.ts$/, ".mjs")))], { stdio: "inherit" });
process.exit(result.status ?? 1);
