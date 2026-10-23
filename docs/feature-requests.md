# Feature Requests

Priority: **Critical** (blocks building on the platform), **Important** (costs significant time or quality), **Nice-to-have**.

| # | Product | Request | Priority |
|---|---|---|---|
| 1 | Alexa+ MCP Toolkit | Self-serve access for hackathon participants | Critical |
| 2 | Alexa+ MCP Toolkit | A web simulator that accepts any public MCP URL | Critical |
| 3 | Alexa+ MCP Toolkit | Support Dynamic Client Registration or CIMD | Important |
| 4 | Alexa+ MCP Toolkit | Clear latency rules for write tools | Important |
| 5 | Amazon Bedrock | One "can I call this model?" check | Important |
| 6 | Amazon Bedrock | Suppress reasoning text in Converse | Nice-to-have |
| 7 | MCP TypeScript SDK | Serverless deployment guide | Important |
| 8 | MCP Apps | Server helpers for SDK 1.x | Important |
| 9 | FoodData Central | A "common food" ranking mode | Important |
| 10 | AWS CDK | ESM preset for `NodejsFunction` | Nice-to-have |

## 1. Self-serve Alexa+ MCP Toolkit access for hackathon participants (Critical)

- **Description:** Let registered hackathon participants install `@alexa-ai/cli` and deploy add-ons to their own developer account without going through a Solutions Architect, for example by linking a Devpost account or applying through a short form.
- **Why it matters to us:** It is the only thing between our deployed, toolkit-ready MCP server and a real Echo device demo. Without it, every Alexa+ track entry falls back to a simulator.

## 2. Web simulator that accepts any public MCP URL (Critical)

- **Description:** In the Alexa developer console, paste an MCP server URL plus OAuth settings and chat with Alexa+ using those tools, without packaging or deploying an add-on.
- **Why it matters to us:** Fast iteration on tool descriptions. Alexa+ picks tools from descriptions, so we want to see what the model chooses before shipping.

## 3. Dynamic Client Registration or Client ID Metadata Documents (Important)

- **Description:** Support DCR (RFC 7591) or CIMD in account linking, and accept a `WWW-Authenticate` header on 401 as the MCP authorization spec recommends.
- **Why it matters to us:** Registering a static client per add-on and behaving differently from the MCP spec means separate code paths for Alexa+ and other MCP clients.

## 4. Clear latency rules for tools that write data (Important)

- **Description:** Document whether the 500 ms round-trip limit is a hard timeout, and allow longer budgets (or progress notifications) for tools that call external APIs.
- **Why it matters to us:** `log_meal` parses with an LLM and looks up nutrition data; it takes 1.2 to 1.8 s. We need to know whether Alexa+ will cut it off.

## 5. One "can I call this model?" check in Bedrock (Important)

- **Description:** An API or console view that says, for each model, whether the account can invoke it now and what is missing (verification, use case form, sales contact, inference profile).
- **Why it matters to us:** We hit four different errors from four different causes before a Claude call worked, and `list-foundation-models` listed models we could not call.

## 6. Suppress reasoning text in Converse (Nice-to-have)

- **Description:** A Converse option that keeps a model's reasoning out of text content blocks (Amazon Nova emits `<thinking>` tags).
- **Why it matters to us:** In a voice product, every text block is read aloud, so we strip tags by hand.

## 7. Serverless deployment guide for the MCP TypeScript SDK (Important)

- **Description:** An official example of stateless Streamable HTTP on AWS Lambda (or any serverless platform): one server per request, JSON responses, which HTTP methods to expose.
- **Why it matters to us:** We reverse-engineered the pattern from code comments. It's the natural way to host MCP servers that judges can test free of charge.

## 8. MCP Apps server helpers for SDK 1.x (Important)

- **Description:** Make `registerAppTool` and `registerAppResource` in `@modelcontextprotocol/ext-apps` work with `@modelcontextprotocol/sdk` 1.x, or document the raw `_meta` keys and MIME type.
- **Why it matters to us:** The Alexa+ toolkit asks for MCP Apps, and most servers today run SDK 1.x.

## 9. A "common food" ranking mode in FoodData Central search (Important)

- **Description:** A search option that ranks the plain, unprocessed form of a food first ("Banana, raw" for "banana"), or a `commonName` field.
- **Why it matters to us:** Voice users say plain food names. Today the top result is often a prepared variant with very different calories, so we built a ranking layer and curated IDs.

## 10. ESM preset for CDK `NodejsFunction` (Nice-to-have)

- **Description:** A one-line option that produces a working ESM bundle (with a `require` shim) and bundles the AWS SDK.
- **Why it matters to us:** Express plus ESM needed trial and error and a local invoke harness before the first successful deploy.
