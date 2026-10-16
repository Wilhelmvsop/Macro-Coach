import { z } from "zod";
import { DATE_RE, addDays, localDate, localHour } from "../domain/dates.js";
import { DEFAULT_GOALS, completeGoals, computeGoals } from "../domain/goals.js";
import { round, scale, sum } from "../domain/macros.js";
import { coachingHint, dailySummary, weeklyReport, type DailySummary } from "../domain/report.js";
import { MEAL_TYPES, type Goals, type LogEntry, type MealType, type Profile, type User } from "../domain/types.js";
import type { Deps } from "../ports.js";
import { gramsPerUnit, normalizeUnit } from "../parsing/units.js";
import { pickCandidate, resolveItem, type ResolvedItem } from "../services/resolver.js";
import { UserFacingError } from "./errors.js";
import { amount, grams, list, num } from "./speech.js";

export interface ToolContext {
  deps: Deps;
  user: User;
}

/** Every tool returns a short speakable summary plus structured data. */
export interface ToolResult {
  speech: string;
  data: Record<string, unknown>;
}

const mealType = z.enum(MEAL_TYPES as [MealType, ...MealType[]]);
const isoDate = z.string().regex(DATE_RE, "Use the format YYYY-MM-DD");

// ---------- shared helpers ----------

async function goalsFor(ctx: ToolContext): Promise<Goals> {
  return (await ctx.deps.store.getGoals(ctx.user.id)) ?? DEFAULT_GOALS;
}

function today(ctx: ToolContext): string {
  return localDate(ctx.deps.now(), ctx.user.timezone);
}

async function summaryFor(ctx: ToolContext, date: string): Promise<DailySummary> {
  const [entries, goals] = await Promise.all([ctx.deps.store.listEntries(ctx.user.id, date, date), goalsFor(ctx)]);
  return dailySummary(date, entries, goals);
}

function guessMealType(hour: number): MealType {
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 17) return "snack";
  if (hour < 22) return "dinner";
  return "snack";
}

function remainingSentence(s: DailySummary): string {
  if (s.over.calories > 0) return `You're ${num(s.over.calories)} calories over today's target.`;
  return `You have ${num(s.remaining.calories)} calories and ${grams(s.remaining.protein)} of protein left today.`;
}

// ---------- log_meal ----------

export const logMealInput = z
  .object({
    description: z
      .string()
      .min(2)
      .max(500)
      .describe("What the user ate, in their own words, including amounts. Example: 'two scrambled eggs and a banana'."),
    meal_type: mealType.optional().describe("breakfast, lunch, dinner or snack. Omit to infer from the time of day."),
    eaten_at: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 timestamp of when the food was eaten. Omit for now."),
  })
  .strict();

