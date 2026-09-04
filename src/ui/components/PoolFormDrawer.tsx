import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { NumberField } from './NumberField';
import type { ResourcePool } from '../../domain/types';

export interface PoolFormValue {
  name: string;
  capacityFte: number;
  color: string;
}

const DEFAULT_COLOR = '#4f7cff';

function fromPool(pool?: ResourcePool): PoolFormValue {
  if (!pool) return { name: '', capacityFte: 1, color: DEFAULT_COLOR };
  return { name: pool.name, capacityFte: pool.capacityFte, color: pool.color };
}

export function PoolFormDrawer({ pool, onClose, onSave }: { pool?: ResourcePool; onClose: () => void; onSave: (value: PoolFormValue) => void }) {
  const [value, setValue] = useState<PoolFormValue>(() => fromPool(pool));
  const canSave = value.name.trim().length > 0;

  function set<K extends keyof PoolFormValue>(key: K, v: PoolFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={pool ? 'Edit pool' : 'New pool'} onClose={onClose}>
      <div className="field">
        <label htmlFor="pool-name">Name</label>
        <input id="pool-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Animation" />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pool-capacity">Base capacity (FTE)</label>
          <NumberField value={value.capacityFte} onCommit={(v) => set('capacityFte', v)} step={0.5} min={0} />
        </div>
        <div className="field">
          <label htmlFor="pool-color">Color</label>
          <input id="pool-color" type="color" value={value.color} onChange={(e) => set('color', e.target.value)} />
        </div>
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {pool ? 'Save changes' : 'Create pool'}
        </Button>
      </div>
    </Drawer>
  );
}
