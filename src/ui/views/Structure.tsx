import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { normalizeKey } from '../../domain/identity';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { DisciplineFormDrawer, type DisciplineFormValue } from '../components/DisciplineFormDrawer';
import { PoolFormDrawer, type PoolFormValue } from '../components/PoolFormDrawer';
import type { StructureOverride } from '../../domain/types';

const USE_BASELINE = '__baseline__';

export function Structure() {
  const disciplines = useStore((s) => s.data.disciplines);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const overrides = useStore((s) => s.data.structureOverrides);
  const createDiscipline = useStore((s) => s.createDiscipline);
  const createPool = useStore((s) => s.createPool);
  const setPoolDiscipline = useStore((s) => s.setPoolDiscipline);
  const setPersonPool = useStore((s) => s.setPersonPool);
  const setPoolPersonPool = useStore((s) => s.setPoolPersonPool);
  const clearOverride = useStore((s) => s.clearOverride);

  const [newDiscipline, setNewDiscipline] = useState(false);
  const [newPool, setNewPool] = useState(false);
  const [ruleSourcePoolId, setRuleSourcePoolId] = useState('');
  const [ruleTargetPoolId, setRuleTargetPoolId] = useState('');

  const disciplineById = new Map(disciplines.map((d) => [d.id, d] as const));
  const poolById = new Map(pools.map((p) => [p.id, p] as const));
  const poolByKey = new Map(pools.map((p) => [normalizeKey(p.name), p] as const));

  const poolOverrideByKey = new Map(overrides.filter((o) => o.kind === 'pool_discipline').map((o) => [o.sourceKey, o] as const));
  const personOverrideByKey = new Map(overrides.filter((o) => o.kind === 'person_pool').map((o) => [o.sourceKey, o] as const));
  const poolRules = overrides.filter((o) => o.kind === 'pool_person_pool');

  if (disciplines.length === 0 && pools.length === 0) {
    return (
      <>
        <EmptyState
          icon="structure"
          title="Nothing to restructure yet"
          description="Set up disciplines and roles in Team first, then come back here to remap them without losing your changes on the next RPM import."
          action={<Button variant="primary" icon="plus" onClick={() => setNewDiscipline(true)}>New discipline</Button>}
        />
        {newDiscipline && (
          <DisciplineFormDrawer onClose={() => setNewDiscipline(false)} onSave={(v: DisciplineFormValue) => { createDiscipline(v); setNewDiscipline(false); }} />
        )}
      </>
    );
  }

  return (
    <div className="structure-view">
      <div className="view-header">
        <div>
          <h1>Structure</h1>
          <p className="view-sub">Remap disciplines and roles without touching the RPM import — these overrides survive a re-import</p>
        </div>
        <div className="view-header-actions">
          <Button icon="plus" onClick={() => setNewDiscipline(true)}>New discipline</Button>
          <Button icon="plus" onClick={() => setNewPool(true)}>New role</Button>
        </div>
      </div>

      <div className="card structure-card">
        <div className="structure-card-header">
          <h2>Emplois repères</h2>
          <p className="view-sub">Move a role to a different discipline for display — the imported binding is kept in the background.</p>
        </div>
        {pools.length === 0 ? (
          <p className="empty-inline">No roles yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Emploi</th>
                <th>Discipline effective</th>
                <th>Origine</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => {
                const override = poolOverrideByKey.get(normalizeKey(pool.name));
                const targetDiscipline = override ? disciplines.find((d) => normalizeKey(d.name) === override.targetKey) : undefined;
                const dangling = Boolean(override) && !targetDiscipline;
                const originDiscipline = pool.importDisciplineId ? disciplineById.get(pool.importDisciplineId) : undefined;
                return (
                  <tr key={pool.id}>
                    <td className="cell-name">
                      <span className="pool-dot" style={{ background: pool.color }} />
                      {pool.name}
                    </td>
                    <td>
                      <select
                        value={override ? (targetDiscipline?.id ?? USE_BASELINE) : USE_BASELINE}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === USE_BASELINE) {
                            if (override) clearOverride(override.id);
                            return;
                          }
                          const discipline = disciplineById.get(value);
                          if (discipline) setPoolDiscipline(pool.name, discipline.name);
                        }}
                      >
                        <option value={USE_BASELINE}>— Use origin —</option>
                        {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      {dangling && <span className="pill pill-warning structure-dangling">target missing</span>}
                    </td>
                    <td className="structure-origin">{originDiscipline?.name ?? 'Unassigned'}</td>
                    <td>
                      {override && <Button variant="ghost" size="sm" onClick={() => clearOverride(override.id)}>Clear override</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card structure-card">
        <div className="structure-card-header">
          <h2>Remap a whole role</h2>
          <p className="view-sub">Move everyone currently in one role to another, as a rule. A person-level override above still wins over this rule.</p>
        </div>
        <div className="structure-rule-form">
          <select value={ruleSourcePoolId} onChange={(e) => setRuleSourcePoolId(e.target.value)}>
            <option value="">Source role…</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Icon name="chevron-right" size={14} className="structure-rule-arrow" />
          <select value={ruleTargetPoolId} onChange={(e) => setRuleTargetPoolId(e.target.value)}>
            <option value="">Target role…</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button
            variant="primary"
            disabled={!ruleSourcePoolId || !ruleTargetPoolId || ruleSourcePoolId === ruleTargetPoolId}
            onClick={() => {
              const source = poolById.get(ruleSourcePoolId);
              const target = poolById.get(ruleTargetPoolId);
              if (source && target) {
                setPoolPersonPool(source.name, target.name);
                setRuleSourcePoolId('');
                setRuleTargetPoolId('');
              }
            }}
          >
            Apply rule
          </Button>
        </div>
        {poolRules.length > 0 && (
          <ul className="structure-rule-list">
            {poolRules.map((rule: StructureOverride) => {
              const sourcePool = poolByKey.get(rule.sourceKey);
              const targetPool = poolByKey.get(rule.targetKey);
              return (
                <li key={rule.id}>
                  <span>{sourcePool?.name ?? rule.sourceKey}</span>
                  <Icon name="chevron-right" size={13} className="structure-rule-arrow" />
                  <span>{targetPool?.name ?? rule.targetKey}</span>
                  {(!sourcePool || !targetPool) && <span className="pill pill-warning structure-dangling">target missing</span>}
                  <Button variant="ghost" size="sm" onClick={() => clearOverride(rule.id)}>Clear</Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card structure-card">
        <div className="structure-card-header">
          <h2>Personnes</h2>
          <p className="view-sub">Override the role shown for one person, without changing their record in Team.</p>
        </div>
        {people.length === 0 ? (
          <p className="empty-inline">No people yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Emploi affiché</th>
                <th>Origine</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const override = personOverrideByKey.get(normalizeKey(person.name));
                const targetPool = override ? pools.find((p) => normalizeKey(p.name) === override.targetKey) : undefined;
                const dangling = Boolean(override) && !targetPool;
                const originPool = person.importPoolId ? poolById.get(person.importPoolId) : undefined;
                return (
                  <tr key={person.id}>
                    <td className="cell-name">{person.name}</td>
                    <td>
                      <select
                        value={override ? (targetPool?.id ?? USE_BASELINE) : USE_BASELINE}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === USE_BASELINE) {
                            if (override) clearOverride(override.id);
                            return;
                          }
                          const pool = poolById.get(value);
                          if (pool) setPersonPool(person.name, pool.name);
                        }}
                      >
                        <option value={USE_BASELINE}>— Use origin —</option>
                        {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {dangling && <span className="pill pill-warning structure-dangling">target missing</span>}
                    </td>
                    <td className="structure-origin">{originPool?.name ?? 'Unassigned'}</td>
                    <td>
                      {override && <Button variant="ghost" size="sm" onClick={() => clearOverride(override.id)}>Clear override</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {newDiscipline && (
        <DisciplineFormDrawer onClose={() => setNewDiscipline(false)} onSave={(v: DisciplineFormValue) => { createDiscipline(v); setNewDiscipline(false); }} />
      )}
      {newPool && (
        <PoolFormDrawer disciplines={disciplines} onClose={() => setNewPool(false)} onSave={(v: PoolFormValue) => { createPool({ ...v, capacityFte: 0 }); setNewPool(false); }} />
      )}
    </div>
  );
}
