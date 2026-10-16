import { describe, expect, it, vi } from "vitest";
import { FdcNutritionSource, extractNutrients, toPortion } from "../src/adapters/fdc.js";
import { FallbackLlm } from "../src/adapters/bedrockLlm.js";
import { RuleLlm } from "../src/adapters/ruleLlm.js";
import type { Llm } from "../src/ports.js";
import "./helpers.js";

describe("FDC mapping", () => {
  it("extracts nutrients from search results by nutrient ID", () => {
    expect(
      extractNutrients([
        { nutrientId: 1008, value: 149 },
        { nutrientId: 1003, value: 10 },
        { nutrientId: 1005, value: 1.6 },
        { nutrientId: 1004, value: 11 },
        { nutrientId: 1079, value: 0 },
      ]),
    ).toEqual({ calories: 149, protein: 10, carbs: 1.6, fat: 11, fiber: 0 });
  });

  it("falls back to Atwater energy for Foundation foods", () => {
    expect(extractNutrients([{ nutrient: { id: 2047 }, amount: 120 }]).calories).toBe(120);
  });

  it("maps FNDDS and SR Legacy portions", () => {
    expect(toPortion({ gramWeight: 61, portionDescription: "1 large" })).toEqual({ description: "1 large", gramWeight: 61, amount: 1 });
    expect(toPortion({ gramWeight: 126, portionDescription: "1/2 cup" })).toEqual({ description: "1/2 cup", gramWeight: 126, amount: 0.5 });
    expect(toPortion({ gramWeight: 118, amount: 1, modifier: "medium (7\" to 7-7/8\" long)", measureUnit: { name: "undetermined" } })).toMatchObject({
      description: "1 medium (7\" to 7-7/8\" long)",
      amount: 1,
    });
    expect(toPortion({ gramWeight: 0, portionDescription: "1 cup" })).toBeUndefined();
  });
});

describe("FdcNutritionSource", () => {
  it("searches, maps and caches results", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          foods: [{ fdcId: 173944, description: "Bananas, raw", dataType: "SR Legacy", foodNutrients: [{ nutrientId: 1008, value: 89 }] }],
        }),
        { status: 200 },
      ),
    );
    const fdc = new FdcNutritionSource("KEY", fetchMock as unknown as typeof fetch);
    const a = await fdc.search("Banana");
    const b = await fdc.search("banana ");
    expect(a).toEqual([{ fdcId: 173944, description: "Bananas, raw", dataType: "SR Legacy", per100g: { calories: 89, protein: 0, carbs: 0, fat: 0, fiber: 0 } }]);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toContain("/foods/search?api_key=KEY");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "banana" });
  });

  it("throws on HTTP errors so callers can respond gracefully", async () => {
    const fdc = new FdcNutritionSource("KEY", (async () => new Response("nope", { status: 429 })) as typeof fetch);
    await expect(fdc.search("egg")).rejects.toThrow(/429/);
  });
});

describe("FallbackLlm", () => {
  it("uses the rule engine when the primary model fails", async () => {
    const broken: Llm = {
      parseMeal: async () => {
        throw new Error("AccessDeniedException");
      },
      suggestMeals: async () => {
        throw new Error("throttled");
      },
    };
    const llm = new FallbackLlm(broken, new RuleLlm());
    expect((await llm.parseMeal("a banana")).items[0]).toMatchObject({ food: "banana" });
    const ideas = await llm.suggestMeals({ remaining: { calories: 800, protein: 50, carbs: 80, fat: 20, fiber: 10 }, ingredients: [], constraints: [], count: 1 });
    expect(ideas).toHaveLength(1);
  });
});
