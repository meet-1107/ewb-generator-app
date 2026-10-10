// Builds the API as a Firebase Cloud Function into ../../functions/dist.
// Runs automatically before `firebase deploy` (firebase.json predeploy).
//   1. checks functions/.env and adds the server secrets on the first run
//   2. installs the function's runtime packages (npm, in functions/)
//   3. bundles src/functions.ts with esbuild
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const functionsDir = path.resolve(artifactDir, "../../functions");
const envFile = path.join(functionsDir, ".env");
const rel = (file) => path.relative(process.cwd(), file) || file;

// Exit code 2: on Windows the Firebase CLI misreports exit code 1 from a predeploy hook as "spawn … ENOENT".
function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(2);
}

/* 1. functions/.env */
if (!existsSync(envFile)) {
  copyFileSync(path.join(functionsDir, ".env.example"), envFile);
  stop(`Created ${rel(envFile)}. Open it, add your GSTINAPI_KEY and RESEND_API_KEY, save, then run "firebase deploy" again.`);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split(/\r?\n/)
    .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.trim().replace(/^(["'])(.*)\1$/, "$2")]),
);
// Names Firebase sets itself (firebase-tools refuses a .env that uses them).
const RESERVED = ["CLOUD_RUNTIME_CONFIG", "EVENTARC_CLOUD_EVENT_SOURCE", "ENTRY_POINT", "GCP_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"];
const reserved = Object.keys(env).filter((key) => /^(FIREBASE_|X_GOOGLE_|EXT_|KIT_|FUNCTION_)/.test(key) || RESERVED.includes(key));
if (reserved.length) stop(`Remove ${reserved.join(", ")} from ${rel(envFile)}: Firebase reserves these names and sets them itself.`);
if (/gak_your_key/.test(env.GSTINAPI_KEY ?? "") || /re_your_key/.test(env.RESEND_API_KEY ?? "")) {
  stop(`Put your real GSTINAPI_KEY and RESEND_API_KEY in ${rel(envFile)} (they still say "your_key"), save, then run "firebase deploy" again.`);
}
for (const key of ["GSTINAPI_KEY", "RESEND_API_KEY"]) if (!env[key]) console.warn(`Warning: ${key} is empty in ${rel(envFile)}.`);

const generated = { OTP_PEPPER: 32, EWB_CREDENTIALS_SECRET: 32, WALLET_ADMIN_TOKEN: 24 };
const missing = Object.keys(generated).filter((key) => !env[key]);
if (missing.length) {
  const lines = missing.map((key) => `${key}=${randomBytes(generated[key]).toString("hex")}`);
  appendFileSync(envFile, `\n# Generated on first deploy. Keep these: changing EWB_CREDENTIALS_SECRET makes saved portal logins unreadable.\n${lines.join("\n")}\n`);
  console.log(`Added ${missing.join(", ")} to ${rel(envFile)}. Keep that file safe.`);
}

/* 2. runtime packages */
const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: functionsDir, stdio: "inherit", shell: true });
if (install.status !== 0) stop("npm install in functions/ failed (see above).");

/* 3. bundle */
const outdir = path.join(functionsDir, "dist");
rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: { index: path.join(artifactDir, "src/functions.ts") },
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outdir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  // Installed in functions/node_modules by Cloud Build (they load files at runtime, so they cannot be bundled).
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*", "*.node"],
  sourcemap: "linked",
  plugins: [esbuildPluginPino({ transports: [] })],
  // Lets bundled CommonJS packages (express, …) use require/__dirname in ESM output.
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});
