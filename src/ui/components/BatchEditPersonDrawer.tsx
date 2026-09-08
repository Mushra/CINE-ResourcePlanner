import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Person, ResourcePool } from '../../domain/types';

export type BatchPersonPatch = Partial<Pick<Person, 'team' | 'poolId' | 'active'>>;

/** Applies one patch to many selected people at once — each field is only touched if its checkbox is on. */
export function BatchEditPersonDrawer({
  count, pools, teamOptions, onClose, onSave,
}: {
  count: number;
  pools: ResourcePool[];
  teamOptions: string[];
  onClose: () => void;
  onSave: (patch: BatchPersonPatch) => void;
}) {
  const [applyTeam, setApplyTeam] = useState(false);
  const [team, setTeam] = useState('');
  const [applyPool, setApplyPool] = useState(false);
  const [poolId, setPoolId] = useState('');
  const [applyActive, setApplyActive] = useState(false);
  const [active, setActive] = useState(true);

  const canSave = applyTeam || applyPool || applyActive;

  function handleSave(): void {
    const patch: BatchPersonPatch = {};
    if (applyTeam) patch.team = team;
    if (applyPool) patch.poolId = poolId || null;
    if (applyActive) patch.active = active;
    onSave(patch);
  }

  return (
    <Drawer title={`Batch edit — ${count} selected`} onClose={onClose}>
      <p className="view-sub" style={{ marginTop: -4 }}>Tick a field below to apply it to all {count} selected people.</p>

      <div className="batch-field">
        <label className="batch-field-toggle">
          <input type="checkbox" checked={applyTeam} onChange={(e) => setApplyTeam(e.target.checked)} />
          Team
        </label>
        <input
          list="team-options"
          value={team}
          disabled={!applyTeam}
          onChange={(e) => setTeam(e.target.value)}
          placeholder="Team name"
        />
        <datalist id="team-options">
          {teamOptions.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>

      <div className="batch-field">
        <label className="batch-field-toggle">
          <input type="checkbox" checked={applyPool} onChange={(e) => setApplyPool(e.target.checked)} />
          Role
        </label>
        <select value={poolId} disabled={!applyPool} onChange={(e) => setPoolId(e.target.value)}>
          <option value="">Unassigned</option>
          {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="batch-field">
        <label className="batch-field-toggle">
          <input type="checkbox" checked={applyActive} onChange={(e) => setApplyActive(e.target.checked)} />
          Status
        </label>
        <select value={active ? 'active' : 'inactive'} disabled={!applyActive} onChange={(e) => setActive(e.target.value === 'active')}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={handleSave}>Apply to {count}</Button>
      </div>
    </Drawer>
  );
}
