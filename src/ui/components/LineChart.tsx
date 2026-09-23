export interface LineChartSeries {
  id: string;
  label: string;
  color: string;
  /** `null` at an index means "no data for this period" — breaks the line instead of drawing
   * through zero, so e.g. a project with no requirement defined doesn't look like it's at 0%. */
  values: (number | null)[];
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

  const max = yMax ?? Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const n = labels.length;

  function pointsFor(values: (number | null)[]): ([number, number] | null)[] {
    return values.map((v, i) => {
      if (v === null) return null;
      const x = pad + innerW * (n <= 1 ? 0 : i / (n - 1));
      const y = pad + innerH - innerH * Math.min(1, v / max);
      return [x, y];
    });
  }

  /** Contiguous runs of non-null points — each run becomes its own M..L subpath, so a gap breaks
   * the line rather than jumping straight across it. */
  function segmentsOf(pts: ([number, number] | null)[]): [number, number][][] {
    const segments: [number, number][][] = [];
    let current: [number, number][] = [];
    for (const p of pts) {
      if (p === null) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length) segments.push(current);
    return segments;
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
        const segments = segmentsOf(pts);
        const path = segments.map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')).join(' ');
        const area = segments
          .map((seg) => `M${seg[0][0]},${pad + innerH} ${seg.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${seg.at(-1)![0]},${pad + innerH} Z`)
          .join(' ');
        const dimmed = !!highlightedIds && highlightedIds.size > 0 && !highlightedIds.has(s.id);
        return (
          <g key={s.id} style={{ opacity: dimmed ? 0.18 : 1, transition: 'opacity 0.15s' }}>
            {showArea && <path d={area} className="line-chart-area" style={{ fill: s.color }} />}
            <path d={path} className="line-chart-line" style={{ stroke: s.color }} />
            {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="line-chart-pt" style={{ fill: s.color }} /> : null))}
          </g>
        );
      })}
      {labels.map((label, i) => (
        i % step === 0 ? (
          <text key={i} x={pad + innerW * (n <= 1 ? 0 : i / (n - 1))} y={height - 4} className="line-chart-x-label" textAnchor="middle">
            {label}
          </text>
        ) : null
      ))}
    </svg>
  );
}
