import type { NextFunction, Request, Response } from "express";

/** Fixed-window limiter per client address. Use a shared store (Redis) when running multiple instances. */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.header("x-workspace-id") ?? ""}`;
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
