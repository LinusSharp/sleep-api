import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

function generateGroupCode(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function registerGroupRoutes(app: FastifyInstance) {
  // GET /groups/me - Get my current group details
  app.get("/groups/me", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) return reply.status(401).send({ error: "unauthorized" });

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        group: {
          include: {
            members: {
              select: {
                id: true,
                displayName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return { group: userData?.group || null };
  });

  // POST /groups/create - Create a new clan with a random code
  app.post<{ Body: { name: string } }>(
    "/groups/create",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) return reply.status(401).send({ error: "unauthorized" });

      const { name } = request.body;
      if (!name || name.length < 3)
        return reply.status(400).send({ error: "Name too short" });

      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      if (currentUser?.groupId) {
        return reply
          .status(400)
          .send({ error: "You are already in a clan. Leave it first." });
      }

      const code = generateGroupCode();

      try {
        const group = await prisma.group.create({
          data: {
            name,
            code,
            members: {
              connect: { id: user.id },
            },
          },
          include: { members: true },
        });
        return { group };
      } catch (e: any) {
        if (e.code === "P2002") {
          return reply.status(400).send({ error: "Clan name already taken" });
        }
        throw e;
      }
    }
  );

  // POST /groups/join - Join clan by CODE
  app.post<{ Body: { code: string } }>(
    "/groups/join",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) return reply.status(401).send({ error: "unauthorized" });

      const { code } = request.body;

      const group = await prisma.group.findUnique({ where: { code } });

      if (!group) return reply.status(404).send({ error: "Invalid clan code" });

      await prisma.user.update({
        where: { id: user.id },
        data: { groupId: group.id },
      });

      return { success: true, groupId: group.id };
    }
  );

  // POST /groups/leave
  app.post("/groups/leave", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) return reply.status(401).send({ error: "unauthorized" });

    // Optional: If last member leaves, delete group?
    // For now, we just remove the user.
    await prisma.user.update({
      where: { id: user.id },
      data: { groupId: null },
    });

    return { success: true };
  });

  // POST /groups/rename - Rename the clan
  app.post<{ Body: { name: string } }>(
    "/groups/rename",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) return reply.status(401).send({ error: "unauthorized" });

      const { name } = request.body;
      if (!name || name.length < 3) {
        return reply
          .status(400)
          .send({ error: "Name too short (min 3 chars)" });
      }

      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { groupId: true },
      });

      if (!userData?.groupId) {
        return reply.status(400).send({ error: "Not in a clan" });
      }

      try {
        const updated = await prisma.group.update({
          where: { id: userData.groupId },
          data: { name },
        });
        return { success: true, group: updated };
      } catch (e: any) {
        if (e.code === "P2002") {
          return reply.status(400).send({ error: "Name already taken" });
        }
        throw e;
      }
    }
  );

  // GET /groups/dashboard - Aggregated Clan Data
  app.get("/groups/dashboard", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) return reply.status(401).send({ error: "unauthorized" });

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { groupId: true },
    });

    if (!userData?.groupId) {
      return { isInClan: false };
    }

    const groupId = userData.groupId;

    // 1. Fetch Group Details & Members
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { select: { id: true } }, // We just need the count for scaling
      },
    });

    const memberCount = group?.members.length || 1;

    // 2. Calculate Stats (Added Deep Sleep)
    const sleepStats = await prisma.sleepNight.aggregate({
      where: {
        user: { groupId: groupId },
      },
      _sum: {
        totalSleepMinutes: true,
        deepSleepMinutes: true, // <--- Added this
      },
      _count: {
        id: true,
      },
    });

    const totalMinutes = sleepStats._sum.totalSleepMinutes || 0;
    const totalDeepMinutes = sleepStats._sum.deepSleepMinutes || 0;
    const totalNights = sleepStats._count.id || 0;

    // --- DYNAMIC SCALING LOGIC ---

    // Helper to generate endless tiers
    // baseTarget: How much ONE person should contribute to complete a tier
    const calculateQuest = (
      name: string,
      description: string,
      icon: string,
      currentValue: number,
      basePerMember: number,
      unit: string
    ) => {
      // The target scales with clan size
      const tierSize = basePerMember * memberCount;

      // Current Tier (starts at 1)
      const currentTier = Math.floor(currentValue / tierSize) + 1;

      // Target to reach NEXT tier
      const nextTarget = currentTier * tierSize;

      return {
        id: name.toLowerCase().replace(/\s/g, "_"),
        name,
        description,
        icon,
        tier: currentTier,
        current: currentValue,
        target: nextTarget,
        unit,
      };
    };

    // 3. Define Quests
    const quests = [
      calculateQuest(
        "Morning Squad",
        "Log nights together",
        "sunny",
        totalNights,
        7, // Base: 7 nights per member per tier
        "nights"
      ),
      calculateQuest(
        "Century Club",
        "Total sleep duration",
        "time",
        totalMinutes,
        1000, // Base: 1000 mins (~16h) per member per tier
        "mins"
      ),
      calculateQuest(
        "Deep Sleepers",
        "Accumulate Deep Sleep",
        "bed",
        totalDeepMinutes,
        300, // Base: 300 mins (5h) deep sleep per member per tier
        "mins"
      ),
    ];

    // 4. Squad Level (XP System)
    // 1 Level = 10 nights * MemberCount
    const levelBase = 10 * memberCount;
    const squadLevel = Math.floor(totalNights / levelBase) + 1;
    const nextLevelTarget = squadLevel * levelBase; // Cumulative target

    return {
      isInClan: true,
      group: {
        id: group?.id,
        name: group?.name,
        code: group?.code,
        memberCount,
      },
      stats: {
        totalHours: Math.round(totalMinutes / 60),
        totalNights,
      },
      squadLevel: {
        current: squadLevel,
        progress: totalNights,
        target: nextLevelTarget,
      },
      achievements: quests,
    };
  });
}
