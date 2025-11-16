import { buildServer } from "./server";

const server = buildServer();

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";

// Required for Railway — but still works locally
server.listen({ port, host }, (err, address) => {
  if (err) {
    console.error("Server failed to start:", err);
    process.exit(1);
  }
  console.log(`API running on ${address}`);
});
