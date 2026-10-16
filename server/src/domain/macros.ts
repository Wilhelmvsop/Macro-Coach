import type { Nutrients } from "./types.js";

export const ZERO: Nutrients = Object.freeze({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
const KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

function map(f: (k: (typeof KEYS)[number]) => number): Nutrients {
  return { calories: f("calories"), protein: f("protein"), carbs: f("carbs"), fat: f("fat"), fiber: f("fiber") };
}

/** Nutrients for `grams` of a food whose values are given per 100 g. */
export function scale(per100g: Nutrients, grams: number): Nutrients {
  return map((k) => (per100g[k] * grams) / 100);
}

export function add(a: Nutrients, b: Nutrients): Nutrients {
  return map((k) => a[k] + b[k]);
}

export function subtract(a: Nutrients, b: Nutrients): Nutrients {
  return map((k) => a[k] - b[k]);
}

export function sum(list: readonly Nutrients[]): Nutrients {
  return list.reduce(add, { ...ZERO });
}

/** Rounds calories to whole numbers and grams to one decimal, for storage and display. */
export function round(n: Nutrients): Nutrients {
  return {
    calories: Math.round(n.calories),
    protein: round1(n.protein),
    carbs: round1(n.carbs),
    fat: round1(n.fat),
    fiber: round1(n.fiber),
  };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Remaining budget, clamped at zero so we never say "you have -200 calories left". */
export function remaining(target: Nutrients, eaten: Nutrients): Nutrients {
  return map((k) => Math.max(0, target[k] - eaten[k]));
}

/** Percent of target reached per nutrient (0 when the target is 0). */
export function percentOf(target: Nutrients, eaten: Nutrients): Nutrients {
  return map((k) => (target[k] > 0 ? Math.round((eaten[k] / target[k]) * 100) : 0));
}
