import type { Goals, LogEntry, Profile, User } from "../domain/types.js";
import type { Store } from "../ports.js";

/** In-memory Store for local development and tests. */
export class MemoryStore implements Store {
  private readonly users = new Map<string, User>();
  private readonly tokens = new Map<string, string>();
  private readonly goals = new Map<string, Goals>();
  private readonly profiles = new Map<string, Profile>();
  private readonly entries = new Map<string, LogEntry>();

  async getUserByToken(token: string): Promise<User | undefined> {
    const id = this.tokens.get(token);
    return id ? this.users.get(id) : undefined;
  }

  async putUser(user: User, token: string): Promise<void> {
    this.users.set(user.id, user);
    this.tokens.set(token, user.id);
  }

  async getGoals(userId: string): Promise<Goals | undefined> {
    return this.goals.get(userId);
  }

  async putGoals(userId: string, goals: Goals): Promise<void> {
    this.goals.set(userId, goals);
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    return this.profiles.get(userId);
  }

  async putProfile(userId: string, profile: Profile): Promise<void> {
    this.profiles.set(userId, profile);
  }

  async addEntries(entries: LogEntry[]): Promise<void> {
    for (const e of entries) this.entries.set(e.id, { ...e });
  }

  async listEntries(userId: string, fromDate: string, toDate: string): Promise<LogEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.userId === userId && e.date >= fromDate && e.date <= toDate)
      .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
  }

  async recentEntries(userId: string, limit: number): Promise<LogEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async getEntry(userId: string, entryId: string): Promise<LogEntry | undefined> {
    const e = this.entries.get(entryId);
    return e && e.userId === userId ? { ...e } : undefined;
  }

  async replaceEntry(entry: LogEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const e = this.entries.get(entryId);
    if (e && e.userId === userId) this.entries.delete(entryId);
  }
}
