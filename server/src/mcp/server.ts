import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorFields, log } from "../logger.js";
import { GENERIC_ERROR, UserFacingError } from "../tools/errors.js";
import * as h from "../tools/handlers.js";
import type { ToolContext, ToolResult } from "../tools/handlers.js";

export const SERVER_INFO = { name: "macro-coach", version: "0.1.0" };

const INSTRUCTIONS =
  "Macro Coach is a voice nutrition coach. Use log_meal whenever the user says they ate or drank something. " +
  "Use edit_log_entry for corrections like 'make that one egg' or 'remove the banana'. " +
  "Read each tool's text result aloud as is; it is already short and speakable. " +
  "If a result says needs_clarification, ask the user the question and call the tool again with their answer.";

/** Runs a handler, converting its result or error into an MCP tool result with speakable text. */
async function run(name: string, ctx: ToolContext, fn: () => Promise<ToolResult>): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const r = await fn();
    log.info("tool.call", { tool: name, userId: ctx.user.id, ms: Date.now() - started });
    return { content: [{ type: "text", text: r.speech }], structuredContent: r.data };
  } catch (err) {
    const userFacing = err instanceof UserFacingError;
    log[userFacing ? "info" : "error"]("tool.error", { tool: name, userId: ctx.user.id, ms: Date.now() - started, ...errorFields(err) });
    const text = userFacing ? err.message : GENERIC_ERROR;
    return { isError: true, content: [{ type: "text", text }], structuredContent: { error: text } };
  }
}

/** Builds an MCP server instance bound to one authenticated user. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });

  server.registerTool(
    "log_meal",
    {
      title: "Log a meal",
      description:
        "Log food or drink the user says they ate. Pass their words as 'description' (e.g. 'two scrambled eggs and a banana'). " +
        "The server parses items and amounts, looks up USDA nutrition data and stores each item. Returns the items, calories and macros, " +
        "and the remaining daily budget. If the amount or food is ambiguous it logs nothing and returns a question to ask the user.",
      inputSchema: h.logMealInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => run("log_meal", ctx, () => h.logMeal(ctx, args)),
  );

  server.registerTool(
    "edit_log_entry",
    {
      title: "Edit or remove a logged item",
      description:
        "Correct a previously logged item: change its quantity (e.g. 'make that one egg, not two' -> food 'egg', quantity 1) or remove it. " +
        "Without entry_id it edits the most recent entry, or the most recent one matching 'food'.",
      inputSchema: h.editLogEntryInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => run("edit_log_entry", ctx, () => h.editLogEntry(ctx, args)),
  );

  server.registerTool(
    "get_daily_summary",
    {
      title: "Daily summary",
      description: "Calories, protein, carbs, fat and fiber eaten versus the user's targets for one day (default today), with meals listed.",
      inputSchema: h.dailySummaryInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => run("get_daily_summary", ctx, () => h.getDailySummary(ctx, args)),
  );

  server.registerTool(
    "get_remaining_budget",
    {
      title: "Remaining budget",
      description:
        "What the user can still eat today: remaining calories, protein, carbs and fat, plus a one-line coaching hint. " +
        "Use for questions like 'how much protein do I still need today?'.",
      inputSchema: h.remainingBudgetInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run("get_remaining_budget", ctx, () => h.getRemainingBudget(ctx)),
  );

  server.registerTool(
    "suggest_meal",
    {
      title: "Suggest a meal",
      description:
        "Suggest 1 to 3 concrete meals that fit the user's remaining macros today, optionally using ingredients they have and respecting " +
        "dietary constraints. Macros are estimated from USDA FoodData Central data. Use for 'what should I eat for dinner?'.",
      inputSchema: h.suggestMealInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run("suggest_meal", ctx, () => h.suggestMeal(ctx, args)),
  );

  server.registerTool(
    "set_goals",
    {
      title: "Set daily goals",
      description:
        "Set daily calorie and macro targets. Either pass numbers directly (e.g. calories 2000, protein 150, goal_type 'cut'), " +
        "or pass goal_type plus a body profile to compute targets with the Mifflin-St Jeor equation.",
      inputSchema: h.setGoalsInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => run("set_goals", ctx, () => h.setGoals(ctx, args)),
  );

  server.registerTool(
    "get_weekly_report",
    {
      title: "Weekly report",
      description:
        "Seven-day trends ending today (or end_date): average intake, percent of days on target, best and worst day, and one actionable tip. " +
        "Use for 'how did I do this week?'.",
      inputSchema: h.weeklyReportInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => run("get_weekly_report", ctx, () => h.getWeeklyReport(ctx, args)),
  );

  server.registerTool(
    "search_food",
    {
      title: "Look up a food",
      description:
        "Look up nutrition facts for one food in USDA FoodData Central without logging it, e.g. 'how much protein is in Greek yogurt?'. " +
        "Optionally pass a quantity and unit; otherwise a typical serving is used.",
      inputSchema: h.searchFoodInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run("search_food", ctx, () => h.searchFood(ctx, args)),
  );

  server.registerResource(
    "today",
    "macro-coach://today",
    {
      title: "Today's nutrition summary",
      description: "JSON summary of what the user has eaten today versus their targets.",
      mimeType: "application/json",
    },
    async (uri) => {
      const r = await h.getDailySummary(ctx, {});
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ speech: r.speech, ...r.data }) }] };
    },
  );

  server.registerPrompt(
    "daily_checkin",
    {
      title: "Daily check-in",
      description: "A short coaching check-in: review today's intake and suggest the next meal.",
      argsSchema: { focus: z.string().optional().describe("Optional focus, e.g. 'protein' or 'dinner'.") },
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Do my daily nutrition check-in. Read the macro-coach://today resource or call get_remaining_budget, " +
              "tell me in two sentences how I'm doing, then call suggest_meal for my next meal." +
              (focus ? ` Focus on ${focus}.` : ""),
          },
        },
      ],
    }),
  );

  return server;
}
