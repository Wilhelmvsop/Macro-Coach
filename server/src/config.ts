import { randomUUID } from "node:crypto";
import { BedrockLlm, FallbackLlm } from "./adapters/bedrockLlm.js";
import { parseModelIds } from "./adapters/bedrockModels.js";
import { DynamoStore } from "./adapters/dynamoStore.js";
import { FdcNutritionSource } from "./adapters/fdc.js";
import { FixtureNutritionSource } from "./adapters/fixtureNutrition.js";
import { MemoryStore } from "./adapters/memoryStore.js";
import { RuleLlm } from "./adapters/ruleLlm.js";
import { BedrockAgentLlm } from "./http/agentLlm.js";
import type { AppOptions } from "./http/app.js";
import { log } from "./logger.js";
import type { Deps } from "./ports.js";

/** Claude first; Amazon Nova as a fallback for accounts where Anthropic models are not enabled yet. */
export const DEFAULT_MODELS = "us.anthropic.claude-sonnet-4-6,us.amazon.nova-pro-v1:0";

export interface Config {
  port: number;
  host: string;
  tableName?: string;
  fdcApiKey?: string;
  /** Ordered list; later models are used when earlier ones are not enabled for the account. */
  bedrockModelIds: string[];
  awsRegion: string;
  useBedrock: boolean;
  allowedHosts?: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    ...(env.TABLE_NAME ? { tableName: env.TABLE_NAME } : {}),
    ...(env.FDC_API_KEY ? { fdcApiKey: env.FDC_API_KEY } : {}),
    bedrockModelIds: parseModelIds(env.BEDROCK_MODEL_IDS ?? env.BEDROCK_MODEL_ID ?? DEFAULT_MODELS),
    awsRegion: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1",
    useBedrock: env.USE_BEDROCK !== "0",
    ...(env.ALLOWED_HOSTS ? { allowedHosts: env.ALLOWED_HOSTS.split(",").map((s) => s.trim()) } : {}),
  };
}

/** Wires real or local adapters depending on which settings are present. */
export function buildDeps(cfg: Config): Deps {
  const store = cfg.tableName ? new DynamoStore(cfg.tableName) : new MemoryStore();
  const nutrition = cfg.fdcApiKey ? new FdcNutritionSource(cfg.fdcApiKey) : new FixtureNutritionSource();
  const llm = cfg.useBedrock ? new FallbackLlm(new BedrockLlm(cfg.bedrockModelIds, cfg.awsRegion), new RuleLlm()) : new RuleLlm();
  log.info("deps.configured", {
    store: cfg.tableName ? "dynamodb" : "memory",
    nutrition: cfg.fdcApiKey ? "fdc" : "fixture",
    llm: cfg.useBedrock ? `bedrock:${cfg.bedrockModelIds.join(">")}` : "rules",
  });
  return { store, nutrition, llm, now: () => new Date(), newId: () => randomUUID() };
}

export function appOptions(cfg: Config): AppOptions {
  return {
    host: cfg.host,
    ...(cfg.allowedHosts ? { allowedHosts: cfg.allowedHosts } : {}),
    ...(cfg.useBedrock ? { agentLlm: new BedrockAgentLlm(cfg.bedrockModelIds, cfg.awsRegion) } : {}),
  };
}
