/**
 * Local intent router used only when the Bedrock-backed assistant is unavailable.
 * It maps an utterance to one MCP tool call so the demo keeps working offline.
 */
export interface RoutedCall {
  name: string;
  args: Record<string, unknown>;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5, a: 1, an: 1 };

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const clean = s.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : NUMBER_WORDS[clean.toLowerCase()];
}

export function routeUtterance(text: string): RoutedCall {
  const t = text.trim();
  const lower = t.toLowerCase();

  const edit = /(?:actually\s+)?(?:make (?:that|it)|change (?:that|it) to)\s+(\w+|\d+(?:\.\d+)?)\s+([a-z ]+?)(?:,|\.|$| not| instead)/i.exec(t);
  if (edit && num(edit[1]) !== undefined) {
    return { name: "edit_log_entry", args: { food: edit[2]!.trim().replace(/s$/, ""), quantity: num(edit[1]) } };
  }
  const remove = /(?:remove|delete|undo)\s+(?:the\s+)?([a-z ]+)/i.exec(t);
  if (remove) return { name: "edit_log_entry", args: { food: remove[1]!.trim().replace(/s$/, ""), remove: true } };

  if (/\b(goal|target)s?\b/.test(lower) && /\bset\b|\bchange\b|\bupdate\b/.test(lower)) {
    const cal = /([\d,]+)\s*(?:calories|kcal|cal)\b/i.exec(t);
    const protein = /([\d,]+)\s*(?:g|grams?)\s*(?:of\s*)?protein/i.exec(t);
    const goalType = /\bcut\b|\blose\b/.test(lower) ? "cut" : /\bbulk\b|\bgain\b/.test(lower) ? "bulk" : /\bmaintain\b/.test(lower) ? "maintain" : undefined;
    return {
      name: "set_goals",
      args: {
        ...(num(cal?.[1]) !== undefined ? { calories: num(cal?.[1]) } : {}),
        ...(num(protein?.[1]) !== undefined ? { protein: num(protein?.[1]) } : {}),
        ...(goalType ? { goal_type: goalType } : {}),
      },
    };
  }

  if (/this week|last week|past week|weekly|how did i do/.test(lower)) return { name: "get_weekly_report", args: {} };

  if (/what should i eat|suggest|ideas? for|what can i (?:eat|make|have)/.test(lower)) {
    const have = /i (?:have|got)\s+(.+?)(?:\.|\?|$)/i.exec(t);
    const ingredients = have ? have[1]!.split(/,|\band\b/).map((s) => s.trim()).filter(Boolean) : [];
    const meal = /\b(breakfast|lunch|dinner|snack)\b/.exec(lower)?.[1];
    return { name: "suggest_meal", args: { ...(ingredients.length ? { ingredients } : {}), ...(meal ? { meal_type: meal } : {}) } };
  }

  const lookup = /how much (?:protein|calories|carbs|fat|fiber) (?:is|are) (?:there )?in (?:a |an |one )?(.+?)\??$/i.exec(t);
  if (lookup) return { name: "search_food", args: { query: lookup[1]!.trim() } };

  if (/left|remaining|still need|how much more|budget/.test(lower)) return { name: "get_remaining_budget", args: {} };
  if (/today|so far|summary|how am i doing/.test(lower)) return { name: "get_daily_summary", args: {} };

  const meal = /\b(breakfast|lunch|dinner|snack)\b/.exec(lower)?.[1];
  return { name: "log_meal", args: { description: t, ...(meal ? { meal_type: meal } : {}) } };
}
