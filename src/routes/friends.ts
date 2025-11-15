import { FastifyInstance } from "fastify";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

type AddFriendBody = {
  email: string;
};

type RemoveFriendBody = {
  friendId: string;
};

export async function registerFriendRoutes(app: FastifyInstance) {
  // Add friend by email
  app.post<{ Body: AddFriendBody }>("/friends/add", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const userId = user.id;

    const { email } = request.body;
    if (!email) {
      return reply.status(400).send({ error: "Email required" });
    }

    const target = await prisma.user.findUnique({
      where: { email },
    });

    if (!target) {
      return reply
        .status(404)
        .send({ error: "User not found or has not opened the app yet" });
    }

    if (target.id === userId) {
      return reply
        .status(400)
        .send({ error: "Cannot add yourself as a friend" });
    }

    // Check if already friends either way
    const existing = await prisma.friend.findFirst({
      where: {
        OR: [
          { userId, friendId: target.id },
          { userId: target.id, friendId: userId },
        ],
      },
    });

    if (existing) {
      return reply.status(400).send({ error: "Already friends" });
    }

    await prisma.friend.create({
      data: {
        userId,
        friendId: target.id,
      },
    });

    return { ok: true };
  });

  // Get list of friends
  app.get("/friends", async (request, reply) => {
    const authReq = request as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const userId = user.id;

    const relations = await prisma.friend.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
      },
      include: {
        user: true,
        friend: true,
      },
    });

    const friends = relations.map((rel) => {
      const other = rel.userId === userId ? rel.friend : rel.user;
      return {
        id: other.id,
        email: other.email,
        displayName: other.displayName,
      };
    });

    return { friends };
  });
  app.post<{ Body: RemoveFriendBody }>(
    "/friends/remove",
    async (request, reply) => {
      const authReq = request as AuthenticatedRequest;
      const user = authReq.user;

      if (!user) {
        return reply.status(401).send({ error: "unauthorized" });
      }

      const { friendId } = request.body;

      if (!friendId) {
        return reply
          .status(400)
          .send({ error: "Missing friendId in request body" });
      }

      if (friendId === user.id) {
        return reply
          .status(400)
          .send({ error: "You cannot remove yourself as a friend" });
      }

      // delete both directions of the friendship if you store it that way
      const result = await prisma.friend.deleteMany({
        where: {
          OR: [
            { userId: user.id, friendId },
            { userId: friendId, friendId: user.id },
          ],
        },
      });

      if (result.count === 0) {
        return reply
          .status(404)
          .send({ error: "Friend relationship not found" });
      }

      return reply.send({ success: true });
    }
  );
}
