import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

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
      return { users: [] };
    }

    const grouped = await prisma.sleepNight.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        date: { gte: from },
      },
      _sum: {
        totalSleepMinutes: true,
        remSleepMinutes: true,
        deepSleepMinutes: true,
      },
    });

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
    });

    const usersById = new Map(users.map((u) => [u.id, u]));

    const leaderboard = grouped
      .map((row) => {
        const u = usersById.get(row.userId);
        return {
          userId: row.userId,
          displayName: u?.displayName ?? null,
          email: u?.email ?? null,
          totalSleepMinutes: row._sum.totalSleepMinutes ?? 0,
          remSleepMinutes: row._sum.remSleepMinutes ?? 0,
          deepSleepMinutes: row._sum.deepSleepMinutes ?? 0,
        };
      })
      .sort((a, b) => (b.totalSleepMinutes ?? 0) - (a.totalSleepMinutes ?? 0));

    return { users: leaderboard };
  });
}