export async function logMeal(ctx: ToolContext, input: z.infer<typeof logMealInput>): Promise<ToolResult> {
  const { deps, user } = ctx;
  const parsed = await deps.llm.parseMeal(input.description);
  if (parsed.items.length === 0) {
    const question = parsed.clarification ?? "I didn't catch what you ate. Could you say the food and the amount?";
    return { speech: question, data: { logged: false, needs_clarification: true, question } };
  }

  const resolved: ResolvedItem[] = [];
  for (const item of parsed.items) {
    const r = await resolveItem(deps.nutrition, item);
    if (!r.ok) {
      // Log nothing rather than a partial meal, so the user can answer and retry once.
      return { speech: `${r.question} I haven't logged anything yet.`, data: { logged: false, needs_clarification: true, question: r.question } };
    }
    resolved.push(r.value);
  }

  const eatenAt = input.eaten_at ? new Date(input.eaten_at) : deps.now();
  if (Number.isNaN(eatenAt.getTime())) throw new UserFacingError("I couldn't understand that time. Please try again without it.");
  const date = localDate(eatenAt, user.timezone);
  const meal = input.meal_type ?? guessMealType(localHour(eatenAt, user.timezone));
  const entries: LogEntry[] = resolved.map((r) => ({
    id: deps.newId(),
    userId: user.id,
    date,
    eatenAt: eatenAt.toISOString(),
    mealType: meal,
    foodName: r.food.description,
    spokenName: r.item.food,
    fdcId: r.food.fdcId,
    quantity: r.item.quantity,
    unit: r.item.unit,
    gramsPerUnit: r.gramsPerUnit,
    per100g: r.food.per100g,
    nutrients: r.nutrients,
  }));
  await deps.store.addEntries(entries);

  const mealTotal = round(sum(entries.map((e) => e.nutrients)));
  const summary = await summaryFor(ctx, date);
  const what = list(resolved.map((r) => amount(r.item.quantity, r.item.unit, r.item.food)));
  const speech =
    `Logged ${what} for ${meal}: ${num(mealTotal.calories)} calories and ${grams(mealTotal.protein)} of protein. ` +
    (date === today(ctx) ? remainingSentence(summary) : "");
  return {
    speech: speech.trim(),
    data: {
      logged: true,
      date,
      meal_type: meal,
      items: entries.map((e) => ({
        entry_id: e.id,
        food: e.foodName,
        spoken_name: e.spokenName,
        fdc_id: e.fdcId,
        quantity: e.quantity,
        unit: e.unit,
        grams: Math.round(e.gramsPerUnit * e.quantity),
        nutrients: e.nutrients,
      })),
      meal_total: mealTotal,
      remaining_today: summary.remaining,
      eaten_today: summary.eaten,
    },
  };
}

// ---------- edit_log_entry ----------

export const editLogEntryInput = z
  .object({
    entry_id: z.string().optional().describe("ID of the entry to change. Omit to use the most recent entry (or the most recent matching 'food')."),
    food: z.string().optional().describe("Name of the food to change, e.g. 'egg' in 'make that one egg'. Used when entry_id is omitted."),
    quantity: z.number().positive().max(10000).optional().describe("New amount, e.g. 1 for 'one egg'."),
    unit: z.string().optional().describe("New unit if it changes, e.g. 'cup' or 'g'. Omit to keep the current unit."),
    remove: z.boolean().optional().describe("True to delete the entry instead of changing it."),
  })
  .strict();

function matches(e: LogEntry, food: string): boolean {
  const q = food.toLowerCase().replace(/s$/, "");
  return e.spokenName.toLowerCase().includes(q) || e.foodName.toLowerCase().includes(q);
}

export async function editLogEntry(ctx: ToolContext, input: z.infer<typeof editLogEntryInput>): Promise<ToolResult> {
  const { deps, user } = ctx;
  if (!input.remove && input.quantity === undefined) {
    throw new UserFacingError("Tell me the new amount, or say remove to delete the item.");
  }
  let entry: LogEntry | undefined;
  if (input.entry_id) {
    entry = await deps.store.getEntry(user.id, input.entry_id);
  } else {
    const recent = await deps.store.recentEntries(user.id, 20);
    entry = input.food ? recent.find((e) => matches(e, input.food!)) : recent[0];
  }
  if (!entry) {
    throw new UserFacingError(input.food ? `I couldn't find ${input.food} in your recent log.` : "I couldn't find anything in your log to change.");
  }

  if (input.remove) {
    await deps.store.deleteEntry(user.id, entry.id);
    const s = await summaryFor(ctx, entry.date);
    return {
      speech: `Removed ${amount(entry.quantity, entry.unit, entry.spokenName)} from ${entry.mealType}. ${entry.date === today(ctx) ? remainingSentence(s) : ""}`.trim(),
      data: { removed: true, entry_id: entry.id, date: entry.date, remaining_today: s.remaining },
    };
  }

  let gpu = entry.gramsPerUnit;
  let unit = entry.unit;
  if (input.unit !== undefined && normalizeUnit(input.unit) !== entry.unit) {
    unit = normalizeUnit(input.unit);
    const g = gramsPerUnit(unit, await deps.nutrition.portions(entry.fdcId));
    if (g === undefined) throw new UserFacingError(`I don't know how much one ${unit} of ${entry.spokenName} weighs. Try grams or ounces.`);
    gpu = g;
  }
  const quantity = input.quantity!;
  const before = entry.nutrients;
  const updated: LogEntry = { ...entry, quantity, unit, gramsPerUnit: gpu, nutrients: round(scale(entry.per100g, gpu * quantity)) };
  await deps.store.replaceEntry(updated);
  const s = await summaryFor(ctx, entry.date);
  return {
    speech: `Updated to ${amount(quantity, unit, entry.spokenName)}, ${num(updated.nutrients.calories)} calories. ${entry.date === today(ctx) ? remainingSentence(s) : ""}`.trim(),
    data: {
      updated: true,
      entry_id: entry.id,
      food: entry.foodName,
      quantity,
      unit,
      before,
      after: updated.nutrients,
      remaining_today: s.remaining,
    },
  };
}

