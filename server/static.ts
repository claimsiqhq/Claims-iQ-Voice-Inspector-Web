import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import pinoInstance from "./logger";

const rootDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

function findPublicDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(rootDir, "public"),
    path.join(cwd, "dist", "public"),
    path.join(cwd, "public"),
    path.resolve(rootDir, "..", "public"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      return p;
    }
  }
  return null;
}

export function serveStatic(app: Express) {
  const distPath = findPublicDir();
  if (!distPath) {
    pinoInstance.warn("Could not find dist/public — static files may be served by CDN. API-only mode.");
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.status(503).json({
        message: "Static assets not available. Ensure client is built and dist/public exists.",
      });
    });
    return;
  }

  app.use(express.static(distPath));

  // SPA fallback: serve index.html for non-API, non-file requests only
  // Never serve index.html for /assets/ — missing CSS/JS should 404, not return HTML
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/assets/")) return next();
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
