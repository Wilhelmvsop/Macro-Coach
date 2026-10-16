import { round, scale } from "../domain/macros.js";
import type { Nutrients } from "../domain/types.js";
import type { FoodCandidate, NutritionSource, ParsedItem } from "../ports.js";
import { gramsPerUnit } from "../parsing/units.js";

export interface ResolvedItem {
  item: ParsedItem;
  food: FoodCandidate;
  gramsPerUnit: number;
  grams: number;
  nutrients: Nutrients;
}

export type Resolution = { ok: true; value: ResolvedItem } | { ok: false; question: string };

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, ""));
}

/** Processed or prepared forms that are almost never what someone means by a plain food name. */
const UNLIKELY = [
  "dehydrated", "powder", "chip", "pudding", "nectar", "juice", "sandwich", "cookie", "cracker", "soup", "salad", "flour",
  "oil", "baby", "lunchmeat", "breaded", "fried", "skin eaten", "feet", "frozen", "canned", "dried", "pie", "cake", "bar",
  "strawberry", "blueberry", "vanilla", "honey", "chocolate", "with", " and ", "dessert", "candy", "mix", "roll", "sauce",
  "coated", "coating", "skin", "glutinous", "dirty", "flavored", "malted", "seasoned", "benedict", "dressing", "fat added", "made with oil",
  "yogurt", "topping", "stuffed", "evaporated", "lactose free",
];
const CATEGORY_PREFIXES = ["fish", "beverages", "cereals", "snacks", "spices"];
const PREP = ["cooked", "roasted", "grilled", "baked", "boiled", "steamed", "broiled", "scrambled", "poached"];
/** Foods normally eaten cooked; for these a cooked entry beats a raw one. */
const USUALLY_COOKED = ["rice", "chicken", "salmon", "beef", "pork", "turkey", "pasta", "oatmeal", "egg", "fish", "potato", "quinoa", "lentil", "bean", "tofu", "shrimp"];

/**
 * Ranks FDC candidates for a plain food name. Prefers entries whose leading
 * segment is the food itself ("Bananas, raw"), cooked forms of foods usually
 * eaten cooked, and generic over processed or branded entries.
 */
export function scoreCandidate(query: string, c: FoodCandidate): number {
  if (c.per100g.calories <= 0) return -Infinity;
  const q = words(query);
  const d = c.description.toLowerCase();
  const dw = words(c.description);
  const head = q[q.length - 1] ?? "";
  // FDC groups some foods under a category ("Fish, salmon, grilled"); look past it.
  const segments = d.split(",").map((s) => s.trim());
  const lead = CATEGORY_PREFIXES.includes(segments[0] ?? "") && segments.length > 1 ? segments[1]! : segments[0]!;
  const first = words(lead);
  let score = q.filter((w) => dw.includes(w)).length * 10;
  // "Rice, white, cooked" for "rice" beats "Dirty rice"; "Chicken breast, ..." for "chicken breast".
  if (first.length > 0 && first.every((w) => q.includes(w))) score += 8;
  else if (first.includes(head)) score += 2;
  if (/\bnfs\b/.test(d)) score += 2;
  if (/\bns as to\b|\bas ingredient\b|\bomelet\b/.test(d)) score -= 3;
  const queryHasPrep = PREP.some((p) => query.toLowerCase().includes(p));
  if (!queryHasPrep) {
    const cooked = USUALLY_COOKED.some((f) => q.includes(f));
    if (cooked && PREP.some((p) => d.includes(p))) score += 3;
    if (!cooked && /\braw\b/.test(d)) score += 3;
    if (cooked && /\braw\b/.test(d)) score -= 4;
  }
  if (/\bplain\b/.test(d)) score += 2;
  for (const u of UNLIKELY) {
    const w = u.trim();
    // Whole words only: "oil" must not match "broiled".
    if (new RegExp(`\\b${w}(s|es)?\\b`).test(d) && !query.toLowerCase().includes(w)) score -= 8;
  }
  // Brand names are written in capitals in FDC descriptions.
  if (/\b[A-Z]{3,}\b/.test(c.description)) score -= 5;
  score -= dw.filter((w) => !q.includes(w)).length;
  return score;
}

