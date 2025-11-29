import { FastifyInstance } from "fastify";
import { Expo } from "expo-server-sdk";
import { prisma } from "../db/client";
import type { AuthenticatedRequest } from "../server";

const expo = new Expo();

export async function registerNotificationRoutes(app: FastifyInstance) {
  // 1. Save Token
  app.post<{ Body: { token: string } }>(
    "/notifications/token",
    async (req, reply) => {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user)
        return reply.status(401).send({ error: "Unauthorized" });

      await prisma.user.update({
        where: { id: authReq.user.id },
        data: { pushToken: req.body.token },
      });

      return { success: true };
    }
  );

  // 2. Send Nudge (Wake Up!)
  app.post<{ Body: { targetUserId: string } }>(
    "/notifications/nudge",
    async (req, reply) => {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user)
        return reply.status(401).send({ error: "Unauthorized" });

      const { targetUserId } = req.body;

      // Fetch target user
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
      });
      const sender = await prisma.user.findUnique({
        where: { id: authReq.user.id },
      });

      if (!target?.pushToken || !Expo.isExpoPushToken(target.pushToken)) {
        return reply.status(400).send({ error: "User has no push token" });
      }

      // Check if they actually need a nudge (have they logged today?)
      const today = new Date().setHours(0, 0, 0, 0);
      const lastLog = target.lastLogDate
        ? new Date(target.lastLogDate).setHours(0, 0, 0, 0)
        : 0;

      if (lastLog === today) {
        return reply
          .status(400)
          .send({ error: "They already logged sleep today!" });
      }

      // Send Notification
      await expo.sendPushNotificationsAsync([
        {
          to: target.pushToken,
          sound: "default",
          title: "Wakey Wakey! 📢",
          body: `${
            sender?.displayName || "A squadmate"
          } is waiting for your sleep log.`,
          data: { url: "slumber://log" }, // Deep link if you have them setup
        },
      ]);

      return { success: true };
    }
  );

  // 3. Send Reaction (Respect/Congrats)
  app.post<{ Body: { targetUserId: string; type: "respect" | "congrats" } }>(
    "/notifications/react",
    async (req, reply) => {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user)
        return reply.status(401).send({ error: "Unauthorized" });

      const { targetUserId, type } = req.body;
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
      });
      const sender = await prisma.user.findUnique({
        where: { id: authReq.user.id },
      });

      if (!target?.pushToken)
        return reply.status(400).send({ error: "No token" });

      const messages = {
        respect: {
          title: "Respect 🫡",
          body: `${sender?.displayName} paid their respects.`,
        },
        congrats: {
          title: "Huge! 🔥",
          body: `${sender?.displayName} is impressed by your sleep.`,
        },
      };

      const msg = messages[type];

      await expo.sendPushNotificationsAsync([
        {
          to: target.pushToken,
          sound: "default",
          title: msg.title,
          body: msg.body,
        },
      ]);

      return { success: true };
    }
  );
}