// ---------- get_daily_summary ----------

export const dailySummaryInput = z
  .object({ date: isoDate.optional().describe("Date as YYYY-MM-DD in the user's timezone. Omit for today.") })
  .strict();

export async function getDailySummary(ctx: ToolContext, input: z.infer<typeof dailySummaryInput>): Promise<ToolResult> {
  const date = input.date ?? today(ctx);
  const s = await summaryFor(ctx, date);
  const when = date === today(ctx) ? "So far today" : `On ${date}`;
  const speech =
    s.entryCount === 0
      ? `${date === today(ctx) ? "You haven't logged anything today" : `Nothing was logged on ${date}`}. Your target is ${num(s.target.calories)} calories.`
      : `${when} you've had ${num(s.eaten.calories)} of ${num(s.target.calories)} calories and ${grams(s.eaten.protein)} of ${grams(s.target.protein)} of protein.`;
  return { speech, data: { ...s } };
}

// ---------- get_remaining_budget ----------

export const remainingBudgetInput = z.object({}).strict();

export async function getRemainingBudget(ctx: ToolContext): Promise<ToolResult> {
  const s = await summaryFor(ctx, today(ctx));
  const hint = coachingHint(s, localHour(ctx.deps.now(), ctx.user.timezone));
  const head =
    s.over.calories > 0
      ? `You're ${num(s.over.calories)} calories over today, with ${grams(s.remaining.protein)} of protein still to go.`
      : `You have ${num(s.remaining.calories)} calories, ${grams(s.remaining.protein)} of protein, ${grams(s.remaining.carbs)} of carbs and ${grams(s.remaining.fat)} of fat left.`;
  return { speech: `${head} ${hint}`, data: { date: s.date, remaining: s.remaining, eaten: s.eaten, target: s.target, hint } };
}

// ---------- suggest_meal ----------

export const suggestMealInput = z
  .object({
    ingredients: z.array(z.string().min(1)).max(15).optional().describe("Ingredients the user has available, e.g. ['chicken', 'rice', 'broccoli']."),
    constraints: z.array(z.string().min(1)).max(10).optional().describe("Dietary constraints, e.g. ['vegetarian', 'no dairy']."),
    meal_type: mealType.optional().describe("Which meal the suggestion is for."),
    count: z.number().int().min(1).max(3).optional().describe("How many ideas to return, 1 to 3. Defaults to 2."),
  })
  .strict();

