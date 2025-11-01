import express from "express";
import cors from "cors";
import path from "node:path";
import { ENV } from "./env";
import { authRouter } from "./routes/auth";
import { profileRouter } from "./routes/profile";

export function createApp() {
  const app = express();

  app.use(cors({
    origin: ["http://localhost:3000"],
    credentials: true,
  }));
  app.use(express.json());
  app.use(
    "/uploads",
    express.static(path.join(process.cwd(), "uploads"), {
      fallthrough: true,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/profile", profileRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error", err);
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}

export function startServer() {
  const app = createApp();
  const server = app.listen(ENV.PORT, () => {
    console.log(`API listening on http://localhost:${ENV.PORT}`);
  });
  return server;
}
