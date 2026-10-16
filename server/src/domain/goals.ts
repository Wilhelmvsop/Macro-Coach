import type { ActivityLevel, GoalType, Goals, Profile } from "./types.js";

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT: Record<GoalType, number> = { cut: -500, maintain: 0, bulk: 300 };
/** Protein in grams per kg of body weight; higher on a cut to protect lean mass. */
const PROTEIN_PER_KG: Record<GoalType, number> = { cut: 2.0, maintain: 1.6, bulk: 1.8 };
const FAT_SHARE = 0.25;
const MIN_CALORIES = 1200;

/** Basal metabolic rate via Mifflin-St Jeor. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "male" ? base + 5 : base - 161;
}

export function tdee(p: Profile): number {
  return bmr(p) * ACTIVITY_FACTOR[p.activity];
}

/** Derives daily targets from a profile and goal type. */
export function computeGoals(p: Profile, goalType: GoalType): Goals {
  const calories = Math.max(MIN_CALORIES, Math.round((tdee(p) + GOAL_ADJUSTMENT[goalType]) / 10) * 10);
  const protein = Math.round(p.weightKg * PROTEIN_PER_KG[goalType]);
  const fat = Math.round((calories * FAT_SHARE) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = Math.round((calories / 1000) * 14);
  return { calories, protein, carbs, fat, fiber, goalType };
}

/**
 * Fills in macros the user did not specify. Given calories (and maybe protein),
 * splits the rest 25% fat, remainder carbs.
 */
export function completeGoals(input: Partial<Goals> & { calories: number }): Goals {
  const calories = input.calories;
  const protein = input.protein ?? Math.round((calories * 0.3) / 4);
  const fat = input.fat ?? Math.round((calories * FAT_SHARE) / 9);
  const carbs = input.carbs ?? Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = input.fiber ?? Math.round((calories / 1000) * 14);
  return { calories, protein, carbs, fat, fiber, ...(input.goalType ? { goalType: input.goalType } : {}) };
}

export const DEFAULT_GOALS: Goals = completeGoals({ calories: 2000, protein: 120 });
