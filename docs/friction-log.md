# Friction Log

Every step that cost us time while building Macro Coach, in the format the hackathon asks for: the task, what we did, what we expected, what happened, how bad it was, how we worked around it, and what would fix it. Times are UTC. Severity: **Blocker** (stopped progress), **High** (hours lost or a feature changed), **Medium** (under an hour), **Low** (annoyance).

## Summary

| # | Area | Task | Severity |
|---|---|---|---|
| 1 | Alexa+ MCP Toolkit | Connect the deployed MCP server to Alexa+ | Blocker |
| 2 | Alexa+ MCP Toolkit | Make the server meet the toolkit's auth rules | High |
| 3 | Alexa+ MCP Toolkit | Meet the 500 ms round-trip target | Medium |
| 4 | Amazon Bedrock | First Converse call on a new account | High |
| 5 | Amazon Bedrock | Call a current Claude model | High |
| 6 | Amazon Bedrock | Call Claude Sonnet 4.6 by model ID | Medium |
| 7 | Amazon Bedrock | Get structured output with forced tool choice | Medium |
| 8 | Amazon Bedrock | Use Amazon Nova as a fallback in a voice agent | Medium |
| 9 | MCP TypeScript SDK | Confirm protocol 2025-11-25 support | Low |
| 10 | MCP TypeScript SDK | Compile with strict TypeScript options | Low |
| 11 | MCP TypeScript SDK | Run Streamable HTTP statelessly on Lambda | Medium |
| 12 | MCP TypeScript SDK | Serve on a public host | Low |
| 13 | MCP Apps | Add an MCP Apps view to a v1 SDK server | Medium |
| 14 | AWS CDK / Lambda | Bundle an ESM Express app for Lambda | Medium |
| 15 | AWS CDK | Deploy with root credentials | Low |
| 16 | FoodData Central | Resolve plain food names | High |
| 17 | FoodData Central | Convert portions to grams | Medium |
| 18 | pnpm | Run `pnpm deploy` | Low |
| 19 | pnpm | Install esbuild | Low |

---

## 1. Alexa+ MCP Toolkit: connect the deployed MCP server to Alexa+

- **When:** 2026-10-23 01:30
- **Task attempted:** Onboard the public Macro Coach MCP server as an Alexa+ add-on and test it on a device.
- **Steps taken:** Read the hackathon rules ("Develop an MCP following the open-source docs"), then the Alexa+ developer docs: *MCP Toolkit Overview*, *MCP QuickStart Guide* and *Set Up Your Development Environment*. The quickstart starts with `alexa-ai configure`; the setup guide installs the CLI with `npm install -g @alexa-ai/cli` after `aws codeartifact login --tool npm --domain alexa-ai --domain-owner 372468808636 --repository npm-packages ...`.
- **Expected:** A self-serve path from "I have an MCP server URL" to "I can talk to it on Alexa+", since the Alexa+ track is built around self-hosted MCP servers.
- **Actual:** The CLI lives in a private CodeArtifact registry. Access needs an AWS account that you have given to an Alexa Solutions Architect, plus an IAM user that can assume `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`. The overview page says the Category SDK and MCP Toolkit are "available to select partners only". The hackathon pages don't explain how participants get that access.
- **Severity:** Blocker for real-device testing.
- **Workaround:** Built the server to the toolkit's published requirements anyway (Streamable HTTP, OAuth 2.1 with PKCE, protected resource metadata, MCP Apps) and used the "simulated Alexa+ experience" path the rules allow. The simulator connects to the deployed server as a real MCP client.
- **Suggestion:** Give hackathon participants a self-serve allowlist (for example "link your Devpost account"), or publish the CLI to public npm with a sandbox mode. State the access requirement on the hackathon resources page, not only on the setup page.

## 2. Alexa+ MCP Toolkit: meet the auth requirements

