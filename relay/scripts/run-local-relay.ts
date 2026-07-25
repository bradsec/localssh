import { startLocalRelay } from "../src/local-relay.js";

const port = Number(process.argv[2] ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`invalid relay port: ${process.argv[2] ?? ""}`);
  process.exit(1);
}

const relay = startLocalRelay({ port });
let shuttingDown = false;

relay.once("listening", () => {
  console.log(`local relay listening on ${port}`);
});
relay.once("error", (error) => {
  console.error(`local relay failed: ${error.message}`);
  process.exitCode = 1;
});

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  relay.close((error) => {
    if (error) {
      console.error(`failed to close local relay: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
