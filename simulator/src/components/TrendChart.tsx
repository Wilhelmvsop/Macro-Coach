export interface WeekDay {
  date: string;
  calories: number;
  protein: number;
  logged: boolean;
  onTarget: boolean;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** Seven-day calorie bars with the daily target as a dashed line. */
export function TrendChart({ days, target }: { days: WeekDay[]; target: number }) {
  const w = 340;
  const h = 150;
  const pad = { top: 12, bottom: 26, left: 6, right: 6 };
  const max = Math.max(target * 1.25, ...days.map((d) => d.calories), 1);
  const bw = (w - pad.left - pad.right) / Math.max(1, days.length);
  const y = (v: number) => pad.top + (h - pad.top - pad.bottom) * (1 - v / max);
  const summary = days.map((d) => `${DAY.format(new Date(`${d.date}T12:00:00Z`))} ${Math.round(d.calories)} calories`).join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="trend" role="img" aria-label={`Calories over the last 7 days. Target ${Math.round(target)}. ${summary}`}>
      {days.map((d, i) => {
        const x = pad.left + i * bw + bw * 0.18;
        const top = y(d.calories);
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={d.logged ? top : y(0) - 2}
              width={bw * 0.64}
              height={d.logged ? y(0) - top : 2}
              rx="4"
              className={d.logged ? (d.onTarget ? "bar on" : "bar off") : "bar empty"}
            />
            <text x={x + bw * 0.32} y={h - 8} textAnchor="middle" className="axis">
              {DAY.format(new Date(`${d.date}T12:00:00Z`))}
            </text>
          </g>
        );
      })}
      {target > 0 && <line x1={pad.left} x2={w - pad.right} y1={y(target)} y2={y(target)} className="target-line" />}
    </svg>
  );
}
