import { existsSync } from "node:fs";

// Load server/.env for local development; deployed environments set real env vars.
if (existsSync(".env")) process.loadEnvFile(".env");

const { appOptions, buildDeps, loadConfig } = await import("./config.js");
const { createApp } = await import("./http/app.js");
const { log } = await import("./logger.js");
const { seedDemoUser } = await import("./seed.js");

const cfg = loadConfig();
const deps = buildDeps(cfg);

// The in-memory store starts empty, so seed the demo user locally. Deployed stacks seed on deploy and nightly.
if (!cfg.tableName || process.env.SEED_ON_START === "1") {
  await seedDemoUser(deps, { token: process.env.DEMO_TOKEN ?? "demo-judge-token" });
}

const app = createApp(deps, appOptions(cfg));
app.listen(cfg.port, cfg.host, () => {
  log.info("server.listening", { url: `http://${cfg.host}:${cfg.port}/mcp` });
});
