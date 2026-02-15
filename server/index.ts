import express from "express";
import { createServer } from "http";
import { setupVite } from "./vite";
import { authRouter } from "./routes/auth";
import { claimsRouter } from "./routes/claims";
import { photolabRouter } from "./routes/photolab";
const app = express();
const isDev = process.env.NODE_ENV !== "production";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/api/auth", authRouter());
app.use("/api/claims", claimsRouter());
app.use("/api/photolab", photolabRouter());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = createServer(app);

if (isDev) {
  await setupVite(server, app);
} else {
  const { serveStatic } = await import("./static");
  serveStatic(app);
}

const port = Number(process.env.PORT) || 5000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
