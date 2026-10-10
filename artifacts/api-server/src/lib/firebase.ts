import { getApps, initializeApp } from "firebase-admin/app";
import { projectId } from "./auth";

/**
 * The Firebase Admin app. Credentials come from Application Default
 * Credentials: the function's service account on Cloud Functions, or
 * GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON file) on a
 * developer machine.
 */
export function firebaseApp() {
  return getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);
}
