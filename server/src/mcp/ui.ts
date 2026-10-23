/**
 * MCP Apps (io.modelcontextprotocol/ui) view for Macro Coach. Hosts that support
 * MCP Apps render this HTML in a sandboxed iframe next to tool results; hosts
 * that don't simply ignore it and use the text result.
 */
export const UI_RESOURCE_URI = "ui://macro-coach/card.html";
export const UI_MIME_TYPE = "text/html;profile=mcp-app";
export const UI_PROTOCOL_VERSION = "2026-01-26";

/** Tool metadata linking a tool to the card. Both the current and legacy keys are set. */
export const UI_TOOL_META = { ui: { resourceUri: UI_RESOURCE_URI }, "ui/resourceUri": UI_RESOURCE_URI };

export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Macro Coach</title>
<style>
  :root { --bg:#0b0f14; --panel:#131a22; --line:#2a3646; --text:#f4f7fb; --muted:#a9b6c6;
    --cal:#22c55e; --protein:#38bdf8; --carbs:#facc15; --fat:#f472b6; --warn:#f59e0b;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color-scheme: dark; }
  body { margin:0; background:transparent; color:var(--text); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:14px 16px; }
  h1 { font-size:15px; margin:0 0 10px; color:var(--muted); font-weight:600; letter-spacing:.02em; }
  .rings { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; text-align:center; }
  .rings svg { width:100%; max-width:92px; }
  .rings figcaption { font-size:12px; color:var(--muted); }
  .num { fill:var(--text); font-size:20px; font-weight:700; } .sub { fill:var(--muted); font-size:11px; }
  .bars { display:flex; align-items:flex-end; gap:6px; height:110px; position:relative; }
  .bar { flex:1; border-radius:5px 5px 2px 2px; background:var(--warn); }
  .bar.on { background:var(--cal); } .bar.empty { background:var(--line); }
  .days { display:flex; gap:6px; font-size:11px; color:var(--muted); margin-top:4px; }
  .days span { flex:1; text-align:center; }
  .target { position:absolute; left:0; right:0; border-top:2px dashed var(--text); opacity:.7; }
  .stats { display:flex; gap:16px; margin-top:10px; font-size:13px; color:var(--muted); flex-wrap:wrap; }
  .stats b { color:var(--text); font-size:16px; display:block; }
  .ideas { display:flex; gap:10px; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:4px; }
  .idea { min-width:220px; scroll-snap-align:start; background:#1a2330; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .idea h2 { font-size:15px; margin:0 0 4px; } .idea p { margin:0 0 8px; font-size:13px; color:var(--muted); }
  .chips { display:flex; gap:6px; flex-wrap:wrap; } .chip { font-size:12px; border-radius:999px; padding:2px 8px; background:#0b0f14; }
  ul { margin:6px 0 0; padding-left:18px; font-size:13px; color:var(--muted); }
  .empty { color:var(--muted); font-size:14px; }
  .src { margin-top:8px; font-size:11px; color:var(--muted); }
</style>
</head>
<body>
<div id="root" class="card"><p class="empty">Waiting for data…</p></div>
<script>
(function () {
  var root = document.getElementById("root");
  var nextId = 1;
  function post(msg) { window.parent.postMessage(msg, "*"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function r(n) { return Math.round(Number(n) || 0); }

  function ring(label, eaten, target, color) {
    var R = 40, C = 2 * Math.PI * R, pct = target > 0 ? Math.min(1, eaten / target) : 0;
    var over = target > 0 && eaten > target * 1.05;
    return '<figure style="margin:0"><svg viewBox="0 0 100 100" role="img" aria-label="' + label + ' ' + r(eaten) + ' of ' + r(target) + '">' +
      '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="#1a2330" stroke-width="10"/>' +
      '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="' + (over ? "var(--warn)" : color) + '" stroke-width="10" stroke-linecap="round" ' +
      'transform="rotate(-90 50 50)" stroke-dasharray="' + C + '" stroke-dashoffset="' + C * (1 - pct) + '"/>' +
      '<text x="50" y="50" text-anchor="middle" class="num">' + r(eaten) + '</text>' +
      '<text x="50" y="66" text-anchor="middle" class="sub">/ ' + r(target) + '</text></svg>' +
      '<figcaption>' + label + '</figcaption></figure>';
  }

  function renderDay(eaten, target, title) {
    return '<h1>' + esc(title) + '</h1><div class="rings">' +
      ring("Calories", eaten.calories, target.calories, "var(--cal)") +
      ring("Protein g", eaten.protein, target.protein, "var(--protein)") +
      ring("Carbs g", eaten.carbs, target.carbs, "var(--carbs)") +
      ring("Fat g", eaten.fat, target.fat, "var(--fat)") + '</div>';
  }

  function renderWeek(d) {
    var max = Math.max(d.target.calories * 1.25, 1);
    d.days.forEach(function (x) { max = Math.max(max, x.calories); });
    var bars = d.days.map(function (x) {
      var h = x.logged ? Math.max(4, (x.calories / max) * 100) : 3;
      return '<div class="bar ' + (x.logged ? (x.onTarget ? "on" : "") : "empty") + '" style="height:' + h + '%" title="' + esc(x.date) + ': ' + r(x.calories) + ' kcal"></div>';
    }).join("");
    var days = d.days.map(function (x) {
      return '<span>' + new Date(x.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) + '</span>';
    }).join("");
    var line = '<div class="target" style="bottom:' + (d.target.calories / max) * 100 + '%"></div>';
    return '<h1>Last 7 days</h1><div class="bars">' + bars + line + '</div><div class="days">' + days + '</div>' +
      '<div class="stats"><div><b>' + r(d.averageIntake.calories) + '</b>avg kcal</div><div><b>' + r(d.averageIntake.protein) + ' g</b>avg protein</div>' +
      '<div><b>' + r(d.adherencePercent) + '%</b>days on target</div></div>' + (d.tip ? '<ul><li>' + esc(d.tip) + '</li></ul>' : "");
  }

  function renderIdeas(d) {
    return '<h1>Meal ideas</h1><div class="ideas">' + d.ideas.map(function (i) {
      return '<article class="idea"><h2>' + esc(i.name) + '</h2><p>' + esc(i.description) + '</p><div class="chips">' +
        '<span class="chip">' + r(i.estimated.calories) + ' kcal</span><span class="chip">' + r(i.estimated.protein) + ' g protein</span>' +
        '<span class="chip">' + r(i.estimated.carbs) + ' g carbs</span><span class="chip">' + r(i.estimated.fat) + ' g fat</span></div>' +
        '<ul>' + i.ingredients.map(function (g) { return '<li>' + r(g.grams) + ' g ' + esc(g.food) + '</li>'; }).join("") + '</ul></article>';
    }).join("") + '</div>';
  }

  function render(result) {
    var d = (result && result.structuredContent) || {};
    var html;
    if (Array.isArray(d.days) && d.target) html = renderWeek(d);
    else if (Array.isArray(d.ideas)) html = renderIdeas(d);
    else if (d.eaten && d.target) html = renderDay(d.eaten, d.target, "Today");
    else if (d.eaten_today && d.remaining_today) {
      var t = {}; ["calories", "protein", "carbs", "fat"].forEach(function (k) { t[k] = d.eaten_today[k] + d.remaining_today[k]; });
      html = renderDay(d.eaten_today, t, "Today after this meal");
    } else {
      var text = (result && result.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join(" ");
      html = '<p class="empty">' + esc(text || "No data") + '</p>';
    }
    root.innerHTML = html + '<p class="src">Nutrition data: USDA FoodData Central</p>';
    post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: document.body.scrollWidth, height: document.body.scrollHeight } });
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id === 1 && m.result) post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    if (m.method === "ui/notifications/tool-result") render(m.params);
    if (m.method === "ui/resource-teardown" && m.id !== undefined) post({ jsonrpc: "2.0", id: m.id, result: {} });
  });

  post({ jsonrpc: "2.0", id: nextId++, method: "ui/initialize", params: {
    appInfo: { name: "macro-coach-card", version: "0.1.0" }, appCapabilities: {}, protocolVersion: "${UI_PROTOCOL_VERSION}" } });
})();
</script>
</body>
</html>`;
