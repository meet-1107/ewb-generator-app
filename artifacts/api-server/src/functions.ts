import "./functions-env";
import { onRequest } from "firebase-functions/https";
import app from "./app";

/**
 * The API as one HTTPS Cloud Function. Firebase Hosting forwards /api/** to
 * it (firebase.json), so the app and website use https://<project>.web.app.
 * Deploy with `firebase deploy`; settings and keys come from functions/.env.
 */
export const api = onRequest(
  { region: "asia-south1", memory: "512MiB", timeoutSeconds: 120, maxInstances: 10, concurrency: 80 },
  app,
);
