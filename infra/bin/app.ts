import { App } from "aws-cdk-lib";
import { existsSync } from "node:fs";
import { MacroCoachStack } from "../lib/macro-coach-stack.js";

// Reuse server/.env so a single file configures local runs and deploys.
const envFile = new URL("../../server/.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const fdcApiKey = process.env.FDC_API_KEY;
if (!fdcApiKey) throw new Error("FDC_API_KEY must be set (in server/.env or the environment) to deploy.");

const app = new App();
new MacroCoachStack(app, "MacroCoach", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  fdcApiKey,
  demoToken: process.env.DEMO_TOKEN ?? "demo-judge-token",
  bedrockModelIds: process.env.BEDROCK_MODEL_IDS ?? process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6,us.amazon.nova-pro-v1:0",
});
