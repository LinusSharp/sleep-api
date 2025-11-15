import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";
import { supabaseAdmin } from "../supabaseAdmin";

type ProfileBody = {
  email?: string;
  displayName?: string;
};

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
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const record = await prisma.user.findUnique({
      where: { id: user.id },
    });

    return { user: record };
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
