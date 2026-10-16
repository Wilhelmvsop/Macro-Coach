import { describe, expect, it } from "vitest";
import { routeUtterance } from "./router";

describe("routeUtterance", () => {
  it.each([
    ["I had two scrambled eggs and a banana for breakfast.", "log_meal", { description: "I had two scrambled eggs and a banana for breakfast.", meal_type: "breakfast" }],
    ["How much protein do I still need today?", "get_remaining_budget", {}],
    ["What should I eat for dinner? I have chicken, rice and broccoli.", "suggest_meal", { ingredients: ["chicken", "rice", "broccoli"], meal_type: "dinner" }],
    ["Actually make that one egg, not two.", "edit_log_entry", { food: "egg", quantity: 1 }],
    ["How did I do this week?", "get_weekly_report", {}],
    ["I'm trying to cut. Set my goal to 2,000 calories and 150 grams of protein.", "set_goals", { calories: 2000, protein: 150, goal_type: "cut" }],
    ["How much protein is in Greek yogurt?", "search_food", { query: "Greek yogurt" }],
  ])("%s", (text, name, args) => {
    expect(routeUtterance(text)).toEqual({ name, args });
  });
});
