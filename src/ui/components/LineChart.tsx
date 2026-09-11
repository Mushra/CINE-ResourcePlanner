export interface LineChartSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

/**
 * Small hand-rolled SVG line/area chart — no charting library in this app, and this is the only
 * shape needed: one or more series sharing a set of x-axis labels. Mono-series + showArea gives the
 * Dashboard's occupancy burndown; multi-series (no area) gives the per-discipline timeline.
 */
export function LineChart({
  series,
  labels,
  yMax,
  unit = 'FTE',
  showArea = false,
  height = 220,
  highlightedIds,
}: {
  series: LineChartSeries[];
  labels: string[];
  yMax?: number;
  unit?: '%' | 'FTE';
  showArea?: boolean;
  height?: number;
  /** When non-empty, series not in this set render dimmed — same highlight/dim behavior as the legend dots elsewhere. */
  highlightedIds?: Set<string>;
}) {
  const width = 600;
  const pad = 30;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;

  const max = yMax ?? Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;

  function pointsFor(values: number[]): [number, number][] {
    return values.map((v, i) => {
      const x = pad + innerW * (n <= 1 ? 0 : i / (n - 1));
      const y = pad + innerH - innerH * Math.min(1, v / max);
      return [x, y];
    });
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const step = Math.max(1, Math.ceil(n / 7));

  if (n === 0) {
    return <div className="line-chart-empty">No data</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="line-chart-svg">
      {ticks.map((t) => {
        const y = pad + innerH - innerH * t;
        const value = unit === '%' ? `${Math.round(max * t)}%` : `${Math.round(max * t)}`;
        return (
          <g key={t}>
            <line className="line-chart-axis" x1={pad} x2={width - pad} y1={y} y2={y} />
            <text x={2} y={y + 4} className="line-chart-tick">{value}</text>
          </g>
        );
      })}
      {series.map((s) => {
        const pts = pointsFor(s.values);
        const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
        const area = `${path} L${pts.at(-1)![0]},${pad + innerH} L${pts[0][0]},${pad + innerH} Z`;
        const dimmed = !!highlightedIds && highlightedIds.size > 0 && !highlightedIds.has(s.id);
        return (
          <g key={s.id} style={{ opacity: dimmed ? 0.18 : 1, transition: 'opacity 0.15s' }}>
            {showArea && <path d={area} className="line-chart-area" style={{ fill: s.color }} />}
            <path d={path} className="line-chart-line" style={{ stroke: s.color }} />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="line-chart-pt" style={{ fill: s.color }} />
            ))}
          </g>
        );
      })}
      {labels.map((label, i) => (
        i % step === 0 ? (
          <text key={label} x={pad + innerW * (n <= 1 ? 0 : i / (n - 1))} y={height - 4} className="line-chart-x-label" textAnchor="middle">
            {label}
          </text>
        ) : null
      ))}
    </svg>
  );
}
