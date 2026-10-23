# Product Feedback

One section per tool, API and SDK we used. Detailed, timestamped issues are in [friction-log.md](friction-log.md), and concrete asks are in [feature-requests.md](feature-requests.md).

## Summary

| Tool | Used for | Build with it again? |
|---|---|---|
| MCP TypeScript SDK 1.32.1 | MCP server and both MCP clients | Yes |
| MCP Apps | Visual cards for tool results | Yes |
| Alexa+ MCP Toolkit | Target platform for the add-on | Yes, once access is self-serve |
| Amazon Bedrock | Meal parsing, meal ideas, simulator agent | Yes |
| AWS Lambda + API Gateway HTTP API | Hosting the MCP server | Yes |
| Amazon DynamoDB | Users, goals and food log | Yes |
| AWS CDK | All infrastructure | Yes |
| S3 + CloudFront | Hosting the simulator | Yes |
| Amazon EventBridge | Nightly demo reseed | Yes |
| USDA FoodData Central | All nutrition numbers | Yes, with a ranking layer |

---

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)

- **What we used it for:** The Macro Coach server: 8 tools with strict JSON Schema inputs and `structuredContent`, the `macro-coach://today` resource, the `daily_checkin` prompt and an MCP Apps view, over Streamable HTTP. Also the client side, in the integration tests and in the browser simulator.
- **What worked well:** `registerTool` with zod schemas produces clean JSON Schema with `additionalProperties: false`. The same SDK runs in Node and in the browser, so the simulator is a real MCP client. Our integration test starts the server and calls every tool through `StreamableHTTPClientTransport`, which made refactors safe.
- **What needs work:** Supported protocol versions are not documented, so we read the source. Stateless and serverless deployment is only explained in a code comment. Some public types break under `exactOptionalPropertyTypes`.
- **Onboarding:** About 30 minutes from `pnpm add` to a working tool, thanks to the examples in the README.
- **Build with it again?** Yes. It is the shortest path to a spec-compliant server, and having one SDK for both client and server is a big win.

## MCP Apps (`io.modelcontextprotocol/ui`)

- **What we used it for:** `ui://macro-coach/card.html`, linked from `log_meal`, `get_daily_summary`, `suggest_meal` and `get_weekly_report`. It shows macro rings, a 7-day bar chart and a carousel of meal ideas. The simulator acts as a minimal MCP Apps host and renders the card in a sandboxed iframe.
- **What worked well:** The model is simple: the tool points at a resource, and the view receives the tool result over postMessage. Hosts that don't support it fall back to the text result.
- **What needs work:** `@modelcontextprotocol/ext-apps` 2.x server helpers target SDK v2, so SDK 1.x users must set the `_meta` keys by hand. The protocol messages are easiest to learn from the package source.
- **Onboarding:** About an hour to a working view plus a minimal host.
- **Build with it again?** Yes. Voice plus a glanceable card is exactly right for nutrition on Echo Show-style screens.

## Alexa+ (MCP Toolkit / Alexa AI CLI)

- **What we used it for:** The target platform. We built the server to the MCP Toolkit's published requirements: Streamable HTTP, OAuth 2.1 with PKCE (S256), RFC 9728 protected resource metadata, 401 without `WWW-Authenticate`, MCP Apps for visuals, and speakable short replies.
- **What worked well:** The requirements are concrete and easy to test against. Building on standard MCP meant the same server works with MCP Inspector, our simulator and other MCP clients.
- **What needs work:** We could not onboard. The Alexa AI CLI is in a private CodeArtifact registry, and access requires an AWS account shared with an Alexa Solutions Architect ("select partners only"). The auth rules differ from the MCP authorization spec (no `WWW-Authenticate`, no DCR or CIMD). The 500 ms round-trip target is hard to meet for tools that call an LLM and an external API.
- **Onboarding:** Blocked at installing the CLI. Reading the docs and adapting the server took about 3 hours.
- **Build with it again?** Yes, if hackathon participants get self-serve access. The add-on model fits this product well.

## Amazon Bedrock (Converse API)

- **What we used it for:** Three integrations, all through `@aws-sdk/client-bedrock-runtime`: (1) parsing free-text meals into food, quantity and unit with a tool schema; (2) drafting meal ideas whose macros we then compute from FDC data; (3) the simulator's agent loop, which picks MCP tools turn by turn. `BedrockModelChain` tries Claude first and falls back to Amazon Nova Pro.
- **What worked well:** One Converse API for every model made the fallback chain a 40-line class. Tool use with JSON Schema gives reliable structured output. Cross-region inference profiles worked first time.
- **What needs work:** Getting to a working Claude call took several steps, each with a different error: account verification, "not available for this account", the Anthropic use case form, and on-demand IDs that need an inference profile. `list-foundation-models` lists models the account cannot call. Nova writes `<thinking>` text and sometimes skips required tool fields.
- **Onboarding:** The code took 20 minutes. Account access took days, mostly waiting on verification.
- **Build with it again?** Yes. Being able to swap models without touching code is valuable, and IAM-based auth means no API keys in Lambda.

## AWS Lambda + Amazon API Gateway (HTTP API)

- **What we used it for:** Hosting the MCP server (Express via `@codegenie/serverless-express`), the Bedrock proxy for the simulator, and the OAuth endpoints.
- **What worked well:** Stateless MCP with JSON responses needs no response streaming, so a plain HTTP API works. It scales to zero, so it is free for judges through November 20. The built-in CORS settings on the HTTP API saved code.
- **What needs work:** Cold starts of about 1 s with the AWS SDK bundled. The 29 s integration timeout leaves little room for slow LLM calls.
- **Onboarding:** Under an hour with CDK.
- **Build with it again?** Yes.

## Amazon DynamoDB

- **What we used it for:** Single-table storage: users, hashed API keys, goals, body profiles and food log entries, with a GSI to look entries up by ID.
- **What worked well:** On-demand billing, and the document client made the adapter about 150 lines. The same `Store` interface has an in-memory implementation for tests.
- **What needs work:** Nothing blocked us. Single-table key design still takes upfront thought.
- **Onboarding:** 30 minutes.
- **Build with it again?** Yes.

## AWS CDK

- **What we used it for:** Everything: table, two Lambda functions, HTTP API routes, IAM for Bedrock, a deploy-time seed trigger, a nightly EventBridge reseed, S3 + CloudFront for the simulator, and a generated `config.json`. `pnpm run deploy` deploys from a clean account.
- **What worked well:** `NodejsFunction` bundling, `Trigger` for post-deploy seeding, and `BucketDeployment` with `Source.jsonData` to inject runtime config.
- **What needs work:** ESM + Express bundles need a `require` banner. The default of leaving the AWS SDK external surprised us. `logRetention` is deprecated, with no easy migration for existing functions.
- **Onboarding:** `cdk bootstrap` worked first time.
- **Build with it again?** Yes.

## USDA FoodData Central API

- **What we used it for:** Every calorie and macro number: food search, nutrients per 100 g and portion weights.
- **What worked well:** Free, quick key signup, authoritative data, and both FNDDS and SR Legacy foods.
- **What needs work:** Search ranking favors prepared or processed variants for plain names. Portions need a second request, and FNDDS portions use numeric codes.
- **Onboarding:** 5 minutes to the first result.
- **Build with it again?** Yes, with our ranking and caching layer.
