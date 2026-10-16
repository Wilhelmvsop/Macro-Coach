import type { FoodCandidate, NutritionSource, Portion } from "../ports.js";

interface FixtureFood extends FoodCandidate {
  keywords: string[];
  portions: Portion[];
}

const f = (
  fdcId: number,
  description: string,
  keywords: string[],
  [calories, protein, carbs, fat, fiber]: [number, number, number, number, number],
  portions: [string, number, number?][],
): FixtureFood => ({
  fdcId,
  description,
  dataType: "Fixture (SR Legacy values)",
  keywords,
  per100g: { calories, protein, carbs, fat, fiber },
  portions: portions.map(([description, gramWeight, amount]) => ({ description, gramWeight, amount: amount ?? 1 })),
});

/**
 * Offline food table with per-100 g values taken from USDA SR Legacy.
 * Used by tests and by local development when FDC_API_KEY is not set.
 * IDs are in the 900000 range so they are never confused with real FDC IDs.
 */
export const FIXTURE_FOODS: FixtureFood[] = [
  f(900001, "Egg, scrambled", ["egg", "scrambled"], [149, 10, 1.6, 11, 0], [["1 large", 61], ["1 cup", 220]]),
  f(900002, "Egg, whole, boiled", ["egg", "boiled", "hard"], [155, 12.6, 1.1, 10.6, 0], [["1 large", 50], ["1 cup, chopped", 136]]),
  f(900003, "Bananas, raw", ["banana"], [89, 1.1, 22.8, 0.3, 2.6], [["1 medium", 118], ["1 large", 136], ["1 cup, sliced", 150]]),
  f(900004, "Chicken breast, roasted", ["chicken", "breast"], [165, 31, 0, 3.6, 0], [["1 breast", 172], ["3 oz", 85], ["1 cup, chopped", 140]]),
  f(900005, "Rice, white, cooked", ["rice", "white"], [130, 2.7, 28.2, 0.3, 0.4], [["1 cup", 158]]),
  f(900006, "Broccoli, cooked", ["broccoli"], [35, 2.4, 7.2, 0.4, 3.3], [["1 cup, chopped", 156], ["1 spear", 37]]),
  f(900007, "Yogurt, Greek, plain, nonfat", ["yogurt", "greek"], [59, 10.2, 3.6, 0.4, 0], [["1 container", 170], ["1 cup", 245]]),
  f(900008, "Oatmeal, cooked with water", ["oatmeal", "oat", "porridge"], [71, 2.5, 12, 1.5, 1.7], [["1 cup", 234]]),
  f(900009, "Salmon, Atlantic, cooked", ["salmon"], [206, 22.1, 0, 12.4, 0], [["1 fillet", 154], ["3 oz", 85]]),
  f(900010, "Bread, whole wheat", ["bread", "toast", "wheat"], [252, 12.4, 42.7, 3.5, 6], [["1 slice", 32]]),
  f(900011, "Peanut butter, smooth", ["peanut", "butter"], [588, 25, 20, 50, 6], [["1 tbsp", 16], ["2 tbsp", 32, 2]]),
  f(900012, "Apples, raw, with skin", ["apple"], [52, 0.3, 13.8, 0.2, 2.4], [["1 medium", 182], ["1 large", 223]]),
  f(900013, "Milk, reduced fat, 2%", ["milk"], [50, 3.3, 4.8, 2, 0], [["1 cup", 244]]),
  f(900014, "Sweet potato, baked", ["sweet", "potato"], [90, 2, 20.7, 0.2, 3.3], [["1 medium", 114]]),
  f(900015, "Olive oil", ["olive", "oil"], [884, 0, 0, 100, 0], [["1 tbsp", 13.5]]),
  f(900016, "Avocados, raw", ["avocado"], [160, 2, 8.5, 14.7, 6.7], [["1 fruit", 201]]),
  f(900017, "Tofu, firm", ["tofu"], [144, 17.3, 2.8, 8.7, 2.3], [["1/2 cup", 126, 0.5]]),
  f(900018, "Spinach, raw", ["spinach"], [23, 2.9, 3.6, 0.4, 2.2], [["1 cup", 30]]),
  f(900019, "Pasta, cooked", ["pasta", "spaghetti", "noodle"], [158, 5.8, 30.9, 0.9, 1.8], [["1 cup", 140]]),
  f(900020, "Beef, ground, 90% lean, cooked", ["beef", "ground", "steak"], [217, 26.1, 0, 11.7, 0], [["3 oz", 85]]),
  f(900021, "Blueberries, raw", ["blueberry", "berries"], [57, 0.7, 14.5, 0.3, 2.4], [["1 cup", 148]]),
  f(900022, "Almonds", ["almond", "nuts"], [579, 21.2, 21.6, 49.9, 12.5], [["1 oz", 28.35]]),
  f(900023, "Black beans, cooked", ["black", "beans", "bean"], [132, 8.9, 23.7, 0.5, 8.7], [["1 cup", 172]]),
  f(900024, "Cheese, cheddar", ["cheese", "cheddar"], [403, 22.9, 3.4, 33.3, 0], [["1 slice", 28], ["1 cup, shredded", 113]]),
  f(900025, "Salad greens, mixed", ["salad", "greens", "lettuce"], [17, 1.2, 3.3, 0.2, 2.1], [["1 cup", 47]]),
  f(900026, "Pizza, cheese, regular crust", ["pizza"], [266, 11.4, 33.3, 9.7, 2.3], [["1 slice", 107]]),
  f(900027, "Protein powder, whey", ["protein", "whey", "shake"], [400, 80, 8, 6, 0], [["1 scoop", 30]]),
];

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, ""));
}

export class FixtureNutritionSource implements NutritionSource {
  constructor(private readonly foods: FixtureFood[] = FIXTURE_FOODS) {}

  async search(query: string): Promise<FoodCandidate[]> {
    const q = tokens(query);
    return this.foods
      .map((food) => {
        const kws = food.keywords.flatMap(tokens);
        return { food, hits: q.filter((w) => kws.includes(w)).length };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map(({ food: { fdcId, description, dataType, per100g } }) => ({ fdcId, description, dataType, per100g }));
  }

  async portions(fdcId: number): Promise<Portion[]> {
    return this.foods.find((x) => x.fdcId === fdcId)?.portions ?? [];
  }
}
