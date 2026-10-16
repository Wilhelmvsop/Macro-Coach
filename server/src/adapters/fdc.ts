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
  const description = [amount, unit, p.modifier ?? ""].join(" ").replace(/\s+/g, " ").trim();
  return { description, gramWeight: p.gramWeight, amount };
}

/** USDA FoodData Central client with in-process caching. */
export class FdcNutritionSource implements NutritionSource {
  private readonly searchCache = new TtlCache<FoodCandidate[]>(24 * 3600_000);
  private readonly portionCache = new TtlCache<Portion[]>(24 * 3600_000);

  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string): Promise<FoodCandidate[]> {
    const key = query.trim().toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached) return cached;
    const res = await this.fetchImpl(`${BASE}/foods/search?api_key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: key, dataType: DATA_TYPES, pageSize: 10 }),
    });
    if (!res.ok) throw new Error(`FDC search failed with status ${res.status}`);
    const body = (await res.json()) as { foods?: { fdcId: number; description: string; dataType: string; foodNutrients?: FdcNutrient[] }[] };
    const foods = (body.foods ?? []).map((x) => ({
      fdcId: x.fdcId,
      description: x.description,
      dataType: x.dataType,
      per100g: extractNutrients(x.foodNutrients ?? []),
    }));
    log.info("fdc.search", { query: key, results: foods.length });
    this.searchCache.set(key, foods);
    return foods;
  }

  async portions(fdcId: number): Promise<Portion[]> {
    const key = String(fdcId);
    const cached = this.portionCache.get(key);
    if (cached) return cached;
    const res = await this.fetchImpl(`${BASE}/food/${fdcId}?api_key=${encodeURIComponent(this.apiKey)}`);
    if (!res.ok) throw new Error(`FDC food lookup failed with status ${res.status}`);
    const body = (await res.json()) as { foodPortions?: FdcPortion[] };
    const portions = (body.foodPortions ?? []).map(toPortion).filter((p): p is Portion => p !== undefined);
    this.portionCache.set(key, portions);
    return portions;
  }
}