- **When:** 2026-10-23 01:40
- **Task attempted:** Make the MCP server pass account linking.
- **Steps taken:** Read the quickstart's auth list. Compared it with the MCP authorization spec, which says a 401 should carry `WWW-Authenticate` with the resource metadata URL.
- **Expected:** The toolkit follows the MCP authorization spec.
- **Actual:** The toolkit asks for the opposite: 401 *without* `WWW-Authenticate`. It requires OAuth 2.1 code flow with PKCE (S256), RFC 9728 protected resource metadata and `/.well-known/oauth-authorization-server`, but does not support Dynamic Client Registration, Client ID Metadata Documents or OIDC. Our server only had per-user API keys.
- **Severity:** High (about 2 hours to add an authorization server).
- **Workaround:** Added a small OAuth 2.1 server (`server/src/http/oauth.ts`): code + PKCE, refresh tokens, client credentials, both metadata documents, HMAC-signed stateless codes and tokens so any Lambda instance can verify them. 401s omit `WWW-Authenticate`. Static API keys still work for judges and the simulator. Covered by `server/test/oauth.test.ts`.
- **Suggestion:** Align with the MCP authorization spec, or explain why the header must be absent. Supporting DCR or CIMD would remove the need to register a static client per add-on. A reference authorization server sample would save every participant the same work.

## 3. Alexa+ MCP Toolkit: 500 ms round-trip target

- **When:** 2026-10-23 01:45
- **Task attempted:** Check our latency against the toolkit's "respond within 500 ms" requirement.
- **Steps taken:** Timed tool calls against the deployed Lambda.
- **Expected:** Simple tools fit easily.
- **Actual:** Read-only tools return in 60 to 350 ms warm. `log_meal` takes 1.2 to 1.8 s, because it calls an LLM to parse the meal and then FoodData Central twice per food, and Lambda cold starts add about 1 s.
- **Severity:** Medium.
- **Workaround:** Cached FDC lookups (search results and portions) for 24 hours per instance, and curated FDC IDs for common foods to skip the search call.
- **Suggestion:** Document whether 500 ms is a hard timeout or a target, and whether progress notifications or streamed partial results extend it. Tools that write data often need an external lookup.

## 4. Amazon Bedrock: first call on a new account

- **When:** 2026-10-16 00:41
- **Task attempted:** Make the first Converse call from a brand-new AWS account.
- **Steps taken:** `list-foundation-models` listed the Anthropic models, so we called Converse.
- **Expected:** A response, or a "request model access" error.
- **Actual:** `AccessDeniedException: Your account is currently being verified. Verification normally takes less than 2 hours.` Nothing in the console showed that verification was pending.
- **Severity:** High (the AI path could not be tested on day one).
- **Workaround:** The server falls back to a deterministic rule-based parser behind the same interface, so development continued.
- **Suggestion:** Show account verification status on the Bedrock console home page, and make `list-foundation-models` reflect what the account can actually call.

## 5. Amazon Bedrock: call a current Claude model

- **When:** 2026-10-23 01:18
- **Task attempted:** Call Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5 (all listed by `list-foundation-models`).
- **Steps taken:** Called Converse with each model ID, with and without the `us.` inference profile prefix.
- **Expected:** One of them works, or the error says how to get access.
- **Actual:** `AccessDeniedException: ... is not available for this account ... contact AWS Sales`. Claude Sonnet 4.6 and Haiku 4.5 then returned `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form`. Amazon Nova Pro worked immediately.
- **Severity:** High.
- **Workaround:** `BedrockModelChain` (`server/src/adapters/bedrockModels.ts`) tries an ordered list of models (`BEDROCK_MODEL_IDS`, Claude first, then Nova Pro) and remembers the first one the account can use. Claude takes over automatically once the use case form is approved; no redeploy needed.
- **Suggestion:** One page that lists, per model, exactly what an account needs (verification, use-case form, sales contact). Return the same error type for "form not submitted" as for "no access"; today one is `AccessDeniedException` and the other `ResourceNotFoundException`.

## 6. Amazon Bedrock: Claude Sonnet 4.6 by model ID

- **When:** 2026-10-23 01:19
- **Task attempted:** Call `anthropic.claude-sonnet-4-6`.
- **Expected:** Works like other model IDs.
- **Actual:** `ValidationException: Invocation of model ID anthropic.claude-sonnet-4-6 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile`.
- **Severity:** Medium.
- **Workaround:** Use `us.anthropic.claude-sonnet-4-6`, and allow `inference-profile/*` as well as `foundation-model/*` in the Lambda IAM policy.
- **Suggestion:** Show the inference profile ID first on each model's console page, and list "on-demand: profile only" in `list-foundation-models` output.

