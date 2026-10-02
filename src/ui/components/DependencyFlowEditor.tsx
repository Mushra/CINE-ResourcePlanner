import { useStore } from '../../store/useStore';
import { Button } from './Button';
import { ConfirmButton } from './ConfirmButton';
import type { DependencyTemplate } from '../../domain/types';

// Editor for the global dependency "flow" — the classic chains modelled once and materialized per
// cinematic (e.g. Mocap Prep → Tech Anim → Anim). Each row is one DependencyTemplate: a predecessor
// (discipline + LOQ level) that must finish before a successor (discipline + level) can start. Rows
// are created/deleted immediately; field edits commit on blur. None of this touches concrete edges
// until "Apply" runs (or a cinematic is reopened), per the flow-editor decision.
export function DependencyFlowEditor() {
  const templates = useStore((s) => s.data.dependencyTemplates);
  const disciplines = useStore((s) => s.data.disciplines);
  const createDependencyTemplate = useStore((s) => s.createDependencyTemplate);
  const updateDependencyTemplate = useStore((s) => s.updateDependencyTemplate);
  const deleteDependencyTemplate = useStore((s) => s.deleteDependencyTemplate);
  const applyDependencyFlowAll = useStore((s) => s.applyDependencyFlowAll);

  if (disciplines.length === 0) {
    return <p className="field-hint">Create disciplines first — the flow chains LOQs by discipline and level.</p>;
  }

  const sortedDisciplines = [...disciplines].sort((a, b) => a.name.localeCompare(b.name));
  const commit = (tpl: DependencyTemplate, patch: Partial<DependencyTemplate>) => updateDependencyTemplate({ ...tpl, ...patch });

  const addRow = () =>
    createDependencyTemplate({
      predecessorDisciplineId: sortedDisciplines[0].id,
      predecessorLoqType: '',
      successorDisciplineId: sortedDisciplines[0].id,
      successorLoqType: '',
      type: 'finish_to_start',
      lagDays: 0,
    });

  return (
    <>
      {templates.length === 0 && (
        <p className="field-hint">No dependency defined yet. Add one to model a classic chain — e.g. <code>CIN Design L0 → Anim L0</code>.</p>
      )}
      {templates.map((tpl) => (
        <div className="flow-row" key={tpl.id}>
          <div className="field">
            <label htmlFor={`flow-pred-disc-${tpl.id}`}>Prérequis</label>
            <select
              id={`flow-pred-disc-${tpl.id}`}
              aria-label="Predecessor discipline"
              value={tpl.predecessorDisciplineId}
              onChange={(e) => commit(tpl, { predecessorDisciplineId: e.target.value })}
            >
              {sortedDisciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field flow-type">
            <label htmlFor={`flow-pred-type-${tpl.id}`}>Niveau</label>
            <input
              id={`flow-pred-type-${tpl.id}`}
              aria-label="Predecessor LOQ type"
              defaultValue={tpl.predecessorLoqType}
              placeholder="L0"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== tpl.predecessorLoqType) commit(tpl, { predecessorLoqType: v }); }}
            />
          </div>
          <span className="flow-arrow" aria-hidden="true">→</span>
          <div className="field">
            <label htmlFor={`flow-succ-disc-${tpl.id}`}>Dépendante</label>
            <select
              id={`flow-succ-disc-${tpl.id}`}
              aria-label="Successor discipline"
              value={tpl.successorDisciplineId}
              onChange={(e) => commit(tpl, { successorDisciplineId: e.target.value })}
            >
              {sortedDisciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field flow-type">
            <label htmlFor={`flow-succ-type-${tpl.id}`}>Niveau</label>
            <input
              id={`flow-succ-type-${tpl.id}`}
              aria-label="Successor LOQ type"
              defaultValue={tpl.successorLoqType}
              placeholder="L0"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== tpl.successorLoqType) commit(tpl, { successorLoqType: v }); }}
            />
          </div>
          <div className="field flow-lag">
            <label htmlFor={`flow-lag-${tpl.id}`}>Lag (j)</label>
            <input
              id={`flow-lag-${tpl.id}`}
              aria-label="Lag days"
              type="number"
              min={0}
              defaultValue={tpl.lagDays}
              onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== tpl.lagDays) commit(tpl, { lagDays: v }); }}
            />
          </div>
          <ConfirmButton label="Delete" onConfirm={() => deleteDependencyTemplate(tpl.id)} />
        </div>
      ))}
      <div className="detail-header-actions" style={{ marginTop: 12 }}>
        <Button variant="secondary" icon="plus" onClick={addRow}>Ajouter une dépendance</Button>
        <Button variant="primary" icon="link" onClick={applyDependencyFlowAll}>Appliquer le flow maintenant</Button>
      </div>
    </>
  );
}
