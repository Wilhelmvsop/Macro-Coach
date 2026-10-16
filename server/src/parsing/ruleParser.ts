import type { ParseResult, ParsedItem } from "../ports.js";
import { isKnownUnitWord, normalizeUnit } from "./units.js";

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2, dozen: 12,
};

const FILLER = /\b(i|i've|i've|just|had|ate|have|eaten|drank|for|breakfast|lunch|dinner|snack|a bowl of|some|of|my|this|morning|tonight|today)\b/gi;

/** Parses "1.5", "1/2", "two", "half a" into a number. */
export function parseQuantity(token: string): number | undefined {
  const t = token.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return NUMBER_WORDS[t];
}

/** Very small English singularizer for food nouns. */
export function singular(word: string): string {
  if (/(ss|us)$/i.test(word)) return word;
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
  if (/(oes|ches|shes)$/i.test(word)) return word.replace(/es$/i, "");
  if (/s$/i.test(word)) return word.replace(/s$/i, "");
  return word;
}

/** Parses one phrase like "two scrambled eggs" or "1 cup of rice". */
export function parseItem(phrase: string): ParsedItem | undefined {
  const words = phrase.replace(/[!?]|\.(?!\d)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;

  let quantity: number | undefined;
  let i = 0;
  const first = parseQuantity(words[0]!);
  if (first !== undefined) {
    quantity = first;
    i = 1;
    // "half a cup", "a couple of"
    if (words[i] && /^(a|an|of)$/i.test(words[i]!)) i++;
  }
  let unit = "";
  if (words[i] && isKnownUnitWord(words[i]!) && words.length > i + 1) {
    unit = normalizeUnit(words[i]);
    i++;
    if (words[i]?.toLowerCase() === "of") i++;
  }
  const foodWords = words.slice(i);
  if (foodWords.length === 0) return undefined;
  foodWords[foodWords.length - 1] = singular(foodWords[foodWords.length - 1]!);
  const food = foodWords.join(" ").toLowerCase();
  return { food, searchQuery: food, quantity: quantity ?? 1, unit };
}

/**
 * Deterministic fallback parser for meal descriptions. Used in tests, local dev
 * without AWS credentials, and when the LLM call fails.
 */
export function ruleParseMeal(text: string): ParseResult {
  const cleaned = ` ${text} `.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  const phrases = cleaned.split(/\s*(?:,|\band\b|\bwith\b|\bplus\b|&)\s*/i).filter((p) => p.trim().length > 0);
  const items = phrases.map(parseItem).filter((x): x is ParsedItem => x !== undefined);
  if (items.length === 0) {
    return { items: [], clarification: "I didn't catch what you ate. Could you say the food and the amount?" };
  }
  return { items };
}
