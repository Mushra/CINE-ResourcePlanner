import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { normalizeKey, isGenericPoolName } from '../../domain/identity';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Collapsible } from '../components/Collapsible';
import { PoolFormDrawer, type PoolFormValue } from '../components/PoolFormDrawer';
import type { Discipline, StructureOverride } from '../../domain/types';

const USE_BASELINE = '__baseline__';

/** Remapping overrides that survive an RPM re-import — an edge-case operation, so it lives inside
 * Team as a closed-by-default "advanced" section rather than its own nav item. */
export function StructureSection({ disciplines }: { disciplines: Discipline[] }) {
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const overrides = useStore((s) => s.data.structureOverrides);
  const createPool = useStore((s) => s.createPool);
  const setPoolDiscipline = useStore((s) => s.setPoolDiscipline);
  const setPersonPool = useStore((s) => s.setPersonPool);
  const setPoolPersonPool = useStore((s) => s.setPoolPersonPool);
  const clearOverride = useStore((s) => s.clearOverride);

  const [newPool, setNewPool] = useState(false);
  const [ruleSourcePoolId, setRuleSourcePoolId] = useState('');
  const [ruleTargetPoolId, setRuleTargetPoolId] = useState('');

  const visiblePools = pools.filter((p) => !isGenericPoolName(p.name));

  const disciplineById = new Map(disciplines.map((d) => [d.id, d] as const));
  const poolById = new Map(pools.map((p) => [p.id, p] as const));
  const poolByKey = new Map(pools.map((p) => [normalizeKey(p.name), p] as const));

  const poolOverrideByKey = new Map(overrides.filter((o) => o.kind === 'pool_discipline').map((o) => [o.sourceKey, o] as const));
  const personOverrideByKey = new Map(overrides.filter((o) => o.kind === 'person_pool').map((o) => [o.sourceKey, o] as const));
  const poolRules = overrides.filter((o) => o.kind === 'pool_person_pool');

  return (
    <div className="structure-section">
      <div className="structure-section-header">
        <p className="structure-section-sub">
          Remap disciplines and roles without touching the RPM import — these overrides survive a re-import. An edge-case operation for the rare reorg, not everyday staffing.
        </p>
        <Button size="sm" icon="plus" onClick={() => setNewPool(true)}>New role</Button>
      </div>

      <Collapsible
        scopeKey="structure:rule"
        className="card structure-card"
        defaultOpen
        summary={
          <>
            <h2>Move a whole role to another</h2>
            <span className="structure-card-sub">Everyone currently in one role moves to another, as a standing rule. A person-level override below still wins over this rule.</span>
          </>
        }
      >
        <div className="structure-rule-form">
          <select value={ruleSourcePoolId} onChange={(e) => setRuleSourcePoolId(e.target.value)}>
            <option value="">Source role…</option>
            {visiblePools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Icon name="chevron-right" size={14} className="structure-rule-arrow" />
          <select value={ruleTargetPoolId} onChange={(e) => setRuleTargetPoolId(e.target.value)}>
            <option value="">Target role…</option>
            {visiblePools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
      </Collapsible>

      <Collapsible
        scopeKey="structure:pools"
        className="card structure-card"
        defaultOpen={false}
        summary={
          <>
            <h2>Roles</h2>
            <span className="structure-card-sub">Move a single role to a different discipline for display — the imported binding is kept in the background.</span>
          </>
        }
      >
        {visiblePools.length === 0 ? (
          <p className="empty-inline">No roles yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Effective discipline</th>
                <th>Origin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visiblePools.map((pool) => {
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
      </Collapsible>

      <Collapsible
        scopeKey="structure:people"
        className="card structure-card"
        defaultOpen={false}
        summary={
          <>
            <h2>People</h2>
            <span className="structure-card-sub">Override the role shown for one person, without changing their record above.</span>
          </>
        }
      >
        {people.length === 0 ? (
          <p className="empty-inline">No people yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Effective role</th>
                <th>Origin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const override = personOverrideByKey.get(normalizeKey(person.name));
                const targetPool = override ? pools.find((p) => normalizeKey(p.name) === override.targetKey) : undefined;
                const dangling = Boolean(override) && !targetPool;
                const originPool = person.importPoolId ? poolById.get(person.importPoolId) : undefined;
                // No direct override: fall back to the person's effective poolId, which already
                // reflects a "Move a whole role" rule if one applies (see applyStructureOverrides).
                const selectValue = override ? (targetPool?.id ?? USE_BASELINE) : (person.poolId ?? USE_BASELINE);
                return (
                  <tr key={person.id}>
                    <td className="cell-name">{person.name}</td>
                    <td>
                      <select
                        value={selectValue}
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
                        {visiblePools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
      </Collapsible>

      {newPool && (
        <PoolFormDrawer disciplines={disciplines} onClose={() => setNewPool(false)} onSave={(v: PoolFormValue) => { createPool({ ...v, capacityFte: 0 }); setNewPool(false); }} />
      )}
    </div>
  );
}
