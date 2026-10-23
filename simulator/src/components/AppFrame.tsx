import { useEffect, useRef, useState } from "react";

const HOST_PROTOCOL_VERSION = "2026-01-26";

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Minimal MCP Apps host: renders a server-provided ui:// view in a sandboxed
 * iframe, answers ui/initialize and delivers the tool result to the view.
 */
export function AppFrame({ html, result, title }: { html: string; result: unknown; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(180);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as RpcMessage;
      if (!m || m.jsonrpc !== "2.0") return;
      const reply = (msg: object) => frame.current?.contentWindow?.postMessage(msg, "*");
      if (m.method === "ui/initialize" && m.id !== undefined) {
        reply({
          jsonrpc: "2.0",
          id: m.id,
          result: {
            protocolVersion: HOST_PROTOCOL_VERSION,
            hostInfo: { name: "macro-coach-simulator", version: "0.1.0" },
            hostCapabilities: {},
            hostContext: { theme: "dark", displayMode: "inline" },
          },
        });
      } else if (m.method === "ui/notifications/initialized") {
        reply({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
      } else if (m.method === "ui/notifications/size-changed") {
        const h = Number(m.params?.height);
        if (h > 0) setHeight(Math.min(520, Math.ceil(h) + 4));
      } else if (m.id !== undefined) {
        reply({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Not supported by this host" } });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [result]);

  return <iframe ref={frame} className="app-frame" title={title} sandbox="allow-scripts" srcDoc={html} style={{ height }} />;
}
