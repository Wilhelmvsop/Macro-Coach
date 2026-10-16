import type { Llm, MealIdeaDraft, ParseResult, SuggestRequest } from "../ports.js";
import { ruleParseMeal } from "../parsing/ruleParser.js";

interface Template {
  name: string;
  description: string;
  ingredients: { food: string; grams: number }[];
}

/** Balanced default meals used when the user names no ingredients. */
const TEMPLATES: Template[] = [
  {
    name: "Chicken, rice and broccoli bowl",
    description: "Roasted chicken breast over white rice with steamed broccoli.",
    ingredients: [{ food: "chicken breast", grams: 150 }, { food: "white rice", grams: 158 }, { food: "broccoli", grams: 156 }],
  },
  {
    name: "Salmon with sweet potato and spinach",
    description: "Baked salmon fillet, a baked sweet potato and a side of spinach.",
    ingredients: [{ food: "salmon", grams: 140 }, { food: "sweet potato", grams: 114 }, { food: "spinach", grams: 60 }],
  },
  {
    name: "Greek yogurt berry bowl",
    description: "Nonfat Greek yogurt topped with blueberries and almonds.",
    ingredients: [{ food: "greek yogurt", grams: 245 }, { food: "blueberries", grams: 100 }, { food: "almonds", grams: 15 }],
  },
  {
    name: "Tofu and black bean rice bowl",
    description: "Firm tofu with black beans over rice.",
    ingredients: [{ food: "tofu", grams: 150 }, { food: "black beans", grams: 120 }, { food: "white rice", grams: 120 }],
  },
];

const PROTEINS = ["chicken", "salmon", "beef", "tofu", "egg", "yogurt", "fish", "turkey", "shrimp", "beans"];
const CARBS = ["rice", "pasta", "potato", "bread", "oat", "quinoa", "noodle"];

function isVegetarianOk(t: Template, constraints: string[]): boolean {
  const veg = constraints.some((c) => /vegetarian|vegan|plant/i.test(c));
  if (!veg) return true;
  return !t.ingredients.some((i) => /chicken|salmon|beef|fish|turkey|shrimp/.test(i.food));
}

/**
 * Deterministic stand-in for the LLM. Parses with the rule parser and builds
 * meal ideas from the user's ingredients, sized toward the remaining protein.
 */
export class RuleLlm implements Llm {
  async parseMeal(text: string): Promise<ParseResult> {
    return ruleParseMeal(text);
  }

  async suggestMeals(req: SuggestRequest): Promise<MealIdeaDraft[]> {
    const ideas: Template[] = [];
    if (req.ingredients.length > 0) {
      const ing = req.ingredients.map((i) => i.toLowerCase());
      const protein = ing.filter((i) => PROTEINS.some((p) => i.includes(p)));
      const carb = ing.filter((i) => CARBS.some((c) => i.includes(c)));
      const veg = ing.filter((i) => !protein.includes(i) && !carb.includes(i));
      // Size the protein portion to cover roughly the remaining protein, within sensible limits.
      const proteinGrams = Math.min(200, Math.max(100, Math.round((req.remaining.protein / 0.28) / 10) * 10));
      const carbGrams = req.remaining.carbs > 40 ? 180 : 100;
      ideas.push({
        name: `${ing.map((i) => i.replace(/^\w/, (c) => c.toUpperCase())).join(", ")} plate`,
        description: `A simple plate using what you have: ${ing.join(", ")}.`,
        ingredients: [
          ...protein.map((food) => ({ food, grams: proteinGrams })),
          ...carb.map((food) => ({ food, grams: carbGrams })),
          ...veg.map((food) => ({ food, grams: 150 })),
        ],
      });
    }
    for (const t of TEMPLATES) {
      if (ideas.length >= req.count) break;
      if (isVegetarianOk(t, req.constraints)) ideas.push(t);
    }
    return ideas.slice(0, req.count).map((t) => ({
      name: t.name,
      description: t.description,
      ingredients: t.ingredients.map((i) => ({ ...i, searchQuery: i.food })),
    }));
  }
}
