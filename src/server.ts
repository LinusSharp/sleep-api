import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerSleepRoutes } from "./routes/sleep";
import { verifySupabaseToken } from "./auth/verifyJwt";

export interface AuthenticatedRequest extends FastifyRequest {
  user?: { id: string; payload: any };
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // Auth hook – for routes that need it
  app.addHook("preHandler", async (request, reply) => {
    // Only enforce auth for /sleep* for now
    if (!request.raw.url?.startsWith("/sleep")) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing Authorization header" });
    }

    const token = authHeader.slice("Bearer ".length).trim();

    try {
      const user = await verifySupabaseToken(token);
      (request as AuthenticatedRequest).user = user;
    } catch (err) {
      request.log.error({ err }, "JWT verification failed");
      return reply.status(401).send({ error: "Invalid token" });
    }
  });

  registerSleepRoutes(app);

  return app;
}
