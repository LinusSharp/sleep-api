import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type LeaderboardUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  points: number;
  value: number;
  nightsLogged: number;
};

type LeaderboardQuery = {
  scope?: "friends" | "clan";
  offset?: number;
};

export async function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get<{ Querystring: LeaderboardQuery }>(
    "/leaderboard",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const userId = user.id;
      const scope = request.query.scope || "friends";
      const offset = request.query.offset ? Number(request.query.offset) : 0;

      // 1. DETERMINE DATE RANGE (Monday to Monday)
      const now = new Date();
      const utcDay = now.getUTCDay(); // 0 (Sun) - 6 (Sat)
      const diffToMonday = utcDay === 0 ? 6 : utcDay - 1;

      const startOfWeek = new Date(now);
      startOfWeek.setUTCDate(now.getUTCDate() - diffToMonday - offset * 7);
      startOfWeek.setUTCHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 7);

      // 2. IDENTIFY USERS
      let targetUserIds: string[] = [userId];

      if (scope === "clan") {
        const currentUserData = await prisma.user.findUnique({
          where: { id: userId },
          select: { groupId: true },
        });

        if (!currentUserData?.groupId) {
          // Return empty structure if not in clan
          return {
            leaderboards: {
              survivalist: [],
              hibernator: [],
              tomRemmer: [],
              rollingInTheDeep: [],
            },
          };
        }

        const clanMembers = await prisma.user.findMany({
          where: { groupId: currentUserData.groupId },
          select: { id: true },
        });
        targetUserIds = clanMembers.map((u) => u.id);
      } else {
        const relations = await prisma.friend.findMany({
          where: {
            OR: [{ userId }, { friendId: userId }],
          },
        });
        const friendIds = relations.map((rel) =>
          rel.userId === userId ? rel.friendId : rel.userId
        );
        targetUserIds = [...targetUserIds, ...friendIds];
      }

      targetUserIds = Array.from(new Set(targetUserIds));

      // 3. FETCH DATA
      const rawNights = await prisma.sleepNight.findMany({
        where: {
          userId: { in: targetUserIds },
          date: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
        },
      });

      const userDetails = await prisma.user.findMany({
        where: { id: { in: targetUserIds } },
        select: { id: true, displayName: true, email: true, avatarUrl: true },
      });
      const userMap = new Map(userDetails.map((u) => [u.id, u]));

      // 4. PREPARE BUCKETS
      type DayStat = {
        userId: string;
        total: number;
        rem: number;
        deep: number;
      };

      const nightsByDate = new Map<string, DayStat[]>();

      rawNights.forEach((night) => {
        if (night.totalSleepMinutes < 45) return;
        const dateKey = night.date.toISOString().split("T")[0];
        if (!nightsByDate.has(dateKey)) nightsByDate.set(dateKey, []);
        nightsByDate.get(dateKey)?.push({
          userId: night.userId,
          total: night.totalSleepMinutes,
          rem: night.remSleepMinutes,
          deep: night.deepSleepMinutes,
        });
      });

      // 5. CALCULATE POINTS
      const calculateBoard = (
        metricFn: (stat: DayStat) => number,
        sortAscending: boolean
      ) => {
        const userPoints = new Map<string, number>();
        const userValueSum = new Map<string, number>();
        const userNightsLogged = new Map<string, number>();

        targetUserIds.forEach((id) => {
          userPoints.set(id, 0);
          userValueSum.set(id, 0);
          userNightsLogged.set(id, 0);
        });

        nightsByDate.forEach((stats) => {
          stats.sort((a, b) => {
            const valA = metricFn(a);
            const valB = metricFn(b);
            return sortAscending ? valA - valB : valB - valA;
          });

          stats.forEach((stat, index) => {
            const points =
              index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 1 : 0;
            userPoints.set(
              stat.userId,
              (userPoints.get(stat.userId) || 0) + points
            );
            userValueSum.set(
              stat.userId,
              (userValueSum.get(stat.userId) || 0) + metricFn(stat)
            );
            userNightsLogged.set(
              stat.userId,
              (userNightsLogged.get(stat.userId) || 0) + 1
            );
          });
        });

        const result: LeaderboardUser[] = [];
        targetUserIds.forEach((id) => {
          const logged = userNightsLogged.get(id) || 0;
          if (logged > 0) {
            const u = userMap.get(id);
            result.push({
              userId: id,
              displayName: u?.displayName ?? null,
              email: u?.email ?? null,
              avatarUrl: u?.avatarUrl ?? null,
              points: userPoints.get(id) || 0,
              value: userValueSum.get(id) || 0,
              nightsLogged: logged,
            });
          }
        });

        return result.sort((a, b) => b.points - a.points);
      };

      return {
        leaderboards: {
          survivalist: calculateBoard((s) => s.total, true), // Least sleep
          hibernator: calculateBoard((s) => s.total, false), // Most sleep
          tomRemmer: calculateBoard((s) => s.rem, false), // Most REM
          rollingInTheDeep: calculateBoard((s) => s.deep, false), // Most Deep
        },
      };
    }
  );
}
