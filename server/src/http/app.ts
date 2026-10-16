import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { Express, NextFunction, Request, Response } from "express";
import { errorFields, log } from "../logger.js";
import { SERVER_INFO, createMcpServer } from "../mcp/server.js";
import type { Deps } from "../ports.js";
import type { User } from "../domain/types.js";
import { AgentLlmRequest, type AgentLlm } from "./agentLlm.js";

export interface AppOptions {
  host?: string;
  allowedHosts?: string[];
  agentLlm?: AgentLlm;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

/**
 * HTTP host for the MCP server. Runs the Streamable HTTP transport in stateless
 * mode (a fresh server per request) so it scales horizontally without sticky sessions.
 */
export function createApp(deps: Deps, opts: AppOptions = {}): Express {
  const app = createMcpExpressApp({
    host: opts.host ?? "127.0.0.1",
    ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}),
  });

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_INFO, protocolVersion: LATEST_PROTOCOL_VERSION });
  });

  const auth = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="macro-coach"');
      jsonRpcError(res, 401, "Missing bearer token");
      return;
    }
    try {
      const user = await deps.store.getUserByToken(token);
      if (!user) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="macro-coach", error="invalid_token"');
        jsonRpcError(res, 401, "Invalid bearer token");
        return;
      }
      res.locals.user = user;
      next();
    } catch (err) {
      log.error("auth.error", errorFields(err));
      jsonRpcError(res, 500, "Internal server error");
    }
  };

  app.post("/mcp", auth, async (req: Request, res: Response) => {
    const user = res.locals.user as User;
    const server = createMcpServer({ deps, user });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp.request.error", errorFields(err));
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
    }
  });

  // One LLM turn for the simulator's in-browser agent loop. The browser is the MCP
  // client; this endpoint only proxies Bedrock so no AWS credentials reach the browser.
  app.post("/agent/converse", auth, async (req: Request, res: Response) => {
    if (!opts.agentLlm) {
      res.status(503).json({ error: "The simulator assistant is not configured on this server." });
      return;
    }
    const parsed = AgentLlmRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const started = Date.now();
    try {
      const out = await opts.agentLlm.converse(parsed.data);
      log.info("agent.converse", { userId: (res.locals.user as User).id, ms: Date.now() - started, stopReason: out.stopReason });
      res.json(out);
    } catch (err) {
      log.error("agent.converse.error", errorFields(err));
      res.status(502).json({ error: "The assistant is unavailable right now. Please try again." });
    }
  });

  // Stateless mode: no standalone SSE stream and no sessions to delete.
  const notAllowed = (_req: Request, res: Response) => {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, "Method not allowed");
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  return app;
}