export async function suggestMeal(ctx: ToolContext, input: z.infer<typeof suggestMealInput>): Promise<ToolResult> {
  const { deps } = ctx;
  const s = await summaryFor(ctx, today(ctx));
  const drafts = await deps.llm.suggestMeals({
    remaining: s.remaining,
    ...(input.meal_type ? { mealType: input.meal_type } : {}),
    ingredients: input.ingredients ?? [],
    constraints: input.constraints ?? [],
    count: input.count ?? 2,
  });

  // Ground every idea in FDC data; drop ingredients we cannot resolve rather than invent numbers.
  const ideas = [];
  for (const d of drafts) {
    const ingredients = [];
    for (const ing of d.ingredients) {
      const food = pickCandidate(ing.searchQuery, await deps.nutrition.search(ing.searchQuery));
      if (!food) continue;
      ingredients.push({ food: ing.food, fdc_id: food.fdcId, fdc_description: food.description, grams: Math.round(ing.grams), nutrients: round(scale(food.per100g, ing.grams)) });
    }
    if (ingredients.length === 0) continue;
    ideas.push({ name: d.name, description: d.description, ingredients, estimated: round(sum(ingredients.map((i) => i.nutrients))) });
  }
  if (ideas.length === 0) throw new UserFacingError("I couldn't put together a meal idea right now. Try naming a few ingredients you have.");

  const first = ideas[0]!;
  const speech =
    `Try ${first.name.toLowerCase()}: about ${num(first.estimated.calories)} calories and ${grams(first.estimated.protein)} of protein.` +
    (ideas.length > 1 ? ` Or ${ideas[1]!.name.toLowerCase()}, about ${num(ideas[1]!.estimated.calories)} calories.` : "");
  return { speech, data: { remaining_today: s.remaining, ideas } };
}

// ---------- set_goals ----------

export const setGoalsInput = z
  .object({
    calories: z.number().int().min(1000).max(6000).optional().describe("Daily calorie target in kcal."),
    protein: z.number().min(20).max(400).optional().describe("Daily protein target in grams."),
    carbs: z.number().min(0).max(800).optional().describe("Daily carbohydrate target in grams."),
    fat: z.number().min(10).max(300).optional().describe("Daily fat target in grams."),
    goal_type: z.enum(["cut", "maintain", "bulk"]).optional().describe("cut to lose fat, maintain, or bulk to gain muscle."),
    profile: z
      .object({
        weight: z.number().positive().describe("Body weight."),
        weight_unit: z.enum(["kg", "lb"]).describe("Unit for weight."),
        height: z.number().positive().describe("Height."),
        height_unit: z.enum(["cm", "in"]).describe("Unit for height."),
        age: z.number().int().min(14).max(100),
        sex: z.enum(["male", "female"]),
        activity: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
      })
      .strict()
      .optional()
      .describe("Body profile used to compute targets with the Mifflin-St Jeor equation when calories are not given."),
  })
  .strict();

export async function setGoals(ctx: ToolContext, input: z.infer<typeof setGoalsInput>): Promise<ToolResult> {
  const { store } = ctx.deps;
  let profile: Profile | undefined;
  if (input.profile) {
    const p = input.profile;
    profile = {
      weightKg: p.weight_unit === "lb" ? p.weight * 0.453592 : p.weight,
      heightCm: p.height_unit === "in" ? p.height * 2.54 : p.height,
      age: p.age,
      sex: p.sex,
      activity: p.activity,
    };
    await store.putProfile(ctx.user.id, profile);
  }

  let goals: Goals;
  let method: "direct" | "mifflin_st_jeor";
  if (input.calories !== undefined) {
    goals = completeGoals({
      calories: input.calories,
      ...(input.protein !== undefined ? { protein: input.protein } : {}),
      ...(input.carbs !== undefined ? { carbs: input.carbs } : {}),
      ...(input.fat !== undefined ? { fat: input.fat } : {}),
      ...(input.goal_type ? { goalType: input.goal_type } : {}),
    });
    method = "direct";
  } else {
    profile ??= await store.getProfile(ctx.user.id);
    if (!profile) {
      throw new UserFacingError(
        "To calculate your targets I need your weight, height, age, sex and activity level. Or just tell me a calorie and protein target.",
      );
    }
    const computed = computeGoals(profile, input.goal_type ?? "maintain");
    goals = {
      ...computed,
      ...(input.protein !== undefined ? { protein: input.protein } : {}),
      ...(input.carbs !== undefined ? { carbs: input.carbs } : {}),
      ...(input.fat !== undefined ? { fat: input.fat } : {}),
    };
    method = "mifflin_st_jeor";
  }
  await store.putGoals(ctx.user.id, goals);
  const goalWord = goals.goalType ? ` for your ${goals.goalType}` : "";
  return {
    speech: `Done. Your daily targets${goalWord} are ${num(goals.calories)} calories, ${grams(goals.protein)} of protein, ${grams(goals.carbs)} of carbs and ${grams(goals.fat)} of fat.`,
    data: { goals, method },
  };
}