## 7. Amazon Bedrock: structured output with forced tool choice

- **When:** 2026-10-16 00:28
- **Task attempted:** Get JSON meal items from the model by forcing a tool call.
- **Expected:** `toolChoice: { tool: { name } }` guarantees a tool call.
- **Actual:** Newer Claude models reject forced tool choice.
- **Severity:** Medium.
- **Workaround:** `toolChoice: { auto: {} }` plus a system prompt that says to call the tool, validation of the tool input with zod, and fallback to the rule parser on any failure.
- **Suggestion:** Document per-model support for `toolChoice` in the Converse API reference.

## 8. Amazon Bedrock: Amazon Nova as a voice-agent fallback

- **When:** 2026-10-23 01:24
- **Task attempted:** Run the simulator's agent loop and meal suggestions on Nova Pro.
- **Expected:** The same behavior as with Claude.
- **Actual:** Three differences broke the loop. Nova writes `<thinking>…</thinking>` into text blocks, which the speaker would read aloud. After stripping that, an assistant turn could be empty, and Bedrock then rejects the history with `The content field in the Message object at messages.3 is empty`. It also sometimes omitted required fields from tool input (`ingredients`).
- **Severity:** Medium.
- **Workaround:** Strip thinking tags server-side, never keep empty assistant turns in history (fall back to the tool's speakable text), and drop malformed meal ideas before falling back to rules.
- **Suggestion:** A Converse flag to suppress reasoning text. Enforce `required` fields in tool input schemas server-side, as Claude's strict mode does.

## 9. MCP TypeScript SDK: confirm protocol 2025-11-25 support

- **When:** 2026-10-16 00:19
- **Task attempted:** Check that the SDK supports the protocol version the rules require.
- **Expected:** Supported protocol versions in the README or on npm.
- **Actual:** Not listed. We found `LATEST_PROTOCOL_VERSION = '2025-11-25'` in `dist/esm/types.js` of `@modelcontextprotocol/sdk@1.32.1`.
- **Severity:** Low.
- **Workaround:** Pinned 1.32.1 and asserted the version in the integration test.
- **Suggestion:** List supported protocol versions in the SDK README and release notes.

## 10. MCP TypeScript SDK: strict TypeScript

- **When:** 2026-10-16 00:25
- **Task attempted:** Compile with `exactOptionalPropertyTypes: true`.
- **Actual:** `StreamableHTTPServerTransport` options (`sessionIdGenerator: undefined`) and `Transport.onclose` types fail under that flag.
- **Severity:** Low.
- **Workaround:** Dropped the flag; kept `strict` and `noUncheckedIndexedAccess`.
- **Suggestion:** Declare optional properties as `T | undefined` in the SDK's public types.

## 11. MCP TypeScript SDK: stateless Streamable HTTP on Lambda

- **When:** 2026-10-16 00:26
- **Task attempted:** Run the server on Lambda behind API Gateway without sticky sessions.
- **Expected:** A documented stateless pattern.
- **Actual:** Stateless mode is only mentioned in a code comment (`sessionIdGenerator: undefined`). It was not clear that a new `McpServer` per request is intended, or that `enableJsonResponse: true` avoids the need for response streaming.
- **Severity:** Medium.
- **Workaround:** One server and transport per POST, closed on `res.close`; JSON responses; GET and DELETE on `/mcp` return 405.
- **Suggestion:** A "deploy to serverless" guide with this exact pattern.

## 12. MCP TypeScript SDK: public host

- **When:** 2026-10-16 00:27
- **Task attempted:** Serve the Express app on a public host.
- **Actual:** `createMcpExpressApp()` turns on DNS-rebinding protection for `127.0.0.1` by default and prints a warning when bound to `0.0.0.0` without `allowedHosts`.
- **Severity:** Low.
- **Workaround:** Pass `host` and `allowedHosts` from config; on Lambda rely on bearer auth.
- **Suggestion:** Document the recommended settings behind API Gateway and other proxies.

## 13. MCP Apps: add a view to a v1 SDK server

- **When:** 2026-10-23 01:55
- **Task attempted:** Add an MCP Apps view (the toolkit asks for MCP Apps for visuals) using `@modelcontextprotocol/ext-apps`.
- **Expected:** `registerAppTool` and `registerAppResource` work with the SDK we use.
- **Actual:** `ext-apps@2.0.3` server helpers are typed against `@modelcontextprotocol/server` (SDK v2), not `@modelcontextprotocol/sdk` 1.x.
- **Severity:** Medium.
- **Workaround:** Set `_meta.ui.resourceUri` (and the legacy `ui/resourceUri` key) by hand and serve the HTML with MIME type `text/html;profile=mcp-app`. The view speaks the `ui/initialize` / `ui/notifications/tool-result` postMessage protocol directly. The simulator implements the host side.
- **Suggestion:** Keep helpers for SDK 1.x, or document the raw `_meta` keys and MIME type next to the helpers.

## 14. AWS CDK / Lambda: bundle an ESM Express app

- **When:** 2026-10-16 00:50
- **Task attempted:** Deploy the server with `NodejsFunction`.
- **Actual:** By default `@aws-sdk/*` is left external, so the bundle failed locally with `ERR_MODULE_NOT_FOUND`. ESM bundles of Express also need `require`.
- **Severity:** Medium.
- **Workaround:** `externalModules: []` and an ESM banner that defines `require` with `createRequire`. We invoked the bundled handler locally with a fake HTTP API v2 event before every deploy.
- **Suggestion:** A `NodejsFunction` preset for ESM + Express, and a local invoke command for bundled assets.

## 15. AWS CDK: deploy with root credentials

- **When:** 2026-10-16 00:47
- **Actual:** `cdk deploy` printed "current credentials could not be used to assume ...deploy-role..., but are for the right account. Proceeding anyway." Root credentials can't assume roles.
- **Severity:** Low.
- **Workaround:** None needed; deploy succeeded.
- **Suggestion:** Say plainly that root credentials are the cause and recommend an IAM user.

## 16. FoodData Central: resolve plain food names

- **When:** 2026-10-16 00:55
- **Task attempted:** Map "banana", "rice" and "2 eggs" to sensible FDC foods.
- **Expected:** The top search result is the plain food.
- **Actual:** "banana" returned "Bananas, dehydrated, or banana powder" first; "rice" returned "Dirty rice"; "eggs" returned "Egg, Benedict"; "greek yogurt" returned a branded blueberry flavor.
- **Severity:** High (wrong calories are worse than no answer).
- **Workaround:** A ranker (leading description segment, cooked vs raw by food, penalties for processed, flavored and branded entries), curated FDC IDs for about 20 staples, `requireAllWords` with a fallback, and questions instead of guesses for vague input. Covered by `server/test/resolver.test.ts`.
- **Suggestion:** A "generic/common" ranking mode or a `commonName` field in search results.

## 17. FoodData Central: portions to grams

- **When:** 2026-10-16 00:58
- **Actual:** FNDDS portions use numeric codes as modifiers ("90000" = quantity not specified), dry-measure portions ("1 cup, dry, yields") and different spellings ("1 tablespoon" vs "1 tbsp", "piece" for a pizza slice). Portions also need a second request per food.
- **Severity:** Medium.
- **Workaround:** Normalize units and spellings, skip dry-measure portions, prefer regular over snack-size portions, and fetch details once per food with a 24-hour cache.
- **Suggestion:** Return portions in search results, and document the meaning of numeric modifiers.

## 18. pnpm: `pnpm deploy`

- **Actual:** `pnpm deploy` is a built-in pnpm command, so it doesn't run the `deploy` script.
- **Severity:** Low.
- **Workaround:** `pnpm run deploy`, documented in the README.

## 19. pnpm: install esbuild

- **Actual:** pnpm 10 blocks dependency build scripts by default, so esbuild's binary was missing and CDK bundling failed.
- **Severity:** Low.
- **Workaround:** `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` in the root `package.json`.
