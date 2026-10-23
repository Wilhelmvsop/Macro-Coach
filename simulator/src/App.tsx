import { useCallback, useEffect, useRef, useState } from "react";
import { Agent, type ToolTrace } from "./agent";
import { AppFrame } from "./components/AppFrame";
import { Rings, type TodaySummary } from "./components/Rings";
import { TrafficPanel } from "./components/TrafficPanel";
import { TrendChart, type WeekDay } from "./components/TrendChart";
import { McpConnection } from "./mcp";
import { listen, speak, speechInputSupported, type Listener } from "./speech";

interface Config {
  mcpUrl: string;
  apiBase: string;
  token: string;
}

interface Turn {
  id: string;
  who: "user" | "assistant";
  text: string;
  /** MCP Apps card returned with this reply. */
  card?: { html: string; result: unknown; tool: string };
}

const STEPS = ["You speak", "Bedrock agent picks a tool", "MCP over Streamable HTTP", "USDA FoodData Central", "DynamoDB"];

const SAMPLES = [
  "I had two scrambled eggs and a banana for breakfast.",
  "How much protein do I still need today?",
  "What should I eat for dinner? I have chicken, rice and broccoli.",
  "Actually make that one egg, not two.",
  "How did I do this week?",
  "I'm trying to cut. Set my goal to 2,000 calories and 150 grams of protein.",
];

/** Deployed builds get config.json from the stack; local dev talks to the local server. Query params override both. */
async function loadConfig(): Promise<Config> {
  let base: Partial<Config> = {};
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (res.ok) base = (await res.json()) as Partial<Config>;
  } catch {
    // No config.json in local dev.
  }
  const q = new URLSearchParams(location.search);
  const mcpUrl = q.get("mcp") ?? base.mcpUrl ?? "http://127.0.0.1:3000/mcp";
  return {
    mcpUrl,
    apiBase: q.get("api") ?? base.apiBase ?? mcpUrl.replace(/\/mcp$/, ""),
    token: q.get("token") ?? base.token ?? "demo-judge-token",
  };
}

