import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { errorFields, log } from "../logger.js";
import type { Llm, MealIdeaDraft, ParseResult, SuggestRequest } from "../ports.js";
import { normalizeUnit } from "../parsing/units.js";

const ParseSchema = z.object({
  items: z.array(
    z.object({
      food: z.string().min(1),
      search_query: z.string().min(1),
      quantity: z.number().positive(),
      unit: z.string(),
    }),
  ),
  clarification: z.string().optional(),
});

const SuggestSchema = z.object({
  meals: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      ingredients: z.array(z.object({ food: z.string(), search_query: z.string(), grams: z.number().positive() })).min(1),
    }),
  ),
});

const PARSE_TOOL: Tool = {
  toolSpec: {
    name: "record_meal_items",
    description: "Record the food items, quantities and units extracted from the user's meal description.",
    inputSchema: {
      json: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["food", "search_query", "quantity", "unit"],
              properties: {
                food: { type: "string", description: "The food as the user said it, singular, e.g. 'scrambled egg'." },
                search_query: {
                  type: "string",
                  description: "A short generic query for the USDA FoodData Central database, e.g. 'egg scrambled', 'rice white cooked'.",
                },
                quantity: { type: "number", description: "Numeric amount. 'a' or 'an' is 1, 'half' is 0.5." },
                unit: {
                  type: "string",
                  description:
                    "One of: g, kg, oz, lb, ml, l, cup, tbsp, tsp, fl oz, slice, piece, serving, scoop, can, small, medium, large, or empty string for a plain count like 'two eggs'.",
                },
              },
            },
          },
          clarification: {
            type: "string",
            description: "Only when the description is too vague to log (e.g. 'some food'): one short question to ask the user.",
          },
        },
      },
    },
  },
};

const SUGGEST_TOOL: Tool = {
  toolSpec: {
    name: "propose_meals",
    description: "Propose concrete meals with ingredient weights in grams.",
    inputSchema: {
      json: {
        type: "object",
        additionalProperties: false,
        required: ["meals"],
        properties: {
          meals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "description", "ingredients"],
              properties: {
                name: { type: "string" },
                description: { type: "string", description: "One sentence, plain English." },
                ingredients: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["food", "search_query", "grams"],
                    properties: {
                      food: { type: "string" },
                      search_query: { type: "string", description: "Generic USDA FoodData Central query, e.g. 'chicken breast roasted'." },
                      grams: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const PARSE_SYSTEM =
  "You extract foods from spoken meal descriptions for a nutrition tracker. " +
  "Call record_meal_items exactly once. Split combined descriptions into separate items. " +
  "Never invent amounts the user did not imply: a plain count like 'two eggs' has quantity 2 and an empty unit. " +
  "Ignore words about time or meal type. If no food can be identified, return no items and a clarification question.";

const SUGGEST_SYSTEM =
  "You are a practical sports nutrition coach. Call propose_meals exactly once. " +
  "Propose simple, realistic meals that fit the remaining macro budget, prefer the user's available ingredients, " +
  "and respect dietary constraints. Give each ingredient a weight in grams. Do not state nutrition numbers; they are computed from USDA data.";

/** Amazon Bedrock (Claude via the Converse API) implementation of the Llm port. */
export class BedrockLlm implements Llm {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly modelId: string, region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  private async callTool(system: string, user: string, tool: Tool): Promise<unknown> {
    const started = Date.now();
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: user }] }],
        toolConfig: { tools: [tool], toolChoice: { auto: {} } },
        inferenceConfig: { maxTokens: 4000 },
      }),
    );
    const content: ContentBlock[] = res.output?.message?.content ?? [];
    log.info("bedrock.converse", {
      model: this.modelId,
      tool: tool.toolSpec?.name,
      ms: Date.now() - started,
      stopReason: res.stopReason,
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
    });
    const toolUse = content.find((b) => b.toolUse?.name === tool.toolSpec?.name)?.toolUse;
    if (toolUse) return toolUse.input;
    // Fall back to JSON in a text block if the model answered without calling the tool.
    const text = content.map((b) => b.text ?? "").join("");
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (json) return JSON.parse(json);
    throw new Error(`Model did not return ${tool.toolSpec?.name}`);
  }

  async parseMeal(text: string): Promise<ParseResult> {
    const raw = ParseSchema.parse(await this.callTool(PARSE_SYSTEM, text, PARSE_TOOL));
    return {
      items: raw.items.map((i) => ({ food: i.food, searchQuery: i.search_query, quantity: i.quantity, unit: normalizeUnit(i.unit) })),
      ...(raw.clarification ? { clarification: raw.clarification } : {}),
    };
  }

  async suggestMeals(req: SuggestRequest): Promise<MealIdeaDraft[]> {
    const prompt = JSON.stringify({
      remaining_today: req.remaining,
      meal_type: req.mealType ?? "any",
      available_ingredients: req.ingredients,
      dietary_constraints: req.constraints,
      number_of_meals: req.count,
    });
    const raw = SuggestSchema.parse(await this.callTool(SUGGEST_SYSTEM, prompt, SUGGEST_TOOL));
    return raw.meals.slice(0, req.count).map((m) => ({
      name: m.name,
      description: m.description,
      ingredients: m.ingredients.map((i) => ({ food: i.food, searchQuery: i.search_query, grams: i.grams })),
    }));
  }
}

/** Uses the primary LLM and falls back to a secondary one (the rule engine) on any error. */
export class FallbackLlm implements Llm {
  constructor(private readonly primary: Llm, private readonly secondary: Llm) {}

  async parseMeal(text: string): Promise<ParseResult> {
    try {
      return await this.primary.parseMeal(text);
    } catch (err) {
      log.warn("llm.parse.fallback", errorFields(err));
      return this.secondary.parseMeal(text);
    }
  }

  async suggestMeals(req: SuggestRequest): Promise<MealIdeaDraft[]> {
    try {
      return await this.primary.suggestMeals(req);
    } catch (err) {
      log.warn("llm.suggest.fallback", errorFields(err));
      return this.secondary.suggestMeals(req);
    }
  }
}
