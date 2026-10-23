import { describe, expect, it } from "vitest";
import { addDays } from "../src/domain/dates.js";
import { seedDemoUser } from "../src/seed.js";
import { NOW, TODAY, USER, makeDeps } from "./helpers.js";

describe("seedDemoUser", () => {
  it("replaces earlier seeded history instead of piling it up", async () => {
    const deps = makeDeps();
    await seedDemoUser(deps, { token: "t", user: USER });
    const first = await deps.store.listEntries(USER.id, addDays(TODAY, -30), TODAY);

    // Seed again two days later, as the nightly job would.
    const later = { ...deps, now: () => new Date(NOW.getTime() + 2 * 86_400_000) };
    await seedDemoUser(later, { token: "t", user: USER });
    const second = await deps.store.listEntries(USER.id, addDays(TODAY, -30), addDays(TODAY, 2));
    expect(second.length).toBe(first.length);
    const days = new Set(second.map((e) => e.date));
    expect(days.size).toBe(6);
  });
});
