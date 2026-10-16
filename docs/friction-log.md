# Friction Log

A running, timestamped log of every step, error, confusing doc and workaround while building Macro Coach. Times are UTC.

| When (UTC) | Area | What happened | Workaround / outcome |
|---|---|---|---|
| 2026-10-16 00:18 | Tooling | Fresh Windows 11 machine had Node 24 and npm but no pnpm. | `npm i -g pnpm@10`. |
| 2026-10-16 00:19 | MCP SDK | Needed to confirm the TypeScript SDK supports protocol 2025-11-25 before writing code. The npm page does not list supported protocol versions. | Checked `LATEST_PROTOCOL_VERSION` in `@modelcontextprotocol/sdk@1.32.1` (`dist/esm/types.js`): `2025-11-25`. Pinned 1.32.1. |
| 2026-10-16 00:25 | MCP SDK | `tsc` failed with `exactOptionalPropertyTypes: true`: `StreamableHTTPServerTransport` options (`sessionIdGenerator: undefined`) and `Transport.onclose` types are not compatible with that flag. | Dropped `exactOptionalPropertyTypes`; kept `strict` and `noUncheckedIndexedAccess`. Worth an SDK issue. |
| 2026-10-16 00:26 | MCP SDK | Stateless Streamable HTTP is documented only in a code comment (`sessionIdGenerator: undefined`). It was not obvious that a new `McpServer` per request is the intended pattern. | Create server + transport per POST, close both on `res.close`. GET and DELETE return 405. |
| 2026-10-16 00:27 | MCP SDK | `createMcpExpressApp()` binds DNS-rebinding protection to `127.0.0.1` by default, which would block a public host. | Pass `host` and `allowedHosts` from config. |
| 2026-10-16 00:28 | Bedrock | Newer Claude models reject forced tool choice (`toolChoice: { tool }`), which is the usual way to get structured output from the Converse API. | Use `toolChoice: { auto: {} }`, instruct the model to call the tool, validate with zod, and fall back to the rule-based parser on any failure. |
| 2026-10-16 00:40 | FoodData Central | Signup took a couple of minutes and the key worked immediately. `POST /v1/foods/search` returned "Egg, whole, cooked, scrambled" (SR Legacy 172187) first, with portions "1 cup" 220 g and "1 large" 61 g. | No issues. Search results include nutrients, but portions need a second `GET /v1/food/{id}` call. |
| 2026-10-16 00:41 | Bedrock | First Converse call from a brand-new AWS account failed with `AccessDeniedException: Your account is currently being verified... normally takes less than 2 hours`. The Anthropic models were already listed by `list-foundation-models`, so the error looked like a model-access problem at first. | Waited for account verification. Server falls back to the rule-based parser in the meantime. |
