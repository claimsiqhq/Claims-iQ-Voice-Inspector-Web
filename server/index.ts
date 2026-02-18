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

// Bare-minimum health endpoint — responds before any middleware.
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
              styleSrcElem: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "blob:", "*.supabase.co"],
              connectSrc: [
                "'self'",
                "*.supabase.co",
                "api.openai.com",
                "wss://*.openai.com",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              mediaSrc: ["'self'", "blob:"],
              manifestSrc: ["'self'"],
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

app.use("/api/", generalLimiter);
app.use("/api/auth/", authLimiter);
app.use("/api/claims/:id/parse", aiLimiter);
app.use("/api/claims/:id/parse-batch", aiLimiter);
app.use("/api/claims/:id/briefing", aiLimiter);
app.use("/api/inspection/:sessionId/photos/:photoId/analyze", aiLimiter);

export function log(message: string, source = "express") {
  console.log(`[${source}] ${message}`);
}

// ── BIND TO PORT IMMEDIATELY ─────────────────────────────────────────
// Replit autoscale (Cloud Run) sends SIGTERM if the container doesn't
// respond to health checks quickly. We listen FIRST, register routes after.
const port = parseInt(process.env.PORT || "5000", 10);
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
