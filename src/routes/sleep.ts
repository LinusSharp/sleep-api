import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";

type UploadBody = {
  date: string; // e.g. "2025-01-15"
  totalSleepMinutes: number; // e.g. 420
  score: number; // simple int score
};

// TEMP auth: use x-user-id header until JWT is wired
function getUserIdFromHeader(headers: Record<string, any>): string | null {
  const raw = headers["x-user-id"] || headers["X-User-Id"];
  if (!raw || typeof raw !== "string") return null;
  return raw;
}

export async function registerSleepRoutes(app: FastifyInstance) {
  // Upload or update one night of sleep
  app.post<{
    Body: UploadBody;
  }>("/sleep/upload", async (request, reply) => {
    const userId = getUserIdFromHeader(request.headers);
    if (!userId) {
      return reply
        .status(400)
        .send({ error: "x-user-id header required (temporary auth)" });
    }

    const { date, totalSleepMinutes, score } = request.body;

    if (!date || Number.isNaN(Date.parse(date))) {
      return reply.status(400).send({ error: "Invalid date" });
    }
    if (!Number.isFinite(totalSleepMinutes) || totalSleepMinutes <= 0) {
      return reply.status(400).send({ error: "Invalid totalSleepMinutes" });
    }
    if (!Number.isFinite(score)) {
      return reply.status(400).send({ error: "Invalid score" });
    }

    const dateObj = new Date(date);
    // Normalize to midnight UTC
    dateObj.setUTCHours(0, 0, 0, 0);

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
        score: Math.round(score),
      },
      update: {
        totalSleepMinutes: Math.round(totalSleepMinutes),
        score: Math.round(score),
      },
    });

    return { ok: true, night };
  });

  // Get recent nights for the current user
  app.get("/sleep/me", async (request, reply) => {
    const userId = getUserIdFromHeader(request.headers);
    if (!userId) {
      return reply
        .status(400)
        .send({ error: "x-user-id header required (temporary auth)" });
    }

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
