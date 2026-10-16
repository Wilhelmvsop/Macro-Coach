import type { Portion } from "../ports.js";

/** Grams per mass unit. */
const MASS: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
/** Millilitres per volume unit, used only when a portion for the unit is missing. */
const VOLUME_ML: Record<string, number> = { ml: 1, l: 1000, cup: 240, tbsp: 15, tsp: 5, "fl oz": 29.5735 };

const ALIASES: Record<string, string> = {
  g: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  cup: "cup", cups: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  serving: "serving", servings: "serving",
  bowl: "bowl", bowls: "bowl",
  glass: "glass", glasses: "glass",
  scoop: "scoop", scoops: "scoop",
  can: "can", cans: "can",
  container: "container", containers: "container",
  fillet: "fillet", fillets: "fillet",
  small: "small", medium: "medium", large: "large",
  "": "",
};

export function normalizeUnit(raw: string | undefined): string {
  const u = (raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  return ALIASES[u] ?? u;
}

export function isKnownUnitWord(word: string): boolean {
  return word.toLowerCase() in ALIASES && word !== "";
}

export function isMassUnit(unit: string): boolean {
  return unit in MASS;
}

/** Words in a portion description that mean "one of the thing itself". */
const COUNT_HINTS = ["medium", "large", "whole", "piece", "item", "each", "egg", "fruit", "small", "regular", "nlea serving"];

function describes(p: Portion, word: string): boolean {
  return new RegExp(`\\b${word.replace(/ /g, "\\s")}s?\\b`, "i").test(p.description);
}

/** Portion descriptions that are a volume or mass measure, not a count. */
function isMeasure(p: Portion): boolean {
  return /\b(cup|tbsp|tablespoon|tsp|teaspoon|oz|ounce|fl oz|ml|g|gram|lb|pound)s?\b/i.test(p.description);
}

/**
 * Grams for one `unit` of a food, using the food's portion list.
 * Returns undefined when we cannot determine a weight without guessing.
 */
export function gramsPerUnit(unit: string, portions: Portion[]): number | undefined {
  if (isMassUnit(unit)) return MASS[unit];

  const per = (p: Portion) => p.gramWeight / (p.amount > 0 ? p.amount : 1);

  if (unit === "fl oz") {
    const match = portions.find((p) => describes(p, "fl oz"));
    if (match) return per(match);
  } else if (unit !== "") {
    const match = portions.find((p) => describes(p, unit));
    if (match) return per(match);
  }

  if (unit in VOLUME_ML) {
    // Derive from another volume portion (e.g. we know "1 cup" and need "1 tbsp").
    for (const [vu, ml] of Object.entries(VOLUME_ML)) {
      const match = portions.find((p) => describes(p, vu) && !(vu === "l" || vu === "ml"));
      if (match) return (per(match) / ml) * VOLUME_ML[unit]!;
    }
    return undefined;
  }

  if (unit === "" || unit === "piece" || unit === "serving") {
    for (const hint of ["medium", "large", ...COUNT_HINTS]) {
      const match = portions.find((p) => describes(p, hint) && !isMeasure(p));
      if (match) return per(match);
    }
    const plain = portions.find((p) => !isMeasure(p) && /^1\b/.test(p.description.trim()));
    if (plain) return per(plain);
  }
  return undefined;
}
