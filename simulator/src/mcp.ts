import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const UI_MIME = "text/html;profile=mcp-app";

export interface ToolOutcome {
  text: string;
  structured: Record<string, unknown> | undefined;
  isError: boolean;
  /** The full CallToolResult, forwarded unchanged to MCP Apps views. */
  raw: unknown;
}

/** Thin wrapper around the official MCP SDK client, talking Streamable HTTP to the Macro Coach server. */
export class McpConnection {
  private client: Client | undefined;
  tools: McpTool[] = [];
  /** MCP Apps: tool name -> ui:// resource that renders its result. */
  private readonly uiByTool = new Map<string, string>();
  private readonly resourceCache = new Map<string, string>();

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
    for (const t of tools) {
      const meta = t._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } | undefined;
      const uri = meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
      if (uri) this.uiByTool.set(t.name, uri);
    }
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
      raw: r,
    };
  }

  uiFor(toolName: string): string | undefined {
    return this.uiByTool.get(toolName);
  }

  /** Reads an MCP Apps view (HTML) once and caches it. */
  async readUi(uri: string): Promise<string | undefined> {
    const cached = this.resourceCache.get(uri);
    if (cached) return cached;
    if (!this.client) return undefined;
    const res = await this.client.readResource({ uri });
    const item = res.contents[0] as { text?: string; mimeType?: string } | undefined;
    if (!item?.text || item.mimeType !== UI_MIME) return undefined;
    this.resourceCache.set(uri, item.text);
    return item.text;
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
