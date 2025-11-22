import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

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

  // POST /groups/create - Create a new clan
  app.post<{ Body: { name: string } }>(
    "/groups/create",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) return reply.status(401).send({ error: "unauthorized" });

      const { name } = request.body;
      if (!name || name.length < 3)
        return reply.status(400).send({ error: "Name too short" });

      // Check if user is already in a group
      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      if (currentUser?.groupId) {
        return reply
          .status(400)
          .send({ error: "You are already in a clan. Leave it first." });
      }

      try {
        const group = await prisma.group.create({
          data: {
            name,
            members: {
              connect: { id: user.id },
            },
          },
          include: { members: true },
        });
        return { group };
      } catch (e: any) {
        if (e.code === "P2002") {
          // Prisma unique constraint error
          return reply.status(400).send({ error: "Clan name already taken" });
        }
        throw e;
      }
    }
  );

  // POST /groups/join - Join existing clan by name
  app.post<{ Body: { name: string } }>(
    "/groups/join",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) return reply.status(401).send({ error: "unauthorized" });

      const { name } = request.body;

      const group = await prisma.group.findUnique({ where: { name } });
      if (!group) return reply.status(404).send({ error: "Clan not found" });

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

    // Optional: Delete group if empty? Not implemented for simplicity

    return { success: true };
  });
}
