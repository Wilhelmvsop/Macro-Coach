import { describe, expect, it } from "vitest";
import { parseItem, parseQuantity, ruleParseMeal, singular } from "../src/parsing/ruleParser.js";
import { gramsPerUnit, normalizeUnit } from "../src/parsing/units.js";
import type { Portion } from "../src/ports.js";

describe("parseQuantity", () => {
  it.each([
    ["2", 2],
    ["1.5", 1.5],
    ["1/2", 0.5],
    ["two", 2],
    ["a", 1],
    ["half", 0.5],
    ["dozen", 12],
  ])("parses %s", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it("returns undefined for non-numbers", () => {
    expect(parseQuantity("egg")).toBeUndefined();
  });
});

describe("singular", () => {
  it.each([
    ["eggs", "egg"],
    ["berries", "berry"],
    ["potatoes", "potato"],
    ["hummus", "hummus"],
    ["glass", "glass"],
  ])("%s -> %s", (a, b) => expect(singular(a)).toBe(b));
});

describe("normalizeUnit", () => {
  it.each([
    ["cups", "cup"],
    ["Tablespoons", "tbsp"],
    ["grams", "g"],
    ["ounces", "oz"],
    ["lbs", "lb"],
    ["", ""],
    ["slices", "slice"],
  ])("%s -> %s", (a, b) => expect(normalizeUnit(a)).toBe(b));
});

describe("parseItem", () => {
  it("parses a count with an adjective", () => {
    expect(parseItem("two scrambled eggs")).toEqual({ food: "scrambled egg", searchQuery: "scrambled egg", quantity: 2, unit: "" });
  });
  it("parses a volume", () => {
    expect(parseItem("1 cup of rice")).toEqual({ food: "rice", searchQuery: "rice", quantity: 1, unit: "cup" });
  });
  it("keeps decimal quantities", () => {
    expect(parseItem("1.5 cups white rice.")).toMatchObject({ quantity: 1.5, unit: "cup", food: "white rice" });
  });
  it("parses half a cup", () => {
    expect(parseItem("half a cup of oatmeal")).toMatchObject({ quantity: 0.5, unit: "cup", food: "oatmeal" });
  });
  it("defaults the quantity to 1", () => {
    expect(parseItem("banana")).toMatchObject({ quantity: 1, unit: "", food: "banana" });
  });
  it("does not treat a unit word as food when it is the only word", () => {
    expect(parseItem("2 large")).toMatchObject({ food: "large", unit: "" });
  });
});

describe("ruleParseMeal", () => {
  it("splits the breakfast example into two items", () => {
    const r = ruleParseMeal("I had two scrambled eggs and a banana for breakfast.");
    expect(r.clarification).toBeUndefined();
    expect(r.items).toEqual([
      { food: "scrambled egg", searchQuery: "scrambled egg", quantity: 2, unit: "" },
      { food: "banana", searchQuery: "banana", quantity: 1, unit: "" },
    ]);
  });

  it("handles commas and 'with'", () => {
    const r = ruleParseMeal("150 g chicken breast, 1 cup rice with broccoli");
    expect(r.items.map((i) => [i.quantity, i.unit, i.food])).toEqual([
      [150, "g", "chicken breast"],
      [1, "cup", "rice"],
      [1, "", "broccoli"],
    ]);
  });

  it("asks for clarification when nothing is recognisable", () => {
    const r = ruleParseMeal("I had breakfast");
    expect(r.items).toHaveLength(0);
    expect(r.clarification).toMatch(/didn't catch/);
  });
});

describe("gramsPerUnit", () => {
  const portions: Portion[] = [
    { description: "1 large", gramWeight: 61, amount: 1 },
    { description: "1 cup", gramWeight: 220, amount: 1 },
  ];

  it("converts mass units directly", () => {
    expect(gramsPerUnit("g", [])).toBe(1);
    expect(gramsPerUnit("oz", [])).toBeCloseTo(28.35, 1);
  });
  it("uses a matching portion", () => {
    expect(gramsPerUnit("cup", portions)).toBe(220);
    expect(gramsPerUnit("large", portions)).toBe(61);
  });
  it("derives tbsp from a cup portion", () => {
    expect(gramsPerUnit("tbsp", portions)).toBeCloseTo(220 / 16, 1);
  });
  it("uses a count portion for a plain count", () => {
    expect(gramsPerUnit("", portions)).toBe(61);
  });
  it("respects portion amounts", () => {
    expect(gramsPerUnit("cup", [{ description: "1/2 cup", gramWeight: 126, amount: 0.5 }])).toBe(252);
  });
  it("returns undefined rather than guessing", () => {
    expect(gramsPerUnit("", [{ description: "1 cup", gramWeight: 158, amount: 1 }])).toBeUndefined();
    expect(gramsPerUnit("slice", portions)).toBeUndefined();
  });
});

describe("spoken amounts", async () => {
  const { amount } = await import("../src/tools/speech.js");
  it.each([
    [3, "oz", "ground beef", "3 ounces of ground beef"],
    [2, "tbsp", "peanut butter", "2 tablespoons of peanut butter"],
    [1, "cup", "rice", "1 cup of rice"],
    [2, "", "scrambled egg", "2 scrambled eggs"],
    [0.5, "cup", "oatmeal", "half a cup of oatmeal"],
    [150, "g", "chicken", "150 grams of chicken"],
  ])("%s %s %s", (q, u, f, expected) => {
    expect(amount(q as number, u as string, f as string)).toBe(expected);
  });
});
