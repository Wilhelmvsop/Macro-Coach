import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import type { Goals, LogEntry, Profile, User } from "../domain/types.js";
import type { Store } from "../ports.js";

/**
 * Single-table layout:
 *   PK=USER#<id>   SK=PROFILE          user record + body profile
 *   PK=USER#<id>   SK=GOALS            daily targets
 *   PK=USER#<id>   SK=ENTRY#<date>#<eatenAt>#<entryId>   log entries
 *   PK=TOKEN#<sha256(token)>  SK=TOKEN  token -> user id (only the hash is stored)
 *   GSI1: GSI1PK=USER#<id> GSI1SK=ENTRYID#<entryId> for lookup by id
 */
const userPk = (id: string) => `USER#${id}`;
const entrySk = (e: LogEntry) => `ENTRY#${e.date}#${e.eatenAt}#${e.id}`;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(private readonly table: string, client = new DynamoDBClient({})) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async getUserByToken(token: string): Promise<User | undefined> {
    const t = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `TOKEN#${hashToken(token)}`, SK: "TOKEN" } }));
    if (!t.Item) return undefined;
    const u = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: userPk(t.Item.userId as string), SK: "USER" } }));
    return u.Item?.user as User | undefined;
  }

  async getUser(userId: string): Promise<User | undefined> {
    const u = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: userPk(userId), SK: "USER" } }));
    return u.Item?.user as User | undefined;
  }

  async putUser(user: User, token: string): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: userPk(user.id), SK: "USER", user } }));
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: `TOKEN#${hashToken(token)}`, SK: "TOKEN", userId: user.id } }));
  }

  async getGoals(userId: string): Promise<Goals | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: userPk(userId), SK: "GOALS" } }));
    return r.Item?.goals as Goals | undefined;
  }

  async putGoals(userId: string, goals: Goals): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: userPk(userId), SK: "GOALS", goals } }));
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: userPk(userId), SK: "PROFILE" } }));
    return r.Item?.profile as Profile | undefined;
  }

  async putProfile(userId: string, profile: Profile): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: userPk(userId), SK: "PROFILE", profile } }));
  }

  private entryItem(e: LogEntry) {
    return { PK: userPk(e.userId), SK: entrySk(e), GSI1PK: userPk(e.userId), GSI1SK: `ENTRYID#${e.id}`, entry: e };
  }

  async addEntries(entries: LogEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += 25) {
      const chunk = entries.slice(i, i + 25);
      await this.doc.send(
        new BatchWriteCommand({ RequestItems: { [this.table]: chunk.map((e) => ({ PutRequest: { Item: this.entryItem(e) } })) } }),
      );
    }
  }

  async listEntries(userId: string, fromDate: string, toDate: string): Promise<LogEntry[]> {
    const out: LogEntry[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: { ":pk": userPk(userId), ":from": `ENTRY#${fromDate}`, ":to": `ENTRY#${toDate}#￿` },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(r.Items ?? []).map((i) => i.entry as LogEntry));
      start = r.LastEvaluatedKey;
    } while (start);
    return out.sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
  }

  async recentEntries(userId: string, limit: number): Promise<LogEntry[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":p": "ENTRY#" },
        ScanIndexForward: false,
        Limit: Math.max(limit, 20),
      }),
    );
    return (r.Items ?? [])
      .map((i) => i.entry as LogEntry)
      .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
      .slice(0, limit);
  }

  async getEntry(userId: string, entryId: string): Promise<LogEntry | undefined> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk AND GSI1SK = :sk",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":sk": `ENTRYID#${entryId}` },
      }),
    );
    return r.Items?.[0]?.entry as LogEntry | undefined;
  }

  async replaceEntry(entry: LogEntry): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: this.entryItem(entry) }));
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const e = await this.getEntry(userId, entryId);
    if (!e) return;
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: userPk(userId), SK: entrySk(e) } }));
  }
}
