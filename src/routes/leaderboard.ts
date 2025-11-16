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

    // --- CURRENT WORK WEEK WINDOW ---
    // We treat dates Mon–Fri as the mornings for Sun–Thu nights.
    const now = new Date();
    const utcDay = now.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat

    // Find Monday (day 1) of this week at 00:00 UTC
    // diffToMonday: 0 if Mon, 1 if Tue, ..., 6 if Sun
    const diffToMonday = (utcDay + 6) % 7;
    const mondayThisWeek = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - diffToMonday,
        0,
        0,
        0,
        0
      )
    );

    // Next Monday at 00:00 UTC
    const nextMonday = new Date(
      Date.UTC(
        mondayThisWeek.getUTCFullYear(),
        mondayThisWeek.getUTCMonth(),
        mondayThisWeek.getUTCDate() + 7,
        0,
        0,
        0,
        0
      )
    );

    // --- WHO IS INCLUDED? (YOU + FRIENDS) ---
    const relations = await prisma.friend.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
      },
    });

    const friendIds = relations.map((rel) =>
      rel.userId === userId ? rel.friendId : rel.userId
    );
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

    // --- FETCH NIGHTS ONLY FOR THIS WEEK ---
    const nights = await prisma.sleepNight.findMany({
      where: {
        userId: { in: userIds },
        date: {
          gte: mondayThisWeek,
          lt: nextMonday,
        },
      },
    });

    // Keep ONLY Mon–Fri dates -> which represent Sun–Thu nights
    const workNights = nights.filter((night) => {
      const day = night.date.getUTCDay(); // 1..5 = Mon..Fri
      return day >= 1 && day <= 5;
    });

    // --- AGGREGATE PER USER ---
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

    const rows: LeaderboardRow[] = userIds.map((id) => {
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

    // --- THREE LEADERBOARDS ---
    // survivalist: least total sleep wins
    const survivalist = [...rows].sort(
      (a, b) => a.totalSleepMinutes - b.totalSleepMinutes
    );

    // tomRemmer: most REM
    const tomRemmer = [...rows].sort(
      (a, b) => b.remSleepMinutes - a.remSleepMinutes
    );

    // rollingInTheDeep: most deep
    const rollingInTheDeep = [...rows].sort(
      (a, b) => b.deepSleepMinutes - a.deepSleepMinutes
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