/**
 * Curated FDC entries for the most common foods, where FDC's own search ranking
 * tends to surface a prepared or unusual variant first (e.g. "rice" -> "Dirty rice").
 * Values are still fetched live from FDC by ID.
 */
const DEFAULT_FDC_IDS: Record<string, number> = {
  rice: 2708408, "white rice": 2708408, "cooked rice": 2708408, "rice white cooked": 2708408,
  oatmeal: 173905, oat: 173905, porridge: 173905, "oatmeal cooked": 173905,
  egg: 2707154, "boiled egg": 2707154, "hard boiled egg": 2707154, "scrambled egg": 172187, "egg scrambled": 172187,
  chicken: 171477, "chicken breast": 171477, "grilled chicken": 171477, "roasted chicken breast": 171477, "chicken breast roasted": 171477,
  milk: 2705386, "black bean": 173735, almond: 2707489,
  salmon: 2706286, "salmon fillet": 2706286, "baked salmon": 2706286,
  "sweet potato": 2709699, bread: 2707709, toast: 2707709, "whole wheat bread": 2707709, "wheat bread": 2707709,
  "greek yogurt": 2705424, "plain greek yogurt": 2705424,
  pizza: 2708616, "cheese pizza": 2708616, tofu: 172475, "firm tofu": 172475,
};

/** Finds the best FDC food for a plain name: curated default first, then ranked search. */
export async function findFood(nutrition: NutritionSource, query: string): Promise<FoodCandidate | undefined> {
  const id = DEFAULT_FDC_IDS[words(query).join(" ")];
  if (id !== undefined) {
    const food = await nutrition.food(id);
    if (food) return food;
  }
  return pickCandidate(query, await nutrition.search(query));
}

/** Words too vague to look up; logging them would mean inventing numbers. */
const VAGUE = new Set(["food", "something", "stuff", "thing", "meal", "snack", "breakfast", "lunch", "dinner", "bite", "leftover", "junk"]);

/** Picks the best candidate; ties keep FDC's own ranking. */
export function pickCandidate(query: string, candidates: FoodCandidate[]): FoodCandidate | undefined {
  let best: FoodCandidate | undefined;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreCandidate(query, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

function describeAmount(item: ParsedItem): string {
  return item.unit ? `${item.quantity} ${item.unit} of ${item.food}` : `${item.quantity} ${item.food}`;
}

/**
 * Resolves a parsed item against the nutrition source. Never guesses a weight:
 * if neither the unit nor the food's portion data gives grams, asks a question.
 */
export async function resolveItem(nutrition: NutritionSource, item: ParsedItem): Promise<Resolution> {
  if (words(item.food).every((w) => VAGUE.has(w))) {
    return { ok: false, question: "What exactly did you eat? Tell me the food and roughly how much." };
  }
  const food = (await findFood(nutrition, item.food)) ?? (await findFood(nutrition, item.searchQuery));
  if (!food) {
    return { ok: false, question: `I couldn't find ${item.food} in the nutrition database. Could you describe it differently?` };
  }
  const portions = await nutrition.portions(food.fdcId);
  const g = gramsPerUnit(item.unit, portions, item.food);
  if (g === undefined) {
    const unitPart = item.unit ? `one ${item.unit}` : "one";
    return {
      ok: false,
      question: `I'm not sure how much ${unitPart} of ${item.food} weighs. Could you give the amount in grams, ounces or cups?`,
    };
  }
  const grams = g * item.quantity;
  return { ok: true, value: { item, food, gramsPerUnit: g, grams, nutrients: round(scale(food.per100g, grams)) } };
}

export { describeAmount };
