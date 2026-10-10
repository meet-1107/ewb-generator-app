/**
 * Runtime defaults for Cloud Functions. Imported before anything else by
 * functions.ts, so every module sees them when it loads.
 *
 * FIREBASE_* names are reserved in functions/.env, so the project ID comes
 * from the FIREBASE_CONFIG / GCLOUD_PROJECT variables Firebase sets.
 */
const config = (() => {
  try {
    return JSON.parse(process.env["FIREBASE_CONFIG"] ?? "{}") as { projectId?: string };
  } catch {
    return {};
  }
})();

process.env["FIREBASE_PROJECT_ID"] ||= config.projectId || process.env["GCLOUD_PROJECT"] || "";
process.env["STORE"] ||= "firestore";
process.env["NODE_ENV"] ||= "production";

export {};
