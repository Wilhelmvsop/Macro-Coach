import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { seedDemoUser } from "../src/seed.js";
import { TOKEN, USER, makeDeps } from "./helpers.js";

let server: Server;
let url: URL;
let client: Client;

async function connect(token?: string): Promise<Client> {
  const c = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  await c.connect(transport);
  return c;
}

type ToolCall = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolCall> {
  return (await client.callTool({ name, arguments: args })) as ToolCall;
}

const speech = (r: ToolCall) => r.content.find((c) => c.type === "text")?.text ?? "";

beforeAll(async () => {
  const deps = makeDeps();
  await seedDemoUser(deps, { token: TOKEN, user: USER });
  const app = createApp(deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  client = await connect(TOKEN);
});

afterAll(async () => {
  await client?.close();
  await new Promise((r) => server?.close(r));
});

describe("MCP server over Streamable HTTP", () => {
  it("negotiates the latest protocol version", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(client.getServerVersion()).toMatchObject({ name: "macro-coach" });
    expect(client.getInstructions()).toMatch(/log_meal/);
  });

  it("rejects requests without a valid token", async () => {
    await expect(connect()).rejects.toThrow();
    await expect(connect("wrong-token")).rejects.toThrow();
  });

  it("lists every tool with a strict input schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["edit_log_entry", "get_daily_summary", "get_remaining_budget", "get_weekly_report", "log_meal", "search_food", "set_goals", "suggest_meal"].sort(),
    );
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("runs the example conversation end to end through every tool", async () => {
    const goals = await call("set_goals", { calories: 2000, protein: 150, goal_type: "cut" });
    expect(speech(goals)).toMatch(/2,000 calories, 150 grams of protein/);

    const logged = await call("log_meal", { description: "I had two scrambled eggs and a banana for breakfast." });
    expect(logged.isError).toBeFalsy();
    expect(logged.structuredContent).toMatchObject({ logged: true, meal_type: "breakfast" });
    expect(speech(logged)).toMatch(/^Logged 2 scrambled eggs and 1 banana for breakfast: 287 calories/);

    const remaining = await call("get_remaining_budget");
    expect(remaining.structuredContent).toMatchObject({ remaining: { calories: 1713, protein: 136.5 } });

    const edit = await call("edit_log_entry", { food: "egg", quantity: 1 });
    expect(speech(edit)).toMatch(/^Updated to 1 scrambled egg/);

    const summary = await call("get_daily_summary");
    expect(summary.structuredContent).toMatchObject({ eaten: { calories: 196 } });

    const idea = await call("suggest_meal", { ingredients: ["chicken", "rice", "broccoli"], meal_type: "dinner" });
    expect((idea.structuredContent!.ideas as unknown[]).length).toBeGreaterThan(0);

    const week = await call("get_weekly_report");
    expect(week.structuredContent).toMatchObject({ daysLogged: 7 });
    expect(speech(week)).toMatch(/last 7 days/);

    const food = await call("search_food", { query: "Greek yogurt" });
    expect(speech(food)).toMatch(/17 grams of protein/);
  });

  it("returns speakable errors without stack traces", async () => {
    const r = await call("edit_log_entry", { food: "unicorn", quantity: 1 });
    expect(r.isError).toBe(true);
    expect(speech(r)).toBe("I couldn't find unicorn in your recent log.");
    expect(speech(r)).not.toMatch(/at \w+ \(/);
  });

  it("rejects arguments outside the schema", async () => {
    const r = (await client.callTool({ name: "get_daily_summary", arguments: { date: "yesterday" } })) as ToolCall;
    expect(r.isError).toBe(true);
  });

  it("exposes the today resource", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("macro-coach://today");
    const res = await client.readResource({ uri: "macro-coach://today" });
    const body = JSON.parse((res.contents[0] as { text: string }).text) as { date: string; speech: string };
    expect(body.date).toBe("2026-10-16");
    expect(body.speech).toMatch(/So far today/);
  });

  it("exposes the daily_checkin prompt", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("daily_checkin");
    const p = await client.getPrompt({ name: "daily_checkin", arguments: { focus: "protein" } });
    expect((p.messages[0]!.content as { text: string }).text).toMatch(/Focus on protein/);
  });
});
