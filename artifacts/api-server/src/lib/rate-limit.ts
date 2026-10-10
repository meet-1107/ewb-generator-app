import type { NextFunction, Request, Response } from "express";

/** Fixed-window limiter per client address. Use a shared store (Redis) when running multiple instances. */
/** `by: "workspace"` counts per signed-in workspace (use after requireWorkspace), for calls that cost money per request. */
export function rateLimit({ windowMs, max, by = "address" }: { windowMs: number; max: number; by?: "address" | "workspace" }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    // Keyed by address only: a client-chosen header must not buy a fresh allowance.
    const key = by === "workspace" ? `ws:${req.workspaceId}` : req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests. Wait a moment and try again." });
    }
    return next();
  };
}
