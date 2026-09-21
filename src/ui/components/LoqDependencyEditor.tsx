import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Button } from './Button';
import { ConfirmButton } from './ConfirmButton';
import type { Loq } from '../../domain/types';

/**
 * V1 dependency scope (this session's default, not spec'd): edges between two LOQs of the same
 * cinematic only, type fixed to finish_to_start, source='override'. Cross-cinematic edges and
 * dependency templates are deferred (PLANNING_ENGINE.md §6.1).
 */
export function LoqDependencyEditor({ loqs, disciplines }: { loqs: Loq[]; disciplines: { id: string; name: string }[] }) {
  const allDependencies = useStore((s) => s.data.loqDependencies);
  const createLoqDependency = useStore((s) => s.createLoqDependency);
  const updateLoqDependency = useStore((s) => s.updateLoqDependency);
  const deleteLoqDependency = useStore((s) => s.deleteLoqDependency);

  const loqIds = new Set(loqs.map((l) => l.id));
  const dependencies = allDependencies.filter((d) => loqIds.has(d.predecessorLoqId) && loqIds.has(d.successorLoqId));

  const [predecessorId, setPredecessorId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [lagDays, setLagDays] = useState(0);

  function labelFor(loqId: string): string {
    const l = loqs.find((x) => x.id === loqId);
    if (!l) return 'Unknown LOQ';
    const discipline = disciplines.find((d) => d.id === l.disciplineId);
    return `${discipline?.name ?? 'Unassigned'} · ${l.type}`;
  }

  function add(): void {
    const created = createLoqDependency({
      predecessorLoqId: predecessorId,
      successorLoqId: successorId,
      type: 'finish_to_start',
      lagDays,
      source: 'override',
      templateId: null,
    });
    if (created) {
      setPredecessorId('');
      setSuccessorId('');
      setLagDays(0);
    }
  }

  return (
    <div className="card dependencies-card">
      <div className="panel-header">
        <h2>Dependencies</h2>
        <span className="panel-sub">Finish-to-start edges between this cinematic's LOQs</span>
      </div>

      {dependencies.length === 0 ? (
        <p className="empty-inline">No dependencies yet.</p>
      ) : (
        <ul className="dependency-list">
          {dependencies.map((d) => (
            <li key={d.id} className="dependency-row">
              <span className="dependency-edge">{labelFor(d.predecessorLoqId)} → {labelFor(d.successorLoqId)}</span>
              <label className="dependency-lag">
                Lag
                <input
                  type="number"
                  className="num-input"
                  defaultValue={d.lagDays}
                  onBlur={(e) => updateLoqDependency({ ...d, lagDays: Number(e.target.value) || 0 })}
                  aria-label={`Lag for ${labelFor(d.predecessorLoqId)} → ${labelFor(d.successorLoqId)}`}
                />
                days
              </label>
              <ConfirmButton label="Delete" onConfirm={() => deleteLoqDependency(d.id)} />
            </li>
          ))}
        </ul>
      )}

      <div className="dependency-add field-row">
        <div className="field">
          <label htmlFor="dependency-predecessor">Predecessor</label>
          <select id="dependency-predecessor" value={predecessorId} onChange={(e) => setPredecessorId(e.target.value)}>
            <option value="">Select LOQ…</option>
            {loqs.map((l) => <option key={l.id} value={l.id}>{labelFor(l.id)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dependency-successor">Successor</label>
          <select id="dependency-successor" value={successorId} onChange={(e) => setSuccessorId(e.target.value)}>
            <option value="">Select LOQ…</option>
            {loqs.map((l) => <option key={l.id} value={l.id}>{labelFor(l.id)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dependency-lag">Lag (days)</label>
          <input
            id="dependency-lag"
            type="number"
            className="num-input"
            value={lagDays}
            onChange={(e) => setLagDays(Number(e.target.value) || 0)}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="link"
          disabled={!predecessorId || !successorId || predecessorId === successorId}
          onClick={add}
        >
          Add dependency
        </Button>
      </div>
    </div>
  );
}
