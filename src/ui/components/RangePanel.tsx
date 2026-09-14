import { useRef } from 'react';
import { formatPeriodLabel } from '../../domain/periods';
import type { Period } from '../../domain/types';
import { Button } from './Button';

/** Bulk-entry panel: pick a target (pool or person), a month range and an FTE, apply to every month at once. */
export function RangePanel({ options, months, onApply, fteLabel = 'FTE' }: {
  options: { id: string; label: string }[];
  months: Period[];
  onApply: (targetId: string, periods: Period[], fte: number) => void;
  fteLabel?: string;
}) {
  const targetRef = useRef<HTMLSelectElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const fteRef = useRef<HTMLInputElement>(null);

  if (options.length === 0) return null;

  return (
    <div className="range-panel">
      <select ref={targetRef} className="range-panel-select" defaultValue={options[0].id}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="range-panel-label">from</span>
      <select ref={fromRef} defaultValue="0">
        {months.map((m, i) => <option key={m} value={i}>{formatPeriodLabel(m, { withYear: false })}</option>)}
      </select>
      <span className="range-panel-label">to</span>
      <select ref={toRef} defaultValue={String(months.length - 1)}>
        {months.map((m, i) => <option key={m} value={i}>{formatPeriodLabel(m, { withYear: false })}</option>)}
      </select>
      <input ref={fteRef} type="number" step={0.5} min={0} defaultValue={1} className="num-input range-panel-fte" title={fteLabel} />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const targetId = targetRef.current!.value;
          const fromIdx = Number(fromRef.current!.value);
          const toIdx = Number(toRef.current!.value);
          const fte = parseFloat(fteRef.current!.value ?? '') || 0;
          if (!targetId || fromIdx > toIdx) return;
          onApply(targetId, months.slice(fromIdx, toIdx + 1), fte);
        }}
      >
        Apply
      </Button>
    </div>
  );
}
