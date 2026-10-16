import type { Nutrients } from "../domain/types.js";
import { log } from "../logger.js";
import type { FoodCandidate, NutritionSource, Portion } from "../ports.js";

const BASE = "https://api.nal.usda.gov/fdc/v1";
const DATA_TYPES = ["Survey (FNDDS)", "SR Legacy", "Foundation"];

/** FDC nutrient IDs. Foundation foods sometimes report energy only as Atwater factors (2047/2048). */
const NUTRIENT_IDS: Record<keyof Nutrients, number[]> = {
  calories: [1008, 2047, 2048],
  protein: [1003],
  carbs: [1005],
  fat: [1004],
  fiber: [1079],
};

interface FdcNutrient {
  nutrientId?: number;
  value?: number;
  amount?: number;
  nutrient?: { id: number };
}

interface FdcFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: FdcNutrient[];
}

interface FdcPortion {
  gramWeight?: number;
  amount?: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { name?: string };
}

/** Simple TTL cache; FDC data changes rarely, so hits are safe for a day. */
class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  constructor(private readonly ttlMs: number, private readonly max = 2000) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit || hit.expires < Date.now()) return undefined;
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

export function extractNutrients(list: FdcNutrient[]): Nutrients {
  const byId = new Map<number, number>();
  for (const n of list) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const v = n.value ?? n.amount;
    if (id !== undefined && typeof v === "number") byId.set(id, v);
  }
  const pick = (ids: number[]) => ids.map((id) => byId.get(id)).find((v) => v !== undefined) ?? 0;
  return {
    calories: pick(NUTRIENT_IDS.calories),
    protein: pick(NUTRIENT_IDS.protein),
    carbs: pick(NUTRIENT_IDS.carbs),
    fat: pick(NUTRIENT_IDS.fat),
    fiber: pick(NUTRIENT_IDS.fiber),
  };
}

function leadingNumber(s: string): number | undefined {
  const m = /^\s*(\d+)\s*\/\s*(\d+)|^\s*(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return undefined;
  return m[3] !== undefined ? Number(m[3]) : Number(m[1]) / Number(m[2]);
}

export function toPortion(p: FdcPortion): Portion | undefined {
  if (!p.gramWeight || p.gramWeight <= 0) return undefined;
  const desc = p.portionDescription && !/not specified/i.test(p.portionDescription) ? p.portionDescription : undefined;
  if (desc) return { description: desc, gramWeight: p.gramWeight, amount: leadingNumber(desc) ?? 1 };
  const unit = p.measureUnit?.name && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
  const amount = p.amount ?? 1;
  // FNDDS uses numeric codes such as "90000" as the modifier for "quantity not specified".
  const modifier = p.modifier && !/^\d+$/.test(p.modifier) ? p.modifier : unit ? "" : "serving";
  const description = [amount, unit, modifier].join(" ").replace(/\s+/g, " ").trim();
  return { description, gramWeight: p.gramWeight, amount };
}

/** USDA FoodData Central client with in-process caching. */
export class FdcNutritionSource implements NutritionSource {
  private readonly searchCache = new TtlCache<FoodCandidate[]>(24 * 3600_000);
  private readonly detailCache = new TtlCache<{ food: FoodCandidate; portions: Portion[] }>(24 * 3600_000);

  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string): Promise<FoodCandidate[]> {
    const key = query.trim().toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached) return cached;
    // Require every word first for precision; fall back to any-word matching when that finds nothing.
    let raw = await this.searchOnce(key, true);
    if (raw.length === 0) raw = await this.searchOnce(key, false);
    const foods = raw.map((x) => ({
      fdcId: x.fdcId,
      description: x.description,
      dataType: x.dataType,
      per100g: extractNutrients(x.foodNutrients ?? []),
    }));
    log.info("fdc.search", { query: key, results: foods.length });
    this.searchCache.set(key, foods);
    return foods;
  }

  private async searchOnce(query: string, requireAllWords: boolean): Promise<FdcFood[]> {
    const res = await this.fetchImpl(`${BASE}/foods/search?api_key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, dataType: DATA_TYPES, pageSize: 25, requireAllWords }),
    });
    if (!res.ok) throw new Error(`FDC search failed with status ${res.status}`);
    const body = (await res.json()) as { foods?: FdcFood[] };
    return body.foods ?? [];
  }

  async portions(fdcId: number): Promise<Portion[]> {
    return (await this.details(fdcId))?.portions ?? [];
  }

  async food(fdcId: number): Promise<FoodCandidate | undefined> {
    return (await this.details(fdcId))?.food;
  }

  /** One /food/{id} call gives both nutrients and portions; cache them together. */
  private async details(fdcId: number): Promise<{ food: FoodCandidate; portions: Portion[] } | undefined> {
    const key = String(fdcId);
    const cached = this.detailCache.get(key);
    if (cached) return cached;
    const res = await this.fetchImpl(`${BASE}/food/${fdcId}?api_key=${encodeURIComponent(this.apiKey)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`FDC food lookup failed with status ${res.status}`);
    const body = (await res.json()) as FdcFood & { foodPortions?: FdcPortion[] };
    const value = {
      food: { fdcId: body.fdcId, description: body.description, dataType: body.dataType, per100g: extractNutrients(body.foodNutrients ?? []) },
      portions: (body.foodPortions ?? []).map(toPortion).filter((p): p is Portion => p !== undefined),
    };
    this.detailCache.set(key, value);
    return value;
  }
}
