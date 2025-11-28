import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

// Helper to generate random 8-char alphanumeric code
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

      // Generate a code and ensure uniqueness (simple retry logic could be added, but collision is rare for 8 chars)
      const code = generateGroupCode();

      try {
        const group = await prisma.group.create({
          data: {
            name,
            code, // <--- Save the generated code
            members: {
              connect: { id: user.id },
            },
          },
          include: { members: true },
        });
        return { group };
      } catch (e: any) {
        if (e.code === "P2002") {
          // This error now catches duplicate Names OR duplicate Codes
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

      const { code } = request.body; // <--- Expect 'code', not 'name'

      // Find by code
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

    await prisma.user.update({
      where: { id: user.id },
      data: { groupId: null },
    });

    return { success: true };
  });

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
        members: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    // 2. Calculate Total Clan Sleep (All time)
    const sleepStats = await prisma.sleepNight.aggregate({
      where: {
        user: { groupId: groupId },
      },
      _sum: {
        totalSleepMinutes: true,
      },
      _count: {
        id: true, // Count of nights logged
      },
    });

    const totalMinutes = sleepStats._sum.totalSleepMinutes || 0;
    const totalNights = sleepStats._count.id || 0;

    // 3. Dynamic Clan Achievements (Calculated on the fly for simplicity)
    const clanAchievements = [
      {
        name: "Early Risers",
        icon: "sunny",
        unlocked: totalNights > 10,
        target: 10,
        current: totalNights,
        unit: "nights logged",
      },
      {
        name: "Century Club",
        icon: "time",
        unlocked: totalMinutes >= 6000, // 100 hours
        target: 6000,
        current: totalMinutes,
        unit: "mins total",
      },
      {
        name: "Deep Sleepers",
        icon: "bed",
        unlocked: totalMinutes >= 30000, // 500 hours
        target: 30000,
        current: totalMinutes,
        unit: "mins total",
      },
    ];

    return {
      isInClan: true,
      group: {
        id: group?.id,
        name: group?.name,
        code: group?.code,
        memberCount: group?.members.length,
      },
      stats: {
        totalHours: Math.round(totalMinutes / 60),
        totalNights,
      },
      achievements: clanAchievements,
    };
  });
}
