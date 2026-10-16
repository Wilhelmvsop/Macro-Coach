/** Core nutrient vector used everywhere. Energy in kcal, the rest in grams. */
export interface Nutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export type GoalType = "cut" | "maintain" | "bulk";
export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export interface Profile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activity: ActivityLevel;
}

/** Daily targets. Fiber is a target too so the summary can report it. */
export type Goals = Nutrients & { goalType?: GoalType };

export interface User {
  id: string;
  name: string;
  /** IANA timezone; dates ("today") are computed in this zone. */
  timezone: string;
}

export interface LogEntry {
  id: string;
  userId: string;
  /** Local calendar date (YYYY-MM-DD) in the user's timezone. */
  date: string;
  /** ISO timestamp of when the food was eaten. */
  eatenAt: string;
  mealType: MealType;
  /** Display name of the resolved food, e.g. "Egg, scrambled". */
  foodName: string;
  /** What the user said for this item, e.g. "scrambled eggs". */
  spokenName: string;
  fdcId: number;
  quantity: number;
  unit: string;
  gramsPerUnit: number;
  /** Nutrients per 100 g of the resolved food; lets edits rescale without a lookup. */
  per100g: Nutrients;
  nutrients: Nutrients;
}
