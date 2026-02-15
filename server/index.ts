import express from "express";
import { createServer } from "http";
import { authRouter } from "./routes/auth";
import { claimsRouter } from "./routes/claims";
import { photolabRouter } from "./routes/photolab";
import { inspectionRouter } from "./routes/inspection";
import { realtimeRouter } from "./routes/realtime";
import { exportRouter } from "./routes/export";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// CORS for mobile app
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use("/api/auth", authRouter());
app.use("/api/claims", claimsRouter());
app.use("/api/photolab", photolabRouter());
app.use("/api", inspectionRouter());
app.use("/api/realtime", realtimeRouter());
app.use("/api", exportRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = createServer(app);
const port = Number(process.env.PORT) || 5000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://localhost:${port}`);
});
