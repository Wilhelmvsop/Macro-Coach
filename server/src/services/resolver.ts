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
  return s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
}

/** Picks the candidate whose description covers the most query words; ties keep FDC's ranking. */
export function pickCandidate(query: string, candidates: FoodCandidate[]): FoodCandidate | undefined {
  const q = words(query).map((w) => w.replace(/s$/, ""));
  let best: FoodCandidate | undefined;
  let bestScore = -1;
  for (const c of candidates) {
    const d = c.description.toLowerCase();
    const hits = q.filter((w) => d.includes(w)).length;
    // Prefer short, generic descriptions ("Bananas, raw") over branded mouthfuls.
    const score = hits * 10 - Math.min(5, Math.floor(d.length / 20));
    if (score > bestScore) {
      best = c;
      bestScore = score;
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
  const candidates = await nutrition.search(item.searchQuery || item.food);
  const food = pickCandidate(item.searchQuery || item.food, candidates);
  if (!food) {
    return { ok: false, question: `I couldn't find ${item.food} in the nutrition database. Could you describe it differently?` };
  }
  const portions = await nutrition.portions(food.fdcId);
  const g = gramsPerUnit(item.unit, portions);
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
