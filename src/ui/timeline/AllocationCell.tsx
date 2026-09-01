import { useState } from 'react';
import { NumberField } from '../components/NumberField';
import { round2 } from '../../engine/planning';

export function AllocationCell({
  width, required, assigned, capacity, poolColor, overCapacity, onSetRequired, onSetAssigned,
}: {
  width: number;
  required: number;
  assigned: number;
  capacity: number;
  poolColor: string;
  overCapacity: boolean;
  onSetRequired: (v: number) => void;
  onSetAssigned: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const short = required > 0.001 && assigned < required - 0.001;
  const fraction = capacity > 0 ? Math.min(1, assigned / capacity) : assigned > 0 ? 1 : 0;
  const alpha = assigned > 0 ? 0.16 + fraction * 0.55 : 0;

  if (editing) {
    return (
      <div className="alloc-cell-edit" style={{ width }}>
        <label>Req
          <NumberField value={required} onCommit={onSetRequired} className="num-input num-input-xs" autoFocus />
        </label>
        <label>Asn
          <NumberField value={assigned} onCommit={onSetAssigned} className="num-input num-input-xs" />
        </label>
        <button type="button" className="alloc-cell-done" onClick={() => setEditing(false)}>done</button>
      </div>
    );
  }

  if (required <= 0.001 && assigned <= 0.001) {
    return <button type="button" className="tl-cell tl-cell-empty" style={{ width }} onClick={() => setEditing(true)} aria-label="Add allocation" />;
  }

  return (
    <button
      type="button"
      className={`tl-cell ${short ? 'tl-cell-short' : ''} ${overCapacity ? 'tl-cell-over' : ''}`}
      style={{ width, backgroundColor: hexToRgba(poolColor, alpha) }}
      onClick={() => setEditing(true)}
      title={`Required ${required} · Assigned ${assigned}`}
    >
      <span className="tl-cell-value">{formatNum(assigned)}{short ? `/${formatNum(required)}` : ''}</span>
      {overCapacity && <span className="tl-cell-flag" />}
    </button>
  );
}

function formatNum(n: number): string {
  const r = round2(n);
  return r === Math.trunc(r) ? String(r) : r.toFixed(1);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
