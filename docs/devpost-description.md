# Macro Coach: Devpost submission text

**Tagline:** Say what you ate. Get real nutrition numbers back. A voice-first macro coach for Alexa+, built on a self-hosted MCP server.

**Primary track:** Alexa+ (self-hosted MCP server, MCP spec 2025-11-25 over Streamable HTTP, plus a simulated Alexa+ experience)
**Mini challenge:** AWS Builder (Amazon Bedrock, Lambda, API Gateway, DynamoDB, EventBridge, S3, CloudFront, CDK)

**Try it:**
- Simulator: https://d27lym254gcbg5.cloudfront.net
- MCP endpoint: `https://igg6lly82j.execute-api.us-east-1.amazonaws.com/mcp` with header `Authorization: Bearer demo-judge-token`
- Code: https://github.com/Wilhelmvsop/Macro-Coach (MIT)

---

## Inspiration

Tracking what you eat is the habit that most reliably moves body-composition goals, and it is also the habit people drop fastest. Typing every meal into an app, searching a database and guessing portion sizes takes minutes a day. Voice should make it effortless: you're in the kitchen with your hands full, you say what you ate, and you're done. We wanted an assistant that answers the questions people really ask, like "how much protein do I still need?" and "what should I make for dinner with what I have?", with numbers grounded in real data instead of guesses.

## What it does

Macro Coach is an Alexa+ add-on backed by a self-hosted MCP server. You talk to it naturally:

- **"I had two scrambled eggs and a banana for breakfast."** Logs both items with USDA nutrition data and tells you what's left for the day.
- **"How much protein do I still need today?"** Remaining calories and macros, plus a one-line coaching hint.
- **"What should I eat for dinner? I have chicken, rice and broccoli."** One to three concrete meals that fit your remaining macros, with portions in grams and macros computed from USDA data.
- **"Actually, make that one egg, not two."** Fixes the last matching entry; no IDs needed.
- **"How did I do this week?"** Seven-day averages, the percentage of days you hit your targets, your best and worst day, and one actionable tip.
- **"I'm trying to cut. Set my goal to 2,000 calories and 150 grams of protein."** Sets targets directly, or computes them from your profile with the Mifflin-St Jeor equation.

Every answer is one or two short, speakable sentences. On screens, results also come with an **MCP Apps card**: macro rings, a weekly bar chart, or a carousel of meal ideas.

Macro Coach never invents numbers. If a portion is ambiguous ("a slice of banana") or a description is vague ("some food"), it asks a follow-up question instead of logging a guess.

## How we built it

- **MCP server (TypeScript, `@modelcontextprotocol/sdk` 1.32.1):** 8 tools with precise, model-readable descriptions and strict JSON Schema inputs, each returning `structuredContent` plus speakable text. Also the resource `macro-coach://today`, the prompt `daily_checkin`, and the MCP Apps view `ui://macro-coach/card.html`. Streamable HTTP runs in stateless mode, so every request is independent and it scales horizontally.
- **Nutrition grounding:** USDA FoodData Central for every number. We added a ranking layer so "banana" means "Banana, raw" rather than banana powder, plus curated IDs for common staples and unit handling for FDC's portion data.
- **Amazon Bedrock (Converse API):** parses free-text meals into food, quantity and unit using tool schemas, drafts meal ideas (macros are then computed from FDC, never by the model), and drives the simulator's agent loop. An ordered model chain tries Claude first and falls back to Amazon Nova Pro, so the add-on keeps working whichever models the account has enabled.
- **AWS:** Lambda behind an API Gateway HTTP API, a DynamoDB single table, EventBridge for a nightly reseed of the judge demo account, and S3 + CloudFront for the simulator. All of it is AWS CDK; `pnpm run deploy` builds and deploys from a clean account.
- **Alexa+ readiness:** OAuth 2.1 account linking with PKCE (S256), RFC 9728 protected resource metadata and authorization server metadata, built to the Alexa+ MCP Toolkit's published requirements.
- **Simulated Alexa+ experience:** a Vite + React web app with push-to-talk (Web Speech API), spoken replies, a live panel showing every MCP tool call (arguments and results), today's macro rings and a 7-day trend chart. The browser is a real MCP client over Streamable HTTP, and it also acts as an MCP Apps host for the cards.
- **Quality:** 112 server tests (vitest), including an integration test that runs the server and calls every tool through a real MCP client, and an end-to-end OAuth test. GitHub Actions run lint, typecheck and tests on every push. Logs are structured JSON.

## Challenges we ran into

- **Getting onto Alexa+ itself.** The MCP Toolkit CLI is distributed through a private registry for select partners, so we couldn't onboard to a real device in the hackathon window. We built the server to the toolkit's published requirements (including OAuth 2.1 with PKCE and MCP Apps) and used the simulated experience that the rules allow.
- **Real food data is messy.** FoodData Central's top search result for "rice" was "Dirty rice", and for "eggs" it was "Egg, Benedict". Wrong calories are worse than no answer, so we built and tested a ranking layer.
- **Model access on a new AWS account.** Account verification, per-model availability and the Anthropic use case form each produced a different error. The model chain and a rule-based fallback kept the product working throughout.
- **Voice constraints.** Replies must be short, rounded and free of markdown, and the toolkit's 500 ms target pushed us to cache FDC lookups aggressively.

All of it is documented step by step in our friction log.

## Accomplishments that we're proud of

- An honest product: every number comes from USDA data, and it asks rather than guesses.
- Corrections that feel natural ("make that one egg") through stateful, context-aware tools.
- A real, spec-compliant MCP server that judges can test with any MCP client, with OAuth and MCP Apps on top.
- A simulator that makes the MCP traffic visible, so you can see exactly which tool Alexa+ would call and what comes back.
- Infrastructure as code that deploys from scratch with one command, and a test suite that exercises the server through a real MCP client.

## What we learned

- Tool descriptions are the product's interface when a model is the user. Writing them for a model to read (when to use the tool, example phrasings, what each field means) changed tool selection more than any prompt tweak.
- Stateless Streamable HTTP is a great fit for serverless: no sessions, no streaming, no sticky routing.
- Grounding beats generation for numbers: let the LLM understand language, and let the database supply the facts.

## What's next for Macro Coach

- Onboard to Alexa+ through the MCP Toolkit as soon as access opens up, and test on Echo Show with the MCP Apps cards.
- Photo logging on Echo Show and phones, using a vision model for item recognition and FDC for numbers.
- Proactive check-ins ("you're 40 g short on protein; dinner idea?") and household profiles.
- Barcode lookup through FDC branded foods, and an export for dietitians.
