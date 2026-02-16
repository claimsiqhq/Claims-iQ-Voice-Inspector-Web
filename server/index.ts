import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { registerRoutes } from "./routes";
import { registerAuditLogSubscriber } from "./subscribers/auditLog";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureStorageBuckets } from "./supabase";
import { seedInspectionFlows } from "./seed-flows";
// seed-catalog removed — only real Xactimate data is used
import pinoInstance, { logger as appLogger } from "./logger";

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "*.supabase.co"],
              connectSrc: [
                "'self'",
                "*.supabase.co",
                "api.openai.com",
                "wss://*.openai.com",
              ],
              mediaSrc: ["'self'", "blob:"],
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
      ignore: (req) => req.url === "/health" || req.url === "/readiness",
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode} FAILED`,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

const openApiSpec = parse(readFileSync(path.resolve("docs/openapi.yaml"), "utf-8"));
app.get("/docs", (_req, res) => res.redirect(301, "/api-docs/"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customCss: ".swagger-ui .topbar { display: none }" }));

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
  appLogger.info(source, message);
}

(async () => {
  await ensureStorageBuckets().catch((e) => appLogger.error("ERROR", "Storage bucket init", e));
  await seedInspectionFlows().catch((e) => appLogger.error("ERROR", "Flow seed", e));
  // seedCatalog removed — only real Xactimate data is used
  registerAuditLogSubscriber();
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    (req as any).log?.error?.(
      { err, statusCode: status, path: req.path, method: req.method },
      `Unhandled error: ${err.message}`
    ) || appLogger.error("ERROR", `Unhandled error: ${err.message}`, err);

    if (res.headersSent) {
      return next(err);
    }

    const clientMessage = status >= 500 ? "Internal server error" : (err.message || "An error occurred");
    return res.status(status).json({ message: clientMessage });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      appLogger.info("SERVER", `Application started on port ${port}`);
    }
  );
})();