export function App() {
  const [config, setConfig] = useState<Config>();
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [error, setError] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [traces, setTraces] = useState<ToolTrace[]>([]);
  const [today, setToday] = useState<TodaySummary>();
  const [week, setWeek] = useState<WeekDay[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [mode, setMode] = useState<"bedrock" | "local">("bedrock");
  const [model, setModel] = useState<string>();
  const mcp = useRef<McpConnection>();
  const agent = useRef<Agent>();
  const listener = useRef<Listener>();
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const refreshDashboard = useCallback(async () => {
    const c = mcp.current;
    if (!c) return;
    try {
      const [t, w] = await Promise.all([c.readToday(), c.callTool("get_weekly_report", {})]);
      if (t) setToday(t as unknown as TodaySummary);
      const days = (w.structured?.days as WeekDay[] | undefined) ?? [];
      setWeek(days);
    } catch {
      // The dashboard is a convenience; the conversation still works without it.
    }
  }, []);

  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (!config) return;
    const c = new McpConnection(config.mcpUrl, config.token);
    let cancelled = false;
    setStatus("connecting");
    c.connect()
      .then(() => {
        if (cancelled) return;
        mcp.current = c;
        agent.current = new Agent(c, config.apiBase, config.token);
        setStatus("ready");
        void refreshDashboard();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      void c.close();
    };
  }, [config, refreshDashboard]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const submit = useCallback(
    async (text: string) => {
      const a = agent.current;
      const clean = text.trim();
      if (!a || !clean || busy) return;
      setBusy(true);
      setDraft("");
      setTurns((t) => [...t, { id: crypto.randomUUID(), who: "user", text: clean }]);
      const done: ToolTrace[] = [];
      const reply = await a.ask(clean, {
        onToolStart: (tr) => setTraces((list) => [tr, ...list]),
        onToolEnd: (tr) => {
          done.push(tr);
          setTraces((list) => list.map((x) => (x.id === tr.id ? tr : x)));
        },
      });
      setMode(a.mode);
      setModel(a.model);
      // Show the MCP Apps card for the last tool that has one.
      const withUi = [...done].reverse().find((t) => t.ui && t.status === "ok");
      const html = withUi?.ui ? await mcp.current?.readUi(withUi.ui).catch(() => undefined) : undefined;
      const card = withUi && html ? { html, result: withUi.raw, tool: withUi.name } : undefined;
      setTurns((t) => [...t, { id: crypto.randomUUID(), who: "assistant", text: reply, ...(card ? { card } : {}) }]);
      speak(reply, voiceOut);
      setBusy(false);
      void refreshDashboard();
    },
    [busy, voiceOut, refreshDashboard],
  );

  const toggleMic = () => {
    if (listening) {
      listener.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    let finalText = "";
    const l = listen(
      (text, final) => {
        setDraft(text);
        if (final) finalText = text;
      },
      () => {
        setListening(false);
        listener.current = undefined;
        if (finalText) void submit(finalText);
      },
    );
    if (l) {
      listener.current = l;
      setListening(true);
    }
  };

  const target = today?.target.calories ?? 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Macro Coach</h1>
            <p className="tagline">Your voice-first nutrition coach. Say what you ate; get real numbers back.</p>
          </div>
        </div>
        <div className="status" role="status">
          <span className={`dot ${status}`} aria-hidden="true" />
          {status === "ready" ? "Connected" : status === "connecting" ? "Connecting…" : "Not connected"}
          {status === "ready" && (
            <span className="pill" title={mode === "bedrock" ? "Each turn is planned by a model on Amazon Bedrock" : "Bedrock is unavailable, so a local intent router picks the tool"}>
              {mode === "bedrock" ? `Amazon Bedrock${model ? ` · ${model.replace(/^us./, "")}` : ""}` : "Local intent router"}
            </span>
          )}
        </div>
      </header>

      <ol className="pipeline" aria-label="How a request flows">
        {STEPS.map((step, i) => (
          <li key={step}>
            <span className="step-num">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>

      {status === "error" && (
        <div className="alert" role="alert">
          Could not reach the MCP server at <code>{config?.mcpUrl}</code>: {error}
        </div>
      )}

      <main className="grid">
        <section className="panel conversation" aria-labelledby="conv-title">
          <header className="panel-head">
            <h2 id="conv-title">Talk to your coach</h2>
            <label className="toggle">
              <input type="checkbox" checked={voiceOut} onChange={(e) => setVoiceOut(e.target.checked)} /> Spoken replies
            </label>
          </header>

          <div className="transcript" aria-live="polite">
            {turns.length === 0 && (
              <div className="samples">
                <p className="muted">Press the microphone and speak, type below, or try one of these:</p>
                <ul>
                  {SAMPLES.map((s) => (
                    <li key={s}>
                      <button type="button" className="chip" disabled={status !== "ready" || busy} onClick={() => void submit(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={`turn ${t.who}`}>
                <p className={`bubble ${t.who}`}>
                  <span className="sr-only">{t.who === "user" ? "You said:" : "Coach:"}</span>
                  {t.text}
                </p>
                {t.card && (
                  <figure className="card-wrap">
                    <AppFrame html={t.card.html} result={t.card.result} title={`${t.card.tool} card`} />
                    <figcaption>MCP App rendered from ui://macro-coach/card.html</figcaption>
                  </figure>
                )}
              </div>
            ))}
            {busy && <p className="bubble assistant thinking">Thinking…</p>}
            <div ref={transcriptEnd} />
          </div>

          {turns.length > 0 && (
            <div className="quick" aria-label="Suggestions">
              {SAMPLES.map((s) => (
                <button key={s} type="button" className="quick-chip" disabled={status !== "ready" || busy} onClick={() => void submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(draft);
            }}
          >
            <button
              type="button"
              className={`mic ${listening ? "on" : ""}`}
              onClick={toggleMic}
              disabled={!speechInputSupported() || status !== "ready" || busy}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Start speaking"}
              title={speechInputSupported() ? "Push to talk" : "Speech input is not supported in this browser; type instead"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
              </svg>
            </button>
            <label htmlFor="utterance" className="sr-only">
              What did you eat, or what do you want to know?
            </label>
            <input
              id="utterance"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? "Listening…" : "Type what you ate or ask a question"}
              autoComplete="off"
              disabled={status !== "ready"}
            />
            <button type="submit" className="send" disabled={!draft.trim() || busy || status !== "ready"}>
              Send
            </button>
          </form>
        </section>

        <section className="panel dashboard" aria-labelledby="dash-title">
          <header className="panel-head">
            <h2 id="dash-title">Today</h2>
            <span className="muted small">{today ? `${Math.max(0, Math.round(target - today.eaten.calories))} kcal left` : ""}</span>
          </header>
          <Rings today={today} />
          <h2 className="sub">Last 7 days</h2>
          <TrendChart days={week} target={target} />
          <p className="legend">
            <span className="key on" /> on target <span className="key off" /> off target <span className="key line" /> daily target
          </p>
        </section>

        <TrafficPanel traces={traces} protocol={mcp.current?.protocolVersion} />
      </main>

      <footer className="foot">
        Built for the Alexa+ track of the Build, Ship, Shape hackathon. Nutrition data: USDA FoodData Central. MCP server:{" "}
        <code>{config?.mcpUrl}</code> · <a href="https://github.com/Wilhelmvsop/Macro-Coach">Source on GitHub</a>
      </footer>
    </div>
  );
}
