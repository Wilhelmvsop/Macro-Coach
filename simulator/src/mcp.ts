import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutcome {
  text: string;
  structured: Record<string, unknown> | undefined;
  isError: boolean;
}

/** Thin wrapper around the official MCP SDK client, talking Streamable HTTP to the Macro Coach server. */
export class McpConnection {
  private client: Client | undefined;
  tools: McpTool[] = [];

  constructor(readonly url: string, private readonly token: string) {}

  async connect(): Promise<void> {
    const client = new Client({ name: "macro-coach-simulator", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    await client.connect(transport);
    this.client = client;
    const { tools } = await client.listTools();
    this.tools = tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown> }));
  }

  get protocolVersion(): string | undefined {
    return (this.client as unknown as { _transport?: { protocolVersion?: string } } | undefined)?._transport?.protocolVersion;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    if (!this.client) throw new Error("Not connected");
    const r = (await this.client.callTool({ name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    return {
      text: (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(" "),
      structured: r.structuredContent,
      isError: Boolean(r.isError),
    };
  }

  async readToday(): Promise<Record<string, unknown> | undefined> {
    if (!this.client) return undefined;
    const res = await this.client.readResource({ uri: "macro-coach://today" });
    const first = res.contents[0] as { text?: string } | undefined;
    return first?.text ? (JSON.parse(first.text) as Record<string, unknown>) : undefined;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
