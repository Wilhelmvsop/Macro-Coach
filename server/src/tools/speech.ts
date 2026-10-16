/** Helpers for short, speakable text: no markdown, rounded numbers, natural lists. */

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function grams(n: number): string {
  const r = Math.round(n);
  return `${r} ${r === 1 ? "gram" : "grams"}`;
}

export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function qty(q: number): string {
  if (q === 0.5) return "half a";
  if (q === 0.25) return "a quarter";
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

/** "2 scrambled eggs", "1 cup of white rice", "150 grams of chicken". */
export function amount(quantity: number, unit: string, food: string): string {
  const plural = quantity !== 1 && quantity > 1;
  if (!unit) return `${qty(quantity)} ${plural && !/s$/.test(food) ? `${food}s` : food}`;
  if (unit === "g") return `${num(quantity)} grams of ${food}`;
  if (unit === "small" || unit === "medium" || unit === "large") return `${qty(quantity)} ${unit} ${food}${plural ? "s" : ""}`;
  return `${qty(quantity)} ${unit}${plural && !/s$/.test(unit) ? "s" : ""} of ${food}`;
}
