import { projectId } from "./auth";
import { readDoc, withDoc } from "./store";

/**
 * Road distance between two Indian PIN codes, from the Google Routes API.
 * On Cloud Functions it calls Google as the function's own service account
 * (enable "Routes API" in the project); elsewhere set GOOGLE_MAPS_API_KEY.
 * Each PIN pair is looked up once and then served from the `distances` store.
 */

export class DistanceError extends Error {
  constructor(readonly code: "not_configured" | "no_route" | "unavailable", message: string) {
    super(message);
  }
}

type Saved = { km: number; meters: number; checkedAt: string; source: "google-routes" };

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const apiKey = process.env["GOOGLE_MAPS_API_KEY"] ?? "";

export const distanceConfigured = Boolean(apiKey || (projectId && process.env["K_SERVICE"]));

async function authHeaders(): Promise<Record<string, string>> {
  if (apiKey) return { "X-Goog-Api-Key": apiKey };
  if (!projectId || !process.env["K_SERVICE"]) throw new DistanceError("not_configured", "Distance lookup is not set up on the server.");
  const { firebaseApp } = await import("./firebase");
  const credential = firebaseApp().options.credential;
  if (!credential) throw new DistanceError("not_configured", "Distance lookup is not set up on the server.");
  const { access_token } = await credential.getAccessToken();
  return { Authorization: `Bearer ${access_token}`, "X-Goog-User-Project": projectId };
}

async function lookup(from: string, to: string): Promise<Saved> {
  let response: Response;
  try {
    response = await fetch(ROUTES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-FieldMask": "routes.distanceMeters", ...(await authHeaders()) },
      body: JSON.stringify({ origin: { address: `${from}, India` }, destination: { address: `${to}, India` }, travelMode: "DRIVE", regionCode: "IN" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DistanceError) throw error;
    throw new DistanceError("unavailable", "Could not reach Google for the distance.");
  }
  if (!response.ok) throw new DistanceError("unavailable", `Google answered ${response.status}.`);
  const body = (await response.json()) as { routes?: { distanceMeters?: number }[] };
  const meters = body.routes?.[0]?.distanceMeters;
  if (meters === undefined) throw new DistanceError("no_route", "Google found no road route between these PIN codes.");
  return { km: Math.max(1, Math.ceil(meters / 1000)), meters, checkedAt: new Date().toISOString(), source: "google-routes" };
}

const inFlight = new Map<string, Promise<Saved & { cached: boolean }>>();

export function roadDistance(from: string, to: string): Promise<Saved & { cached: boolean }> {
  const key = `${from}-${to}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const saved = await readDoc<Saved>("distances", key);
    if (saved) return { ...saved, cached: true };
    const fresh = await lookup(from, to);
    await withDoc<Saved, null>("distances", key, () => ({ next: fresh, result: null }));
    return { ...fresh, cached: false };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}
