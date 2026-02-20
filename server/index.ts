import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import path from "path";
import pinoInstance from "./logger";

// Prevent unhandled errors from crashing the process on Cloud Run.
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

const cspAllowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const supabaseOrigin = (() => {
  try {
    const raw = process.env.SUPABASE_URL || "";
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();
const cspConnectSrc = [
  "'self'",
  "https://api.openai.com",
  "wss://api.openai.com",
  "https://weather.visualcrossing.com",
  ...cspAllowedOrigins,
  ...(supabaseOrigin ? [supabaseOrigin] : []),
];

// Bare-minimum health endpoint — responds before any middleware.
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production"
      ? {
          directives: {
            defaultSrc: ["'self'"],
            connectSrc: cspConnectSrc,
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : process.env.NODE_ENV === "production"
        ? false
        : true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 86400,
  })
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "30mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(
  pinoHttp({
    logger: pinoInstance,
    genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID(),
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode} FAILED`,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

try {
  const openApiPath = path.resolve("docs/openapi.yaml");
  if (existsSync(openApiPath)) {
    const { parse } = require("yaml");
    const swaggerUi = require("swagger-ui-express");
    const openApiSpec = parse(readFileSync(openApiPath, "utf-8"));
    app.get("/docs", (_req, res) => res.redirect(301, "/api-docs/"));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customCss: ".swagger-ui .topbar { display: none }" }));
  }
} catch {}

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts, please try again later" },
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI requests, please try again later" },
});

const realtimeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many realtime session requests, please try again later" },
});

const aiReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI review requests, please try again later" },
});

app.use("/api/", generalLimiter);
app.use("/api/auth/", authLimiter);
app.use("/api/claims/:id/parse", aiLimiter);
app.use("/api/claims/:id/parse-batch", aiLimiter);
app.use("/api/claims/:id/briefing", aiLimiter);
app.use("/api/inspection/:sessionId/photos/:photoId/analyze", aiLimiter);
app.use("/api/realtime/session", realtimeLimiter);
app.use("/api/inspection/:sessionId/review/ai", aiReviewLimiter);

export function log(message: string, source = "express") {
  console.log(`[${source}] ${message}`);
}

// ── BIND TO PORT IMMEDIATELY ─────────────────────────────────────────
// Replit autoscale (Cloud Run) sends SIGTERM if the container doesn't
// respond to health checks quickly. We listen FIRST, register routes after.
const port = parseInt(process.env.PORT || "5000", 10);

let appReady = false;
app.use((req, res, next) => {
  if (appReady || req.path.startsWith("/api") || req.path === "/health") return next();
  if (req.method === "GET" && req.accepts("html")) {
    res.status(200).set("Content-Type", "text/html").end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claims IQ</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;background:#F8F7FC;color:#342A4F}div{text-align:center}.spin{width:32px;height:32px;border:3px solid #e2ddf5;border-top-color:#7c3aed;border-radius:50%;animation:s 0.8s linear infinite;margin:0 auto 16px}@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div><div class="spin"></div><p>Loading Claims IQ...</p></div><script>setTimeout(()=>location.reload(),2000)</script></body></html>`);
    return;
  }
  next();
});

httpServer.listen({ port, host: "0.0.0.0" }, () => {
  console.log(`serving on port ${port}`);
});

// Graceful shutdown — allow in-flight requests to finish before exit
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
});

// ── ASYNC INIT (runs after port is open) ─────────────────────────────
(async () => {
  try {
    const { registerAuditLogSubscriber } = await import("./subscribers/auditLog");
    registerAuditLogSubscriber();

    const { registerRoutes } = await import("./routes");
    await registerRoutes(httpServer, app);

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      console.error(`Unhandled error: ${err.message}`, err);

      if (res.headersSent) {
        return next(err);
      }

      const clientMessage = status >= 500 ? "Internal server error" : (err.message || "An error occurred");
      return res.status(status).json({ message: clientMessage });
    });

    if (process.env.NODE_ENV === "production") {
      const { serveStatic } = await import("./static");
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    appReady = true;
    console.log("Routes registered successfully");

    // Background tasks — fire and forget.
    import("./supabase")
      .then((m) => m.ensureStorageBuckets())
      .catch((e) => console.error("Storage bucket init error:", e));
    import("./seed-flows")
      .then((m) => m.seedInspectionFlows())
      .catch((e) => console.error("Flow seed error:", e));
  } catch (err) {
    console.error("FATAL: Route registration failed:", err);
  }
})();
