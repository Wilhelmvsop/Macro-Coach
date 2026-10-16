import type { ToolTrace } from "../agent";

function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

/** Live view of every MCP tool call the assistant makes. */
export function TrafficPanel({ traces, protocol }: { traces: ToolTrace[]; protocol: string | undefined }) {
  return (
    <section className="panel traffic" aria-labelledby="traffic-title">
      <header className="panel-head">
        <h2 id="traffic-title">MCP traffic</h2>
        <span className="pill">Streamable HTTP{protocol ? ` · ${protocol}` : ""}</span>
      </header>
      {traces.length === 0 && <p className="muted">Tool calls to the Macro Coach MCP server appear here as they happen.</p>}
      <ol className="trace-list" aria-live="polite">
        {traces.map((t) => (
          <li key={t.id} className={`trace ${t.status}`}>
            <details open={t.status !== "ok" || traces[0]?.id === t.id}>
              <summary>
                <span className="trace-name">{t.name}</span>
                <span className="trace-meta">{t.status === "running" ? "calling…" : `${t.status === "ok" ? "ok" : "error"} · ${t.ms} ms`}</span>
              </summary>
              <h3>Arguments</h3>
              <Json value={t.args} />
              {t.text !== undefined && (
                <>
                  <h3>Text result</h3>
                  <p className="trace-text">{t.text}</p>
                </>
              )}
              {t.result !== undefined && (
                <>
                  <h3>Structured content</h3>
                  <Json value={t.result} />
                </>
              )}
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
