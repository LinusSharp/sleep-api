import { buildServer } from "./server";

const server = buildServer();

server.listen({ port: 4000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("API running on", address);
});
