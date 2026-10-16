import { buildDeps, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { seedDemoUser } from "./seed.js";

/**
 * Seeds the judge demo user. Runs once on deploy (CDK trigger) and nightly
 * (EventBridge) so the demo always has a fresh week of history.
 */
export async function handler(): Promise<{ entries: number }> {
  const cfg = loadConfig({ ...process.env, USE_BEDROCK: "0" });
  const token = process.env.DEMO_TOKEN;
  if (!token) throw new Error("DEMO_TOKEN is not set");
  const { entries } = await seedDemoUser(buildDeps(cfg), { token });
  log.info("seed.handler.done", { entries });
  return { entries };
}
