interface Macro {
  label: string;
  eaten: number;
  target: number;
  unit: string;
  color: string;
}

function Ring({ label, eaten, target, unit, color }: Macro) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, eaten / target) : 0;
  const over = target > 0 && eaten > target * 1.05;
  return (
    <figure className="ring" aria-label={`${label}: ${Math.round(eaten)} of ${Math.round(target)} ${unit}`}>
      <svg viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="ring-value"
          style={{ stroke: over ? "var(--warn)" : color, strokeDasharray: circ, strokeDashoffset: circ * (1 - pct) }}
        />
        <text x="50" y="47" textAnchor="middle" className="ring-number">
          {Math.round(eaten)}
        </text>
        <text x="50" y="64" textAnchor="middle" className="ring-sub">
          / {Math.round(target)}
          {unit === "g" ? "g" : ""}
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export interface TodaySummary {
  eaten: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  target: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}

export function Rings({ today }: { today: TodaySummary | undefined }) {
  const e = today?.eaten ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const t = today?.target ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  return (
    <div className="rings">
      <Ring label="Calories" eaten={e.calories} target={t.calories} unit="kcal" color="var(--cal)" />
      <Ring label="Protein" eaten={e.protein} target={t.protein} unit="g" color="var(--protein)" />
      <Ring label="Carbs" eaten={e.carbs} target={t.carbs} unit="g" color="var(--carbs)" />
      <Ring label="Fat" eaten={e.fat} target={t.fat} unit="g" color="var(--fat)" />
    </div>
  );
}
