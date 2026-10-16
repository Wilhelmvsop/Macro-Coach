import { describe, expect, it } from "vitest";
import { gramsPerUnit } from "../src/parsing/units.js";
import type { FoodCandidate, NutritionSource, Portion } from "../src/ports.js";
import { findFood, pickCandidate } from "../src/services/resolver.js";
import "./helpers.js";

const c = (fdcId: number, description: string, calories = 100): FoodCandidate => ({
  fdcId,
  description,
  dataType: "Survey (FNDDS)",
  per100g: { calories, protein: 1, carbs: 1, fat: 1, fiber: 0 },
});

// Real descriptions returned by FoodData Central search, in FDC's own order.
describe("pickCandidate on real FDC result lists", () => {
  it("prefers the raw fruit over processed forms", () => {
    const list = [c(1, "Bananas, dehydrated, or banana powder"), c(2, "Banana, baked"), c(3, "Banana, raw"), c(4, "Banana chips")];
    expect(pickCandidate("banana", list)?.fdcId).toBe(3);
  });
  it("prefers plain cooked rice over mixed dishes", () => {
    const list = [c(1, "Beans and white rice"), c(2, "Rice, white, cooked, glutinous"), c(3, "Rice, white, cooked, no added fat"), c(4, "Dirty rice")];
    expect(pickCandidate("white rice", list)?.fdcId).toBe(3);
  });
  it("looks past category prefixes and avoids fried or coated", () => {
    const list = [c(1, "Lomi salmon"), c(2, "Salmon salad"), c(3, "Fish, salmon, fried"), c(4, "Fish, salmon, baked or broiled")];
    expect(pickCandidate("salmon", list)?.fdcId).toBe(4);
  });
  it("avoids branded and flavored entries", () => {
    const list = [c(1, "Yogurt, Greek, Blueberry, CHOBANI"), c(2, "Yogurt, Greek, strawberry, lowfat"), c(3, "Yogurt, Greek, plain, lowfat")];
    expect(pickCandidate("greek yogurt", list)?.fdcId).toBe(3);
  });
  it("ignores entries without energy data", () => {
    expect(pickCandidate("chicken breast", [c(1, "Lunchmeat, chicken breast, sliced", 0), c(2, "Chicken breast, rotisserie, skin not eaten")])?.fdcId).toBe(2);
  });
});

describe("findFood", () => {
  it("uses a curated FDC ID for common foods and falls back to search", async () => {
    const calls: string[] = [];
    const src: NutritionSource = {
      search: async (q) => {
        calls.push(`search:${q}`);
        return [c(9, "Dirty rice")];
      },
      portions: async () => [],
      food: async (id) => (id === 2708408 ? c(2708408, "Rice, white, cooked, no added fat") : undefined),
    };
    expect((await findFood(src, "Rice"))?.fdcId).toBe(2708408);
    expect(calls).toEqual([]);
    expect((await findFood(src, "fried rice"))?.fdcId).toBe(9);
  });
});

describe("gramsPerUnit with FNDDS-style portions", () => {
  const banana: Portion[] = [
    { description: "1 cup, mashed", gramWeight: 225, amount: 1 },
    { description: "1 banana", gramWeight: 126, amount: 1 },
  ];
  it("matches the food name for a plain count", () => {
    expect(gramsPerUnit("", banana, "banana")).toBe(126);
  });
  it("skips dry-measure portions", () => {
    const oats: Portion[] = [{ description: "1 cup, dry, yields", gramWeight: 485, amount: 1 }, { description: "1 cup, cooked", gramWeight: 234, amount: 1 }];
    expect(gramsPerUnit("cup", oats)).toBe(234);
  });
  it("prefers a regular slice over a snack-size one", () => {
    const bread: Portion[] = [{ description: "1 slice, snack-size", gramWeight: 10, amount: 1 }, { description: "1 large or thick slice", gramWeight: 43, amount: 1 }];
    expect(gramsPerUnit("slice", bread)).toBe(43);
  });
  it("treats a pizza piece as a slice and tablespoon as tbsp", () => {
    expect(gramsPerUnit("slice", [{ description: "1 piece, medium pizza", gramWeight: 86, amount: 1 }])).toBe(86);
    expect(gramsPerUnit("tbsp", [{ description: "1 tablespoon", gramWeight: 16, amount: 1 }])).toBe(16);
  });
});
