import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type UploadBody = {
  date: string; // "2025-01-15"
  totalSleepMinutes: number; // 420
  remSleepMinutes: number; // 90
  deepSleepMinutes: number; // 110
};

export async function registerSleepRoutes(app: FastifyInstance) {
  // POST /sleep/upload – create/update one night
  app.post<{ Body: UploadBody }>("/sleep/upload", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const userId = user.id;

    const { date, totalSleepMinutes, remSleepMinutes, deepSleepMinutes } =
      request.body;

    if (!date || Number.isNaN(Date.parse(date))) {
      return reply.status(400).send({ error: "Invalid date" });
    }
    if (!Number.isFinite(totalSleepMinutes) || totalSleepMinutes <= 0) {
      return reply.status(400).send({ error: "Invalid totalSleepMinutes" });
    }
    if (!Number.isFinite(remSleepMinutes) || remSleepMinutes < 0) {
      return reply.status(400).send({ error: "Invalid remSleepMinutes" });
    }
    if (!Number.isFinite(deepSleepMinutes) || deepSleepMinutes < 0) {
      return reply.status(400).send({ error: "Invalid deepSleepMinutes" });
    }

    const dateObj = new Date(date);
    // normalize to midnight UTC
    dateObj.setUTCHours(0, 0, 0, 0);

    // 🔹 make sure there is a User row for this auth user
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        displayName: null,
        avatarUrl: null,
      },
    });

    const night = await prisma.sleepNight.upsert({
      where: {
        userId_date: {
          userId,
          date: dateObj,
        },
      },
      create: {
        userId,
        date: dateObj,
        totalSleepMinutes: Math.round(totalSleepMinutes),
        remSleepMinutes: Math.round(remSleepMinutes),
        deepSleepMinutes: Math.round(deepSleepMinutes),
        score: 0, // we can ignore score for now or compute later
      },
      update: {
        totalSleepMinutes: Math.round(totalSleepMinutes),
        remSleepMinutes: Math.round(remSleepMinutes),
        deepSleepMinutes: Math.round(deepSleepMinutes),
      },
    });

    return { ok: true, night };
  });

  // GET /sleep/me – recent nights for the current user
  app.get("/sleep/me", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const userId = user.id;

    const daysRaw = (request.query as any)?.days;
    const days = daysRaw ? Number(daysRaw) : 7;

    const from = new Date();
    from.setUTCDate(from.getUTCDate() - (Number.isFinite(days) ? days : 7));
    from.setUTCHours(0, 0, 0, 0);

    const nights = await prisma.sleepNight.findMany({
      where: {
        userId,
        date: { gte: from },
      },
      orderBy: { date: "desc" },
    });

    return { nights };
  });
}
