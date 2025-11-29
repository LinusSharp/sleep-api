import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";
import { supabaseAdmin } from "../supabaseAdmin";

type ProfileBody = {
  email?: string;
  displayName?: string;
};

// --- PROFANITY FILTER LOGIC (Moved from Client) ---
function hasProfanity(text: string): boolean {
  if (!text) return false;

  // Normalize leetspeak
  const normalized = text
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/!/g, "i");

  // Remove non-alpha characters to catch "b.a.d.w.o.r.d"
  const cleanText = normalized.replace(/[^a-z]/g, "");

  const badWords = [
    "admin",
    "staff",
    "mod",
    "fuck",
    "shit",
    "bitch",
    "ass",
    "cunt",
    "dick",
    "pussy",
    "whore",
    "fag",
    "nigger",
    "kill",
    "suicide",
  ];

  return badWords.some((word) => cleanText.includes(word));
}

export async function registerMeRoutes(app: FastifyInstance) {
  app.post<{ Body: ProfileBody }>("/me/profile", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { email, displayName } = request.body;

    if (!email && !displayName) {
      return reply.status(400).send({ error: "Nothing to update" });
    }

    // --- SERVER-SIDE VALIDATION ---
    if (displayName && hasProfanity(displayName)) {
      return reply
        .status(400)
        .send({
          error: "Display name contains restricted words or profanity.",
        });
    }

    const updated = await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: email ?? undefined,
        displayName: displayName ?? undefined,
      },
      create: {
        id: user.id,
        email: email ?? null,
        displayName: displayName ?? null,
        avatarUrl: null,
      },
    });

    return { user: updated };
  });

  app.get("/me/profile", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) return reply.status(401).send({ error: "unauthorized" });

    const record = await prisma.user.findUnique({
      where: { id: user.id },
      include: { group: true }, // Include group info
    });

    // Calculate Personal Stats
    const stats = await prisma.sleepNight.aggregate({
      where: { userId: user.id },
      _sum: { totalSleepMinutes: true },
      _count: { id: true },
    });

    const totalMins = stats._sum.totalSleepMinutes || 0;
    const nights = stats._count.id || 0;

    // Dynamic Personal Badges
    const badges = [
      {
        id: "1",
        name: "Novice",
        icon: "ribbon-outline",
        unlocked: nights >= 1,
      },
      {
        id: "2",
        name: "Regular",
        icon: "calendar-outline",
        unlocked: nights >= 7,
      },
      {
        id: "3",
        name: "Pro Sleeper",
        icon: "star-outline",
        unlocked: totalMins >= 3000,
      }, // 50h
      {
        id: "4",
        name: "Hibernator",
        icon: "snow-outline",
        unlocked: totalMins >= 6000,
      }, // 100h
    ];

    return {
      user: {
        ...record,
        stats: { totalHours: Math.round(totalMins / 60), nights },
      },
      badges,
    };
  });

  app.post("/me/delete-account", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;

    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const userId = user.id;

    try {
      // 1. delete all sleep rows
      await prisma.sleepNight.deleteMany({
        where: { userId },
      });

      // 2. delete all friend relationships
      await prisma.friend.deleteMany({
        where: {
          OR: [{ userId }, { friendId: userId }],
        },
      });

      // 3. delete profile row
      await prisma.user.delete({
        where: { id: userId },
      });

      // 4. delete Supabase Auth user
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;

      return reply.send({ success: true });
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: "Failed to delete account" });
    }
  });
}
