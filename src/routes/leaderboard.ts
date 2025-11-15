import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type LeaderboardRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
  totalSleepMinutes: number;
  remSleepMinutes: number;
  deepSleepMinutes: number;
};

export async function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard", async (request, reply) => {
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

    // Find all friend ids
    const relations = await prisma.friend.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
      },
    });

    const friendIds = relations.map((rel) =>
      rel.userId === userId ? rel.friendId : rel.userId
    );

    // Leaderboard is "me + friends"
    const userIds = Array.from(new Set([userId, ...friendIds]));

    if (userIds.length === 0) {
      return {
        leaderboards: {
          survivalist: [] as LeaderboardRow[],
          tomRemmer: [] as LeaderboardRow[],
          rollingInTheDeep: [] as LeaderboardRow[],
        },
      };
    }

    // All nights in range for these users
    const nights = await prisma.sleepNight.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: from },
      },
    });

    // Keep only work nights: Sunday (0) -> Thursday (4)
    const workNights = nights.filter((night) => {
      const day = night.date.getUTCDay();
      return day >= 0 && day <= 4;
    });

    // Aggregate per user
    const statsByUserId = new Map<
      string,
      {
        totalSleepMinutes: number;
        remSleepMinutes: number;
        deepSleepMinutes: number;
      }
    >();

    for (const id of userIds) {
      statsByUserId.set(id, {
        totalSleepMinutes: 0,
        remSleepMinutes: 0,
        deepSleepMinutes: 0,
      });
    }

    for (const night of workNights) {
      const stats = statsByUserId.get(night.userId);
      if (!stats) continue;
      stats.totalSleepMinutes += night.totalSleepMinutes ?? 0;
      stats.remSleepMinutes += night.remSleepMinutes ?? 0;
      stats.deepSleepMinutes += night.deepSleepMinutes ?? 0;
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
    });

    const usersById = new Map(users.map((u) => [u.id, u]));

    const baseRows: LeaderboardRow[] = userIds.map((id) => {
      const u = usersById.get(id);
      const stats = statsByUserId.get(id)!;
      return {
        userId: id,
        displayName: u?.displayName ?? null,
        email: u?.email ?? null,
        totalSleepMinutes: stats.totalSleepMinutes,
        remSleepMinutes: stats.remSleepMinutes,
        deepSleepMinutes: stats.deepSleepMinutes,
      };
    });

    const survivalist = [...baseRows].sort(
      (a, b) => (a.totalSleepMinutes ?? 0) - (b.totalSleepMinutes ?? 0)
    );
    const tomRemmer = [...baseRows].sort(
      (a, b) => (b.remSleepMinutes ?? 0) - (a.remSleepMinutes ?? 0)
    );
    const rollingInTheDeep = [...baseRows].sort(
      (a, b) => (b.deepSleepMinutes ?? 0) - (a.deepSleepMinutes ?? 0)
    );

    return {
      leaderboards: {
        survivalist,
        tomRemmer,
        rollingInTheDeep,
      },
    };
  });
}
