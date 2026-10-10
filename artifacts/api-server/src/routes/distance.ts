import { Router, type IRouter } from "express";
import { DistanceError, roadDistance } from "../lib/distance";

const router: IRouter = Router();
const PIN = /^[1-9]\d{5}$/;

/** GET /distance?from=411001&to=560001 → { km } road distance between two PIN codes. */
router.get("/distance", async (req, res) => {
  const from = String(req.query["from"] ?? "");
  const to = String(req.query["to"] ?? "");
  if (!PIN.test(from) || !PIN.test(to)) return res.status(400).json({ error: "bad_request", message: "Send two 6-digit PIN codes." });
  try {
    const result = await roadDistance(from, to);
    return res.json({ from, to, km: result.km, source: result.source, cached: result.cached });
  } catch (error) {
    if (error instanceof DistanceError) {
      const status = error.code === "not_configured" ? 503 : error.code === "no_route" ? 404 : 502;
      if (error.code === "unavailable") req.log?.warn({ err: error.message }, "Distance lookup failed");
      return res.status(status).json({ error: error.code, message: error.message });
    }
    req.log?.error({ err: (error as Error).message }, "Distance lookup failed");
    return res.status(502).json({ error: "unavailable", message: "Could not get the distance right now." });
  }
});

export default router;
