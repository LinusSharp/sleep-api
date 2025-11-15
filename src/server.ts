import Fastify from "fastify";
import { registerSleepRoutes } from "./routes/sleep";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // register routes
  registerSleepRoutes(app);

  return app;
}
