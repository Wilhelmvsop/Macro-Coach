import { configure } from "@codegenie/serverless-express";
import { appOptions, buildDeps, loadConfig } from "./config.js";
import { createApp } from "./http/app.js";

/**
 * AWS Lambda entry point (API Gateway HTTP API, payload v2). The Express app and
 * MCP transport are the same as local; the transport runs stateless with JSON
 * responses, so no response streaming is required.
 */
const cfg = loadConfig({ ...process.env, HOST: "0.0.0.0" });
const app = createApp(buildDeps(cfg), appOptions(cfg));

export const handler = configure({ app });
