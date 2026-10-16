import { describe, expect, it } from "vitest";
import { addDays, lastNDays, localDate, localHour } from "../src/domain/dates.js";
import { bmr, completeGoals, computeGoals, tdee } from "../src/domain/goals.js";
import { add, percentOf, remaining, round, scale, sum } from "../src/domain/macros.js";
import { coachingHint, dailySummary, weeklyReport } from "../src/domain/report.js";
import type { Goals, LogEntry, Nutrients } from "../src/domain/types.js";

const egg: Nutrients = { calories: 149, protein: 10, carbs: 1.6, fat: 11, fiber: 0 };

describe("macro math", () => {
  it("scales per-100g values", () => {
    expect(round(scale(egg, 122))).toEqual({ calories: 182, protein: 12.2, carbs: 2, fat: 13.4, fiber: 0 });
  });
  it("adds and sums", () => {
    expect(add(egg, egg).calories).toBe(298);
    expect(sum([egg, egg, egg]).protein).toBe(30);
    expect(sum([]).calories).toBe(0);
  });
  it("clamps remaining at zero", () => {
    const target = { calories: 100, protein: 50, carbs: 0, fat: 5, fiber: 10 };
    expect(remaining(target, egg)).toEqual({ calories: 0, protein: 40, carbs: 0, fat: 0, fiber: 10 });
  });
  it("computes percent of target", () => {
    expect(percentOf({ calories: 2000, protein: 100, carbs: 0, fat: 50, fiber: 25 }, egg)).toEqual({
      calories: 7,
      protein: 10,
      carbs: 0,
      fat: 22,
      fiber: 0,
    });
  });
});

describe("goal calculation (Mifflin-St Jeor)", () => {
  const male = { weightKg: 80, heightCm: 180, age: 30, sex: "male" as const, activity: "moderate" as const };
  const female = { weightKg: 60, heightCm: 165, age: 28, sex: "female" as const, activity: "light" as const };

  it("computes BMR", () => {
    expect(bmr(male)).toBe(1780); // 800 + 1125 - 150 + 5
    expect(bmr(female)).toBeCloseTo(1330.25, 2); // 600 + 1031.25 - 140 - 161
  });
  it("applies activity factors", () => {
    expect(tdee(male)).toBeCloseTo(2759, 0);
  });
  it("derives cut, maintain and bulk targets", () => {
    const cut = computeGoals(male, "cut");
    const maintain = computeGoals(male, "maintain");
    const bulk = computeGoals(male, "bulk");
    expect(maintain.calories).toBe(2760);
    expect(cut.calories).toBe(2260);
    expect(bulk.calories).toBe(3060);
    expect(cut.protein).toBe(160);
    // Macros add back up to calories within rounding.
    const kcal = cut.protein * 4 + cut.carbs * 4 + cut.fat * 9;
    expect(Math.abs(kcal - cut.calories)).toBeLessThan(10);
  });
  it("never goes below the calorie floor", () => {
    const tiny = { weightKg: 40, heightCm: 145, age: 70, sex: "female" as const, activity: "sedentary" as const };
    expect(computeGoals(tiny, "cut").calories).toBe(1200);
  });
  it("completes partial goals", () => {
    const g = completeGoals({ calories: 2000, protein: 150 });
    expect(g).toMatchObject({ calories: 2000, protein: 150, fat: 56, carbs: 224, fiber: 28 });
  });
});

describe("dates", () => {
  it("computes the local date in a timezone", () => {
    expect(localDate(new Date("2026-10-17T05:00:00Z"), "America/Los_Angeles")).toBe("2026-10-16");
    expect(localDate(new Date("2026-10-17T05:00:00Z"), "Asia/Shanghai")).toBe("2026-10-17");
    expect(localHour(new Date("2026-10-16T15:00:00Z"), "America/Los_Angeles")).toBe(8);
  });
  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(lastNDays("2026-10-16", 3)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
  });
});

function entry(date: string, n: Partial<Nutrients>, mealType: LogEntry["mealType"] = "lunch"): LogEntry {
  const nutrients = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, ...n };
  return {
    id: `${date}-${Math.random()}`,
    userId: "u",
    date,
    eatenAt: `${date}T12:00:00Z`,
    mealType,
    foodName: "x",
    spokenName: "x",
    fdcId: 1,
    quantity: 1,
    unit: "",
    gramsPerUnit: 100,
    per100g: nutrients,
    nutrients,
  };
}

const goals: Goals = { calories: 2000, protein: 150, carbs: 200, fat: 60, fiber: 28 };

describe("daily summary and hints", () => {
  it("aggregates one day only", () => {
    const s = dailySummary("2026-10-16", [entry("2026-10-16", { calories: 500, protein: 30 }), entry("2026-10-15", { calories: 900 })], goals);
    expect(s.eaten.calories).toBe(500);
    expect(s.remaining.calories).toBe(1500);
    expect(s.entryCount).toBe(1);
    expect(s.meals).toHaveLength(1);
  });
  it("flags protein lagging behind calories", () => {
    const s = dailySummary("2026-10-16", [entry("2026-10-16", { calories: 1500, protein: 20 })], goals);
    expect(coachingHint(s, 13)).toMatch(/protein/);
  });
  it("reports being over", () => {
    const s = dailySummary("2026-10-16", [entry("2026-10-16", { calories: 2300, protein: 160 })], goals);
    expect(s.over.calories).toBe(300);
    expect(coachingHint(s, 13)).toMatch(/over/);
  });
});

describe("weekly report", () => {
  it("computes averages, adherence and best and worst days", () => {
    const entries = [
      entry("2026-10-10", { calories: 2000, protein: 150 }),
      entry("2026-10-11", { calories: 2100, protein: 140 }),
      entry("2026-10-12", { calories: 2900, protein: 90 }),
      entry("2026-10-13", { calories: 1950, protein: 155 }),
      entry("2026-10-14", { calories: 2050, protein: 100 }),
    ];
    const r = weeklyReport("2026-10-16", entries, goals);
    expect(r.startDate).toBe("2026-10-10");
    expect(r.daysLogged).toBe(5);
    expect(r.averageIntake.calories).toBe(2200);
    expect(r.adherencePercent).toBe(43); // 3 of 7 days on target
    expect(r.bestDay?.date).toBe("2026-10-10");
    expect(r.worstDay?.date).toBe("2026-10-12");
    expect(r.tip).toMatch(/protein/);
  });
  it("handles an empty week", () => {
    const r = weeklyReport("2026-10-16", [], goals);
    expect(r.daysLogged).toBe(0);
    expect(r.bestDay).toBeUndefined();
    expect(r.tip).toMatch(/Log/);
  });
});
