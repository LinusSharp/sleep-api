import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerSleepRoutes } from "./routes/sleep";
import { registerFriendRoutes } from "./routes/friends";
import { registerLeaderboardRoutes } from "./routes/leaderboard";
import { registerMeRoutes } from "./routes/me";
import { verifySupabaseToken } from "./auth/verifyJwt";

export interface AuthenticatedRequest extends FastifyRequest {
  user?: { id: string; payload: any };
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // Auth hook for all /me, /friends, /sleep, /leaderboard
  app.addHook("preHandler", async (request, reply) => {
    const url = request.raw.url || "";
    if (
      !(
        url.startsWith("/sleep") ||
        url.startsWith("/friends") ||
        url.startsWith("/leaderboard") ||
        url.startsWith("/me")
      )
    ) {
      return;
    }

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

  registerMeRoutes(app);
  registerSleepRoutes(app);
  registerFriendRoutes(app);
  registerLeaderboardRoutes(app);

  return app;
}
