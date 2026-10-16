# Macro Coach — Build Plan

Voice-first nutrition coach for the Alexa+ track of the Build, Ship, Shape Amazon Developer Hackathon.
Submission deadline: **Oct 23, 2026, 12:00 PT**. Feature complete: **Oct 20**.

## Milestones

| Date | Milestone | Done when |
|------|-----------|-----------|
| Oct 17 | Local MCP server, all tools passing tests | `pnpm test` green: unit tests (parsing, macro math, goals, every tool handler) + integration test calling every tool through a real MCP client over Streamable HTTP |
| Oct 18 | Deployed + simulator end to end | CDK stack live (DynamoDB, Bedrock, FDC); simulator talks to the public URL as a real MCP client; judge user seeded |
| Oct 19 | Alexa+ integration and polish | MCP server connected to Alexa+ per Amazon docs, friction log up to date; if blocked, README says so and the simulator is the primary demo |
| Oct 20 | Feature freeze | Only bug fixes after this; README, product feedback, feature requests complete |
| Oct 21 | Video | Demo video under 2:45 recorded from `docs/demo-script.md` |
| Oct 22 | Submit | Devpost form filled from `docs/devpost-description.md`; one day buffer before the deadline |

## Work breakdown

### Server (`/server`)
- MCP SDK `@modelcontextprotocol/sdk` (Streamable HTTP, protocol 2025-11-25), Express host, bearer-token auth.
- Domain: macro math, Mifflin-St Jeor goal calculator, daily/weekly aggregation.
- Ports and adapters: `Store` (in-memory, DynamoDB), `NutritionSource` (FDC + cache, fixture fake), `Llm` (Bedrock, deterministic fake for tests).
- Tools: `log_meal`, `edit_log_entry`, `get_daily_summary`, `get_remaining_budget`, `suggest_meal`, `set_goals`, `get_weekly_report`, `search_food`.
- Resource `macro-coach://today`, prompt `daily_checkin`.
- Structured JSON logs; speakable errors.

### Simulator (`/simulator`)
- Vite + React, push-to-talk (Web Speech API) with text fallback, speechSynthesis replies.
- Agent loop on Bedrock Claude using an MCP client over Streamable HTTP.
- Live tool-call panel, macro rings, weekly trend chart.

### Infra (`/infra`)
- AWS CDK: DynamoDB single table, compute for the server, secrets for FDC key, seed script for the judge user.
- `pnpm deploy` from a clean account.

### Docs (`/docs`)
- architecture diagram, product-feedback, friction-log, feature-requests, devpost-description, demo-script, MCP Inspector screenshot.

## Open items needing the owner
- Git identity and public GitHub repo
- AWS credentials and Bedrock model access (region)
- USDA FDC API key
