import "./functions-env";
import { onRequest } from "firebase-functions/https";
import app from "./app";

/**
 * The API as one HTTPS Cloud Function. Firebase Hosting forwards /api/** to
 * it (firebase.json), so the app and website use https://<project>.web.app.
 * Deploy with `firebase deploy`; settings and keys come from functions/.env.
 */
export const api = onRequest(
  // 300 s: an e-way bill call can take up to ~140 s (45 s timeout, retried on 429/502), which must finish before the instance is stopped.
  { region: "asia-south1", memory: "512MiB", timeoutSeconds: 300, maxInstances: 10, concurrency: 80 },
  app,
);
