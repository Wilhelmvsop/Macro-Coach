import type { Goals, LogEntry, MealType, Nutrients, Profile, User } from "./domain/types.js";

/** Persistence. Implemented by the in-memory adapter (dev/tests) and DynamoDB (prod). */
export interface Store {
  getUserByToken(token: string): Promise<User | undefined>;
  putUser(user: User, token: string): Promise<void>;
  getGoals(userId: string): Promise<Goals | undefined>;
  putGoals(userId: string, goals: Goals): Promise<void>;
  getProfile(userId: string): Promise<Profile | undefined>;
  putProfile(userId: string, profile: Profile): Promise<void>;
  addEntries(entries: LogEntry[]): Promise<void>;
  /** Entries with fromDate <= date <= toDate, oldest first. */
  listEntries(userId: string, fromDate: string, toDate: string): Promise<LogEntry[]>;
  /** Most recent entries by eatenAt, newest first. */
  recentEntries(userId: string, limit: number): Promise<LogEntry[]>;
  getEntry(userId: string, entryId: string): Promise<LogEntry | undefined>;
  replaceEntry(entry: LogEntry): Promise<void>;
  deleteEntry(userId: string, entryId: string): Promise<void>;
}

export interface FoodCandidate {
  fdcId: number;
  description: string;
  dataType: string;
  per100g: Nutrients;
}

export interface Portion {
  /** Human description such as "1 large" or "1 cup, chopped". */
  description: string;
  gramWeight: number;
  /** How many of the unit the gramWeight covers (usually 1). */
  amount: number;
}

/** Nutrition data source (USDA FoodData Central in production). */
export interface NutritionSource {
  search(query: string): Promise<FoodCandidate[]>;
  portions(fdcId: number): Promise<Portion[]>;
}

export interface ParsedItem {
  /** Food as the user described it, e.g. "scrambled eggs". */
  food: string;
  /** Concise query for the nutrition database, e.g. "egg scrambled". */
  searchQuery: string;
  quantity: number;
  /** Canonical unit, see parsing/units.ts. Empty string means a count ("two eggs"). */
  unit: string;
}

export interface ParseResult {
  items: ParsedItem[];
  /** Set when the description is too vague to log; a question to ask the user. */
  clarification?: string;
}

export interface MealIdeaDraft {
  name: string;
  description: string;
  ingredients: { food: string; searchQuery: string; grams: number }[];
}

export interface SuggestRequest {
  remaining: Nutrients;
  mealType?: MealType;
  ingredients: string[];
  constraints: string[];
  count: number;
}

/** Language model used to parse meal text and draft meal ideas (Bedrock in production). */
export interface Llm {
  parseMeal(text: string): Promise<ParseResult>;
  suggestMeals(req: SuggestRequest): Promise<MealIdeaDraft[]>;
}

export interface Deps {
  store: Store;
  nutrition: NutritionSource;
  llm: Llm;
  now: () => Date;
  newId: () => string;
}