// ---------- get_weekly_report ----------

export const weeklyReportInput = z
  .object({ end_date: isoDate.optional().describe("Last day of the 7-day window as YYYY-MM-DD. Omit for today.") })
  .strict();

export async function getWeeklyReport(ctx: ToolContext, input: z.infer<typeof weeklyReportInput>): Promise<ToolResult> {
  const end = input.end_date ?? today(ctx);
  const [entries, goals] = await Promise.all([ctx.deps.store.listEntries(ctx.user.id, addDays(end, -6), end), goalsFor(ctx)]);
  const r = weeklyReport(end, entries, goals);
  if (r.daysLogged === 0) return { speech: `You haven't logged anything in the last 7 days. ${r.tip}`, data: { ...r } };
  const best = r.bestDay ? ` Your best day was ${r.bestDay.weekday}.` : "";
  const speech =
    `Over the last 7 days you averaged ${num(r.averageIntake.calories)} calories and ${grams(r.averageIntake.protein)} of protein, ` +
    `and hit your targets on ${r.adherencePercent} percent of days.${best} ${r.tip}`;
  return { speech, data: { ...r } };
}

// ---------- search_food ----------

export const searchFoodInput = z
  .object({
    query: z.string().min(2).max(100).describe("The food to look up, e.g. 'Greek yogurt'."),
    quantity: z.number().positive().max(10000).optional().describe("Amount to report nutrition for. Omit for a typical serving."),
    unit: z.string().optional().describe("Unit for quantity, e.g. 'g', 'cup', 'oz', or empty for a count."),
  })
  .strict();

export async function searchFood(ctx: ToolContext, input: z.infer<typeof searchFoodInput>): Promise<ToolResult> {
  const { nutrition } = ctx.deps;
  const food = pickCandidate(input.query, await nutrition.search(input.query));
  if (!food) throw new UserFacingError(`I couldn't find ${input.query} in the USDA database.`);
  const portions = await nutrition.portions(food.fdcId);

  let label: string;
  let g: number;
  if (input.quantity !== undefined) {
    const unit = normalizeUnit(input.unit);
    const gpu = gramsPerUnit(unit, portions);
    if (gpu === undefined) throw new UserFacingError(`I don't know how much one ${unit || "serving"} of ${input.query} weighs. Try grams or cups.`);
    g = gpu * input.quantity;
    label = amount(input.quantity, unit, input.query.toLowerCase());
  } else if (portions[0]) {
    const p = portions[0];
    g = p.gramWeight;
    label = `${p.description} of ${input.query.toLowerCase()}`;
  } else {
    g = 100;
    label = `100 grams of ${input.query.toLowerCase()}`;
  }
  const n = round(scale(food.per100g, g));
  const article = /^1\b/.test(label) ? label.replace(/^1\b/, "One") : label.replace(/^\w/, (c) => c.toUpperCase());
  return {
    speech: `${article}, about ${grams(g)}, has ${grams(n.protein)} of protein, ${grams(n.carbs)} of carbs, ${grams(n.fat)} of fat and ${num(n.calories)} calories.`,
    data: { fdc_id: food.fdcId, food: food.description, data_type: food.dataType, grams: Math.round(g), nutrients: n, per_100g: food.per100g, portions },
  };
}
