import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type LeaderboardRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  totalSleepMinutes: number;
  remSleepMinutes: number;
  deepSleepMinutes: number;
  nightsLogged: number;
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
      const scope = request.query.scope || "friends"; // Default to friends

      // 1. DETERMINE DATE RANGE (Current Week: Mon 00:00 UTC -> Now)
      const now = new Date();
      const utcDay = now.getUTCDay(); // 0 (Sun) - 6 (Sat)
      // Calculate days to subtract to get to the previous Monday
      // If Sun(0), subtract 6. If Mon(1), subtract 0. If Tue(2), subtract 1.
      const diffToMonday = utcDay === 0 ? 6 : utcDay - 1;

      const startOfWeek = new Date(now);
      startOfWeek.setUTCDate(now.getUTCDate() - diffToMonday);
      startOfWeek.setUTCHours(0, 0, 0, 0); // Midnight Monday UTC

      // 2. IDENTIFY USERS TO INCLUDE
      let targetUserIds: string[] = [userId]; // Always include self

      if (scope === "clan") {
        // Fetch current user's group
        const currentUserData = await prisma.user.findUnique({
          where: { id: userId },
          select: { groupId: true },
        });

        if (!currentUserData?.groupId) {
          // User not in a clan, return empty leaderboards
          return {
            leaderboards: {
              survivalist: [],
              tomRemmer: [],
              rollingInTheDeep: [],
            },
            userRank: null,
          };
        }

        // Fetch all members of this group
        const clanMembers = await prisma.user.findMany({
          where: { groupId: currentUserData.groupId },
          select: { id: true },
        });
        targetUserIds = clanMembers.map((u) => u.id);
      } else {
        // Friends Scope
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

      // Remove duplicates just in case
      targetUserIds = Array.from(new Set(targetUserIds));

      // 3. FETCH DATA & AGGREGATE
      // We fetch sleep nights for these users within the date range
      const rawNights = await prisma.sleepNight.findMany({
        where: {
          userId: { in: targetUserIds },
          date: { gte: startOfWeek },
        },
      });

      // We fetch User details for display names
      const userDetails = await prisma.user.findMany({
        where: { id: { in: targetUserIds } },
        select: { id: true, displayName: true, email: true, avatarUrl: true },
      });
      const userMap = new Map(userDetails.map((u) => [u.id, u]));

      // Aggregation Map
      const statsMap = new Map<string, LeaderboardRow>();

      // Initialize everyone with 0
      targetUserIds.forEach((id) => {
        const u = userMap.get(id);
        statsMap.set(id, {
          userId: id,
          displayName: u?.displayName ?? null,
          email: u?.email ?? null,
          avatarUrl: u?.avatarUrl ?? null,
          totalSleepMinutes: 0,
          remSleepMinutes: 0,
          deepSleepMinutes: 0,
          nightsLogged: 0,
        });
      });

      // Process Nights
      for (const night of rawNights) {
        const stats = statsMap.get(night.userId);
        if (!stats) continue;

        // ANTI-CHEAT: Ignore "naps" or fake entries < 45 mins for the leaderboard totals
        if (night.totalSleepMinutes < 45) continue;

        stats.totalSleepMinutes += night.totalSleepMinutes;
        stats.remSleepMinutes += night.remSleepMinutes;
        stats.deepSleepMinutes += night.deepSleepMinutes;
        stats.nightsLogged += 1;
      }

      // Convert to Array
      const allRows = Array.from(statsMap.values());

      // 4. BUILD LEADERBOARDS
      // Filter: Users must have logged at least 1 valid night to appear on the board
      // This prevents users with 0 minutes (inactive) from winning "Least Sleep"
      const activeRows = allRows.filter((r) => r.nightsLogged > 0);

      // A. Survivalist (Least Sleep Wins) - Ascending
      const survivalist = [...activeRows].sort(
        (a, b) => a.totalSleepMinutes - b.totalSleepMinutes
      );

      // B. Tom Remmer (Most REM Wins) - Descending
      const tomRemmer = [...activeRows].sort(
        (a, b) => b.remSleepMinutes - a.remSleepMinutes
      );

      // C. Rolling in the Deep (Most Deep Wins) - Descending
      const rollingInTheDeep = [...activeRows].sort(
        (a, b) => b.deepSleepMinutes - a.deepSleepMinutes
      );

      return {
        leaderboards: {
          survivalist,
          tomRemmer,
          rollingInTheDeep,
        },
      };
    }
  );
}
