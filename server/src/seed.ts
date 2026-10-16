import { addDays, localDate } from "./domain/dates.js";
import { completeGoals } from "./domain/goals.js";
import type { LogEntry, MealType, User } from "./domain/types.js";
import { log } from "./logger.js";
import { ruleParseMeal } from "./parsing/ruleParser.js";
import type { Deps } from "./ports.js";
import { resolveItem } from "./services/resolver.js";

export const DEMO_USER: User = { id: "judge-demo", name: "Demo Judge", timezone: "America/Los_Angeles" };

type DayPlan = [MealType, string, string][]; // meal, local time, description

/** Six days of realistic history; today is left empty so the demo can log breakfast live. */
const WEEK: DayPlan[] = [
  [["breakfast", "07:30", "1 cup oatmeal and a banana and 2 tbsp peanut butter"], ["lunch", "12:30", "1 chicken breast and 1.5 cups white rice and 1 cup broccoli"], ["dinner", "19:00", "1 salmon fillet and 1 medium sweet potato"], ["snack", "16:00", "1 container greek yogurt and 1 apple"]],
  [["breakfast", "08:00", "two scrambled eggs and 1 slice whole wheat bread"], ["lunch", "13:00", "1 cup pasta and 3 oz ground beef and 1 slice cheddar cheese"], ["dinner", "19:30", "3 slices pizza"], ["snack", "21:00", "1 oz almonds and 1 cup milk"]],
  [["breakfast", "07:15", "1 container greek yogurt and 1 cup blueberries"], ["lunch", "12:15", "1 chicken breast and 1 cup broccoli and 1 cup white rice"], ["dinner", "18:45", "1 cup tofu and 1 cup black beans and 1 cup white rice and 1 tbsp olive oil"]],
  [["breakfast", "09:00", "2 slices whole wheat bread and 2 tbsp peanut butter"], ["lunch", "14:00", "1 cup salad greens and 1 slice cheddar cheese"], ["dinner", "20:30", "2 slices pizza and 1 cup milk"], ["snack", "22:00", "1 oz almonds"]],
  [["breakfast", "07:30", "three scrambled eggs and a banana"], ["lunch", "12:30", "1 chicken breast and 1 cup white rice and 1 cup broccoli"], ["dinner", "19:00", "1 salmon fillet and 1 cup spinach and 1 medium sweet potato and 1 tbsp olive oil"], ["snack", "15:30", "30 g whey protein and 1 apple"]],
  [["breakfast", "08:00", "1 cup oatmeal and 30 g whey protein"], ["lunch", "12:45", "1 cup pasta and 1 chicken breast"], ["dinner", "19:15", "3 oz ground beef and 1 cup black beans and 1 avocado"], ["snack", "16:00", "1 apple and 1 tbsp peanut butter"]],
];

/** Converts a local date and HH:MM in a timezone to an ISO instant. */
function instant(date: string, time: string, timezone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: timezone }));
  const offsetMs = local.getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

export interface SeedOptions {
  token: string;
  user?: User;
}

/** Creates the judge demo user with goals and a week of history. Safe to re-run: entry IDs are deterministic. */
export async function seedDemoUser(deps: Deps, opts: SeedOptions): Promise<{ user: User; entries: number }> {
  const user = opts.user ?? DEMO_USER;
  await deps.store.putUser(user, opts.token);
  await deps.store.putGoals(user.id, completeGoals({ calories: 1800, protein: 130, goalType: "cut" }));
  await deps.store.putProfile(user.id, { weightKg: 75, heightCm: 178, age: 30, sex: "male", activity: "moderate" });

  const today = localDate(deps.now(), user.timezone);
  const entries: LogEntry[] = [];
  for (const [i, plan] of WEEK.entries()) {
    const date = addDays(today, i - WEEK.length);
    for (const [j, [mealType, time, text]] of plan.entries()) {
      const eatenAt = instant(date, time, user.timezone);
      for (const [k, item] of ruleParseMeal(text).items.entries()) {
        const r = await resolveItem(deps.nutrition, item);
        if (!r.ok) {
          log.warn("seed.unresolved", { text, food: item.food });
          continue;
        }
        entries.push({
          id: `seed-${date}-${j}-${k}`,
          userId: user.id,
          date,
          eatenAt,
          mealType,
          foodName: r.value.food.description,
          spokenName: item.food,
          fdcId: r.value.food.fdcId,
          quantity: item.quantity,
          unit: item.unit,
          gramsPerUnit: r.value.gramsPerUnit,
          per100g: r.value.food.per100g,
          nutrients: r.value.nutrients,
        });
      }
    }
  }
  await deps.store.addEntries(entries);
  log.info("seed.done", { userId: user.id, entries: entries.length });
  return { user, entries: entries.length };
}
