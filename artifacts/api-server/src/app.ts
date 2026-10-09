import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimit } from "./lib/rate-limit";

const app: Express = express();

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors());
app.use(rateLimit({ windowMs: 60_000, max: 240 }));
// PDF imports arrive base64-encoded (8 MB file ≈ 11 MB body).
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "That upload is too large." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json", message: "Request could not be read." });
  logger.error({ err: err.message }, "Unhandled error");
  return res.status(500).json({ error: "server_error", message: "Something went wrong on our side. Try again." });
});

export default app;
