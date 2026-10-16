import { beforeEach, describe, expect, it } from "vitest";
import { seedDemoUser } from "../src/seed.js";
import { UserFacingError } from "../src/tools/errors.js";
import * as h from "../src/tools/handlers.js";
import type { ToolContext } from "../src/tools/handlers.js";
import { TODAY, makeCtx } from "./helpers.js";

let ctx: ToolContext;
beforeEach(async () => {
  ctx = await makeCtx();
});

const breakfast = { description: "I had two scrambled eggs and a banana for breakfast." };

describe("log_meal", () => {
  it("logs each item with FDC-grounded macros and the remaining budget", async () => {
    const r = await h.logMeal(ctx, breakfast);
    expect(r.data.logged).toBe(true);
    expect(r.data.meal_type).toBe("breakfast"); // inferred from 8am local
    const items = r.data.items as { food: string; grams: number; nutrients: { calories: number } }[];
    expect(items.map((i) => [i.food, i.grams])).toEqual([
      ["Egg, scrambled", 122],
      ["Bananas, raw", 118],
    ]);
    expect(r.data.meal_total).toEqual({ calories: 287, protein: 13.5, carbs: 28.9, fat: 13.8, fiber: 3.1 });
    expect(r.speech).toBe(
      "Logged 2 scrambled eggs and 1 banana for breakfast: 287 calories and 14 grams of protein. You have 1,713 calories and 107 grams of protein left today.",
    );
    expect(await ctx.deps.store.listEntries("u1", TODAY, TODAY)).toHaveLength(2);
  });

  it("honours an explicit meal type and timestamp", async () => {
    const r = await h.logMeal(ctx, { description: "1 cup white rice", meal_type: "dinner", eaten_at: "2026-10-15T02:00:00Z" });
    expect(r.data.meal_type).toBe("dinner");
    expect(r.data.date).toBe("2026-10-14");
    expect(r.speech).not.toMatch(/left today/);
  });

  it("asks for clarification and logs nothing when the portion is unknown", async () => {
    const r = await h.logMeal(ctx, { description: "a slice of banana and two eggs" });
    expect(r.data).toMatchObject({ logged: false, needs_clarification: true });
    expect(r.speech).toMatch(/grams, ounces or cups/);
    expect(await ctx.deps.store.recentEntries("u1", 10)).toHaveLength(0);
  });

  it("never logs a vague description", async () => {
    const r = await h.logMeal(ctx, { description: "I had some food" });
    expect(r.data).toMatchObject({ logged: false, needs_clarification: true });
    expect(await ctx.deps.store.recentEntries("u1", 10)).toHaveLength(0);
  });

  it("asks when the food is not found", async () => {
    const r = await h.logMeal(ctx, { description: "a dragonfruit smoothie" });
    expect(r.data.needs_clarification).toBe(true);
    expect(r.speech).toMatch(/couldn't find/);
  });
});

describe("edit_log_entry", () => {
  beforeEach(async () => {
    await h.logMeal(ctx, breakfast);
  });

  it("changes the matching item ('make that one egg')", async () => {
    const r = await h.editLogEntry(ctx, { food: "egg", quantity: 1 });
    expect(r.data).toMatchObject({ updated: true, food: "Egg, scrambled", quantity: 1, after: { calories: 91 } });
    expect(r.speech).toMatch(/^Updated to 1 scrambled egg, 91 calories\./);
  });

  it("defaults to the most recent entry", async () => {
    const r = await h.editLogEntry(ctx, { quantity: 2 });
    expect(r.data.food).toBe("Bananas, raw");
  });

  it("changes the unit using portion data", async () => {
    const r = await h.editLogEntry(ctx, { food: "banana", quantity: 1, unit: "cups" });
    expect(r.data).toMatchObject({ unit: "cup", after: { calories: 134 } });
  });

  it("removes an entry", async () => {
    const r = await h.editLogEntry(ctx, { food: "banana", remove: true });
    expect(r.data.removed).toBe(true);
    expect(await ctx.deps.store.recentEntries("u1", 10)).toHaveLength(1);
  });

  it("explains what is missing", async () => {
    await expect(h.editLogEntry(ctx, {})).rejects.toBeInstanceOf(UserFacingError);
    await expect(h.editLogEntry(ctx, { food: "pizza", quantity: 1 })).rejects.toThrow(/couldn't find pizza/);
  });
});

describe("get_daily_summary", () => {
  it("reports an empty day", async () => {
    const r = await h.getDailySummary(ctx, {});
    expect(r.speech).toBe("You haven't logged anything today. Your target is 2,000 calories.");
  });
  it("reports progress against targets", async () => {
    await h.logMeal(ctx, breakfast);
    const r = await h.getDailySummary(ctx, {});
    expect(r.speech).toBe("So far today you've had 287 of 2,000 calories and 14 grams of 120 grams of protein.");
    expect(r.data).toMatchObject({ date: TODAY, entryCount: 2 });
  });
});

describe("get_remaining_budget", () => {
  it("returns remaining macros and a hint", async () => {
    await h.logMeal(ctx, breakfast);
    const r = await h.getRemainingBudget(ctx);
    expect(r.data.remaining).toMatchObject({ calories: 1713, protein: 106.5 });
    expect(typeof r.data.hint).toBe("string");
    expect(r.speech).toMatch(/^You have 1,713 calories, 107 grams of protein/);
  });
});

describe("suggest_meal", () => {
  it("builds ideas from the user's ingredients with FDC macros", async () => {
    const r = await h.suggestMeal(ctx, { ingredients: ["chicken", "rice", "broccoli"], meal_type: "dinner" });
    const ideas = r.data.ideas as { name: string; ingredients: { fdc_id: number }[]; estimated: { calories: number } }[];
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(ideas[0]!.ingredients.map((i) => i.fdc_id)).toEqual([900004, 900005, 900006]);
    expect(ideas[0]!.estimated.calories).toBeGreaterThan(300);
    expect(r.speech).toMatch(/^Try chicken, rice, broccoli plate: about [\d,]+ calories/);
  });
  it("respects vegetarian constraints", async () => {
    const r = await h.suggestMeal(ctx, { constraints: ["vegetarian"], count: 3 });
    const names = (r.data.ideas as { name: string }[]).map((i) => i.name.toLowerCase());
    expect(names.some((n) => /chicken|salmon/.test(n))).toBe(false);
  });
});

describe("set_goals", () => {
  it("sets direct targets ('cut, 2,000 calories and 150 g protein')", async () => {
    const r = await h.setGoals(ctx, { calories: 2000, protein: 150, goal_type: "cut" });
    expect(r.data).toMatchObject({ method: "direct", goals: { calories: 2000, protein: 150, fat: 56, carbs: 224, goalType: "cut" } });
    expect(r.speech).toBe("Done. Your daily targets for your cut are 2,000 calories, 150 grams of protein, 224 grams of carbs and 56 grams of fat.");
    expect(await ctx.deps.store.getGoals("u1")).toMatchObject({ calories: 2000 });
  });
  it("computes targets from a profile in imperial units", async () => {
    const r = await h.setGoals(ctx, {
      goal_type: "maintain",
      profile: { weight: 176.37, weight_unit: "lb", height: 70.87, height_unit: "in", age: 30, sex: "male", activity: "moderate" },
    });
    expect(r.data).toMatchObject({ method: "mifflin_st_jeor", goals: { calories: 2760, protein: 128 } });
  });
  it("reuses a stored profile and asks when none exists", async () => {
    await expect(h.setGoals(ctx, { goal_type: "bulk" })).rejects.toThrow(/weight, height, age/);
    await ctx.deps.store.putProfile("u1", { weightKg: 80, heightCm: 180, age: 30, sex: "male", activity: "moderate" });
    const r = await h.setGoals(ctx, { goal_type: "bulk" });
    expect((r.data.goals as { calories: number }).calories).toBe(3060);
  });
});

describe("get_weekly_report", () => {
  it("summarises the seeded demo week", async () => {
    await seedDemoUser(ctx.deps, { token: "demo", user: ctx.user });
    const r = await h.getWeeklyReport(ctx, {});
    expect(r.data).toMatchObject({ startDate: "2026-10-10", endDate: TODAY, daysLogged: 6 });
    expect(r.speech).toMatch(/^Over the last 7 days you averaged [\d,]+ calories/);
    expect(r.data.bestDay).toBeDefined();
  });
  it("handles no data", async () => {
    const r = await h.getWeeklyReport(ctx, {});
    expect(r.speech).toMatch(/haven't logged anything in the last 7 days/);
  });
});

describe("search_food", () => {
  it("answers with a typical serving", async () => {
    const r = await h.searchFood(ctx, { query: "Greek yogurt" });
    expect(r.data).toMatchObject({ fdc_id: 900007, grams: 170, nutrients: { protein: 17.3, calories: 100 } });
    expect(r.speech).toBe("A typical serving of greek yogurt, about 170 grams, has 17 grams of protein, 6 grams of carbs, 1 gram of fat and 100 calories.");
  });
  it("uses an explicit quantity", async () => {
    const r = await h.searchFood(ctx, { query: "white rice", quantity: 2, unit: "cups" });
    expect(r.data).toMatchObject({ grams: 316, nutrients: { calories: 411 } });
  });
  it("explains unknown foods", async () => {
    await expect(h.searchFood(ctx, { query: "unobtainium" })).rejects.toThrow(/couldn't find/);
  });
});
