import { existsSync } from "node:fs";

// Seeds the demo user into the table named by TABLE_NAME, using server/.env if present.
if (existsSync(".env")) process.loadEnvFile(".env");
const { handler } = await import("./seedHandler.js");
await handler();
