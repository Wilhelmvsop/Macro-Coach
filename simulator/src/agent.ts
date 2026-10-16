import type { McpConnection } from "./mcp";
import { routeUtterance } from "./router";

/** Bedrock Converse content blocks, as JSON. */
type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: ({ json: unknown } | { text: string })[]; status?: "success" | "error" } };

interface ConverseMessage {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolTrace {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  text?: string;
  result?: unknown;
  ms?: number;
}

export interface AgentEvents {
  onToolStart(t: ToolTrace): void;
  onToolEnd(t: ToolTrace): void;
}

export type AgentMode = "bedrock" | "local";

const MAX_STEPS = 6;

/**
 * The simulator's agent loop. The browser is the MCP client: each tool call goes
 * straight to the Macro Coach MCP server over Streamable HTTP. Only the LLM turn
 * is proxied through the server, which calls Amazon Bedrock.
 */
export class Agent {
  private history: ConverseMessage[] = [];
  mode: AgentMode = "bedrock";

  constructor(private readonly mcp: McpConnection, private readonly apiBase: string, private readonly token: string) {}

  reset(): void {
    this.history = [];
  }

  private async callTool(name: string, args: Record<string, unknown>, events: AgentEvents): Promise<ToolTrace> {
    const trace: ToolTrace = { id: crypto.randomUUID(), name, args, status: "running" };
    events.onToolStart(trace);
    const started = performance.now();
    try {
      const out = await this.mcp.callTool(name, args);
      const done: ToolTrace = { ...trace, status: out.isError ? "error" : "ok", text: out.text, result: out.structured, ms: Math.round(performance.now() - started) };
      events.onToolEnd(done);
      return done;
    } catch (err) {
      const done: ToolTrace = { ...trace, status: "error", text: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - started) };
      events.onToolEnd(done);
      return done;
    }
  }

  private async converse(messages: ConverseMessage[]): Promise<{ message: ConverseMessage; stopReason: string }> {
    const res = await fetch(`${this.apiBase}/agent/converse`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ messages, tools: this.mcp.tools }),
    });
    if (!res.ok) throw new Error(`assistant unavailable (${res.status})`);
    return (await res.json()) as { message: ConverseMessage; stopReason: string };
  }

  /** Handles one user utterance and returns the spoken reply. */
  async ask(text: string, events: AgentEvents): Promise<string> {
    if (this.mode === "local") return this.askLocal(text, events);
    const messages: ConverseMessage[] = [...this.history, { role: "user", content: [{ text }] }];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const { message, stopReason } = await this.converse(messages);
        messages.push(message);
        const uses = message.content.flatMap((b) => ("toolUse" in b ? [b.toolUse] : []));
        if (stopReason !== "tool_use" || uses.length === 0) {
          this.history = messages.slice(-20);
          const reply = message.content.flatMap((b) => ("text" in b ? [b.text] : [])).join(" ").trim();
          return reply || "Okay.";
        }
        const results: Block[] = [];
        for (const u of uses) {
          const t = await this.callTool(u.name, u.input ?? {}, events);
          results.push({
            toolResult: {
              toolUseId: u.toolUseId,
              content: [{ text: t.text ?? "" }, ...(t.result ? [{ json: t.result }] : [])],
              status: t.status === "error" ? "error" : "success",
            },
          });
        }
        messages.push({ role: "user", content: results });
      }
      return "Sorry, that took too many steps. Please try again.";
    } catch {
      // Bedrock is not reachable (for example a new AWS account under verification); keep the demo going.
      this.mode = "local";
      return this.askLocal(text, events);
    }
  }

  private async askLocal(text: string, events: AgentEvents): Promise<string> {
    const call = routeUtterance(text);
    const t = await this.callTool(call.name, call.args, events);
    return t.text || "Done.";
  }
}
