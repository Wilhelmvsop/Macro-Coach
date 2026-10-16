import { FixtureNutritionSource } from "../src/adapters/fixtureNutrition.js";
import { MemoryStore } from "../src/adapters/memoryStore.js";
import { RuleLlm } from "../src/adapters/ruleLlm.js";
import type { User } from "../src/domain/types.js";
import type { Deps } from "../src/ports.js";
import type { ToolContext } from "../src/tools/handlers.js";

process.env.LOG_SILENT = "1";

/** 08:00 in Los Angeles on Oct 16, 2026. */
export const NOW = new Date("2026-10-16T15:00:00Z");
export const TODAY = "2026-10-16";

export const USER: User = { id: "u1", name: "Test User", timezone: "America/Los_Angeles" };
export const TOKEN = "test-token";

export function makeDeps(now: Date = NOW): Deps {
  let n = 0;
  return {
    store: new MemoryStore(),
    nutrition: new FixtureNutritionSource(),
    llm: new RuleLlm(),
    now: () => now,
    newId: () => `e${++n}`,
  };
}

export async function makeCtx(now: Date = NOW): Promise<ToolContext> {
  const deps = makeDeps(now);
  await deps.store.putUser(USER, TOKEN);
  return { deps, user: USER };
}
