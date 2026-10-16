import { lastNDays, weekdayName } from "./dates.js";
import { percentOf, remaining, round, sum } from "./macros.js";
import type { Goals, LogEntry, Nutrients } from "./types.js";

export interface DailySummary {
  date: string;
  eaten: Nutrients;
  target: Nutrients;
  remaining: Nutrients;
  percent: Nutrients;
  over: { calories: number };
  entryCount: number;
  meals: { mealType: string; items: { id: string; name: string; quantity: number; unit: string; calories: number }[] }[];
}

function targetOf(goals: Goals): Nutrients {
  const { calories, protein, carbs, fat, fiber } = goals;
  return { calories, protein, carbs, fat, fiber };
}

export function dailySummary(date: string, entries: LogEntry[], goals: Goals): DailySummary {
  const dayEntries = entries.filter((e) => e.date === date);
  const eaten = round(sum(dayEntries.map((e) => e.nutrients)));
  const target = targetOf(goals);
  const order = ["breakfast", "lunch", "dinner", "snack"];
  const meals = order
    .map((mealType) => ({
      mealType,
      items: dayEntries
        .filter((e) => e.mealType === mealType)
        .map((e) => ({ id: e.id, name: e.foodName, quantity: e.quantity, unit: e.unit, calories: e.nutrients.calories })),
    }))
    .filter((m) => m.items.length > 0);
  return {
    date,
    eaten,
    target,
    remaining: round(remaining(target, eaten)),
    percent: percentOf(target, eaten),
    over: { calories: Math.max(0, Math.round(eaten.calories - target.calories)) },
    entryCount: dayEntries.length,
    meals,
  };
}

/** One-line, speakable coaching hint based on what is left today. */
export function coachingHint(s: DailySummary, localHour: number): string {
  if (s.entryCount === 0) return "Nothing logged yet today. Start with a protein-rich meal.";
  if (s.over.calories > 0) return "You're over your calories for today, so keep the rest of the day light and focus on water and vegetables.";
  const r = s.remaining;
  if (r.calories < 150) return "You're right on target. If you're hungry, pick something light like vegetables or a small yogurt.";
  const proteinShare = (r.protein * 4) / r.calories;
  if (proteinShare > 0.5) return "Your protein is lagging behind your calories, so make your next meal lean protein like chicken, fish, tofu or Greek yogurt.";
  if (localHour >= 20 && r.calories > 700) return "You still have plenty of calories left. A balanced dinner with protein and carbs will close the gap.";
  if (r.fiber > 10) return "Add some fiber with vegetables, beans or fruit in your next meal.";
  return "You're on track. Keep your next meal balanced with protein, carbs and vegetables.";
}

export interface WeeklyReport {
  startDate: string;
  endDate: string;
  daysLogged: number;
  averageIntake: Nutrients;
  target: Nutrients;
  adherencePercent: number;
  bestDay?: { date: string; weekday: string; calories: number; protein: number };
  worstDay?: { date: string; weekday: string; calories: number; protein: number };
  days: { date: string; calories: number; protein: number; carbs: number; fat: number; fiber: number; onTarget: boolean; logged: boolean }[];
  tip: string;
}

/** A day is on target when calories are within 10% of target and protein reaches 90%. */
function dayScore(n: Nutrients, t: Nutrients): number {
  const cal = t.calories > 0 ? Math.abs(n.calories - t.calories) / t.calories : 0;
  const prot = t.protein > 0 ? Math.max(0, (t.protein - n.protein) / t.protein) : 0;
  return cal + prot;
}

function onTarget(n: Nutrients, t: Nutrients): boolean {
  return Math.abs(n.calories - t.calories) <= t.calories * 0.1 && n.protein >= t.protein * 0.9;
}

export function weeklyReport(endDate: string, entries: LogEntry[], goals: Goals): WeeklyReport {
  const dates = lastNDays(endDate, 7);
  const target = targetOf(goals);
  const days = dates.map((date) => {
    const list = entries.filter((e) => e.date === date);
    const n = round(sum(list.map((e) => e.nutrients)));
    return { date, ...n, logged: list.length > 0, onTarget: list.length > 0 && onTarget(n, target) };
  });
  const logged = days.filter((d) => d.logged);
  const total = sum(logged);
  const n = Math.max(1, logged.length);
  const averageIntake = round({
    calories: total.calories / n,
    protein: total.protein / n,
    carbs: total.carbs / n,
    fat: total.fat / n,
    fiber: total.fiber / n,
  });
  const ranked = [...logged].sort((a, b) => dayScore(a, target) - dayScore(b, target));
  const pick = (d: (typeof days)[number] | undefined) =>
    d && { date: d.date, weekday: weekdayName(d.date), calories: d.calories, protein: d.protein };
  const report: WeeklyReport = {
    startDate: dates[0]!,
    endDate,
    daysLogged: logged.length,
    averageIntake,
    target,
    adherencePercent: Math.round((days.filter((d) => d.onTarget).length / 7) * 100),
    days,
    tip: "",
  };
  const best = pick(ranked[0]);
  const worst = ranked.length > 1 ? pick(ranked[ranked.length - 1]) : undefined;
  if (best) report.bestDay = best;
  if (worst) report.worstDay = worst;
  report.tip = weeklyTip(report);
  return report;
}

function weeklyTip(r: WeeklyReport): string {
  const a = r.averageIntake;
  const t = r.target;
  if (r.daysLogged === 0) return "Log at least one meal a day this week so I can coach you.";
  if (r.daysLogged < 5) return "Try to log every day this week; consistent tracking is the biggest predictor of progress.";
  if (a.protein < t.protein * 0.9) {
    const gap = Math.round(t.protein - a.protein);
    return `You averaged ${gap} grams of protein below target. Add a protein source like Greek yogurt or eggs to breakfast.`;
  }
  if (a.calories > t.calories * 1.1) return "You averaged more than 10 percent over your calories. Watch portion sizes at dinner and snacks.";
  if (a.calories < t.calories * 0.85) return "You're eating well under your target, which can cost muscle and energy. Add a snack between meals.";
  if (a.fiber < t.fiber * 0.7) return "Your fiber is low. Add a serving of vegetables or beans to lunch and dinner.";
  return "Great consistency. Keep the same routine and aim to hit protein every day.";
}
