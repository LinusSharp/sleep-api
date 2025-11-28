// --- START OF FILE leaderboard.ts ---

import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type LeaderboardUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  points: number; // The scoring metric
  value: number; // The raw time metric (total minutes sum)
  nightsLogged: number; // How many nights participated
};

type LeaderboardQuery = {
  scope?: "friends" | "clan";
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

      // 1. DETERMINE DATE RANGE (Mon 00:00 UTC -> Now)
      const now = new Date();
      const utcDay = now.getUTCDay(); // 0 (Sun) - 6 (Sat)
      const diffToMonday = utcDay === 0 ? 6 : utcDay - 1;

      const startOfWeek = new Date(now);
      startOfWeek.setUTCDate(now.getUTCDate() - diffToMonday);
      startOfWeek.setUTCHours(0, 0, 0, 0);

      // 2. IDENTIFY USERS
      let targetUserIds: string[] = [userId];

      if (scope === "clan") {
        const currentUserData = await prisma.user.findUnique({
          where: { id: userId },
          select: { groupId: true },
        });

        if (!currentUserData?.groupId) {
          return {
            leaderboards: {
              survivalist: [],
              hibernator: [], // New Category
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
          date: { gte: startOfWeek },
        },
      });

      const userDetails = await prisma.user.findMany({
        where: { id: { in: targetUserIds } },
        select: { id: true, displayName: true, email: true, avatarUrl: true },
      });
      const userMap = new Map(userDetails.map((u) => [u.id, u]));

      // 4. PREPARE DAILY BUCKETS
      // We need to process each day individually to award points
      type DayStat = {
        userId: string;
        total: number;
        rem: number;
        deep: number;
      };

      // Group nights by Date String (YYYY-MM-DD)
      const nightsByDate = new Map<string, DayStat[]>();

      rawNights.forEach((night) => {
        // Filter invalid nights (< 45 mins)
        if (night.totalSleepMinutes < 45) return;

        const dateKey = night.date.toISOString().split("T")[0];
        if (!nightsByDate.has(dateKey)) {
          nightsByDate.set(dateKey, []);
        }
        nightsByDate.get(dateKey)?.push({
          userId: night.userId,
          total: night.totalSleepMinutes,
          rem: night.remSleepMinutes,
          deep: night.deepSleepMinutes,
        });
      });

      // 5. HELPER TO CALCULATE POINTS
      const calculateBoard = (
        metricFn: (stat: DayStat) => number,
        sortAscending: boolean
      ) => {
        // Initialize maps for aggregation
        const userPoints = new Map<string, number>();
        const userValueSum = new Map<string, number>();
        const userNightsLogged = new Map<string, number>();

        targetUserIds.forEach((id) => {
          userPoints.set(id, 0);
          userValueSum.set(id, 0);
          userNightsLogged.set(id, 0);
        });

        // Iterate over every day that has data
        nightsByDate.forEach((stats) => {
          // Sort the day's stats
          stats.sort((a, b) => {
            const valA = metricFn(a);
            const valB = metricFn(b);
            return sortAscending ? valA - valB : valB - valA;
          });

          // Award Points for this day
          stats.forEach((stat, index) => {
            const points =
              index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 1 : 0;

            // Accumulate Points
            const currentPts = userPoints.get(stat.userId) || 0;
            userPoints.set(stat.userId, currentPts + points);

            // Accumulate Raw Value (Time)
            const currentVal = userValueSum.get(stat.userId) || 0;
            userValueSum.set(stat.userId, currentVal + metricFn(stat));

            // Accumulate Nights count
            const currentLog = userNightsLogged.get(stat.userId) || 0;
            userNightsLogged.set(stat.userId, currentLog + 1);
          });
        });

        // Convert to Array & Final Sort
        const result: LeaderboardUser[] = [];
        targetUserIds.forEach((id) => {
          const u = userMap.get(id);
          const logged = userNightsLogged.get(id) || 0;

          // Only include if they logged at least once
          if (logged > 0) {
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

        // Final Sort: Most Points wins. Tie-breaker: Best Total Value
        return result.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          // If tied on points, use raw value as tiebreaker
          // For ascending (Survivalist), lower value is better
          return sortAscending ? a.value - b.value : b.value - a.value;
        });
      };

      // 6. GENERATE BOARDS

      // Survivalist: Least Total Sleep -> Ascending
      const survivalist = calculateBoard((s) => s.total, true);

      // Hibernator: Most Total Sleep -> Descending
      const hibernator = calculateBoard((s) => s.total, false);

      // Tom REM-er: Most REM -> Descending
      const tomRemmer = calculateBoard((s) => s.rem, false);

      // Rolling in the Deep: Most Deep -> Descending
      const rollingInTheDeep = calculateBoard((s) => s.deep, false);

      return {
        leaderboards: {
          survivalist,
          hibernator,
          tomRemmer,
          rollingInTheDeep,
        },
      };
    }
  );
}
