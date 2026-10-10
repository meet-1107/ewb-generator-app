// Builds the web version into dist/ for Firebase Hosting. Runs automatically
// before `firebase deploy` (firebase.json predeploy).
//
// The web sign-in needs the project's Firebase web-app config. It is taken
// from EXPO_PUBLIC_FIREBASE_* (environment or this folder's .env) when set;
// otherwise it is downloaded with the Firebase CLI, creating the web app
// "E-Way Easy Web" the first time.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "../..");

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8").split(/\r?\n/)
      .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^(["'])(.*)\1$/, "$2")]),
  );
}

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    return JSON.parse(readFileSync(path.join(repoDir, ".firebaserc"), "utf8")).projects.default;
  } catch {
    return "";
  }
}

/** Runs the Firebase CLI with --json and returns its `result`. */
function firebase(args) {
  const run = spawnSync("firebase", [...args, "--json", "--non-interactive"], { cwd: repoDir, encoding: "utf8", shell: true });
  let output;
  try {
    output = JSON.parse(run.stdout);
  } catch {
    return { ok: false, error: (run.stderr || run.stdout || "firebase CLI not found").trim() };
  }
  return output.status === "success" ? { ok: true, result: output.result } : { ok: false, error: output.error ?? "unknown error" };
}

function downloadWebConfig(project) {
  const listed = firebase(["apps:list", "WEB", "--project", project]);
  if (!listed.ok) stop(`Could not list the Firebase apps of ${project}: ${listed.error}`);
  let appId = listed.result?.[0]?.appId;
  if (!appId) {
    console.log(`Creating the Firebase web app "E-Way Easy Web" in ${project}…`);
    const created = firebase(["apps:create", "WEB", '"E-Way Easy Web"', "--project", project]);
    if (!created.ok) stop(`Could not create a Firebase web app: ${created.error}`);
    appId = created.result.appId;
  }
  const config = firebase(["apps:sdkconfig", "WEB", appId, "--project", project]);
  if (!config.ok) stop(`Could not download the web app config: ${config.error}`);
  return config.result.sdkConfig ?? JSON.parse(config.result.fileContents);
}

const fromFiles = { ...readEnvFile(path.join(appDir, ".env")), ...readEnvFile(path.join(appDir, ".env.local")) };
const configured = (key) => process.env[key] || fromFiles[key];
const env = { ...process.env, CI: "1" };

if (!configured("EXPO_PUBLIC_FIREBASE_API_KEY") || !configured("EXPO_PUBLIC_FIREBASE_APP_ID")) {
  const project = projectId();
  if (!project) stop("No Firebase project selected. Run: firebase use ewb---generator");
  const web = downloadWebConfig(project);
  Object.assign(env, {
    EXPO_PUBLIC_FIREBASE_API_KEY: web.apiKey,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: web.authDomain ?? `${project}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: web.projectId ?? project,
    EXPO_PUBLIC_FIREBASE_APP_ID: web.appId,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: web.storageBucket ?? "",
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId ?? "",
  });
  console.log(`Using the web app config of ${project} (${web.appId}).`);
}
// The website calls its own /api, which Firebase Hosting forwards to the "api" function.
env.EXPO_PUBLIC_API_URL = "";

// --clear: Metro caches files with EXPO_PUBLIC_* values inlined, so a changed config needs a fresh build.
const exported = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist", "--clear"], { cwd: appDir, env, stdio: "inherit", shell: true });
if (exported.status !== 0) stop("The web build failed (see above).");
