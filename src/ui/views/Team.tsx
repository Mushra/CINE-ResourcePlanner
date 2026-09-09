import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { isGenericPoolName } from '../../domain/identity';
import { isGlobalFilterActive } from '../../domain/filter';
import { todayPeriod } from '../../domain/periods';
import { getSanityChecks } from '../../engine/validation';
import { useFilteredEngine } from '../hooks/useFilteredEngine';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ConfirmButton } from '../components/ConfirmButton';
import { Collapsible } from '../components/Collapsible';
import { Icon } from '../components/Icon';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { DisciplineFormDrawer, type DisciplineFormValue } from '../components/DisciplineFormDrawer';
import { PoolFormDrawer, type PoolFormValue } from '../components/PoolFormDrawer';
import { PersonFormDrawer, type PersonFormValue } from '../components/PersonFormDrawer';
import { BatchEditPersonDrawer, type BatchPersonPatch } from '../components/BatchEditPersonDrawer';
import type { Discipline, Person, ResourcePool } from '../../domain/types';

export function Team() {
  const { engine, options } = useFilteredEngine();
  const globalFilter = useUiStore((s) => s.globalFilter);
  const disciplines = useStore((s) => s.data.disciplines);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const createDiscipline = useStore((s) => s.createDiscipline);
  const updateDiscipline = useStore((s) => s.updateDiscipline);
  const deleteDiscipline = useStore((s) => s.deleteDiscipline);
  const createPool = useStore((s) => s.createPool);
  const updatePool = useStore((s) => s.updatePool);
  const deletePool = useStore((s) => s.deletePool);
  const createPerson = useStore((s) => s.createPerson);
  const updatePerson = useStore((s) => s.updatePerson);
  const batchUpdatePeople = useStore((s) => s.batchUpdatePeople);
  const deletePerson = useStore((s) => s.deletePerson);

  const [newDiscipline, setNewDiscipline] = useState(false);
  const [editingDiscipline, setEditingDiscipline] = useState<Discipline | null>(null);
  const [showNewPool, setShowNewPool] = useState(false);
  const [newPoolDisciplineId, setNewPoolDisciplineId] = useState<string | null>(null);
  const [editingPool, setEditingPool] = useState<ResourcePool | null>(null);
  const [newPersonForPool, setNewPersonForPool] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);

  const setManyCollapsed = useUiStore((s) => s.setManyCollapsed);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);

  const period = todayPeriod();

  const overAllocatedNow = useMemo(() => {
    const map = new Map<string, string>();
    for (const check of getSanityChecks(engine)) {
      if (check.category === 'over_allocated_person' && check.period === period && check.personId) {
        map.set(check.personId, check.impact);
      }
    }
    return map;
  }, [engine, period]);

  const visiblePools = pools.filter((p) => !isGenericPoolName(p.name));

  const knownTeamNames = useMemo(() => [...new Set(people.map((p) => p.team).filter((t) => t.trim().length > 0))].sort(), [people]);
  const knownSiteNames = useMemo(() => [...new Set(people.map((p) => p.site).filter((s) => s.trim().length > 0))].sort(), [people]);

  const groups: { id: string; discipline: Discipline | null; poolsInGroup: ResourcePool[] }[] = engine.disciplines().map((d) => ({
    id: d.id,
    discipline: d,
    poolsInGroup: engine.poolsInDiscipline(d.id).filter((p) => !isGenericPoolName(p.name)),
  }));
  const unassignedPools = engine.poolsInDiscipline(UNASSIGNED_DISCIPLINE_ID).filter((p) => !isGenericPoolName(p.name));
  if (unassignedPools.length > 0) groups.push({ id: UNASSIGNED_DISCIPLINE_ID, discipline: null, poolsInGroup: unassignedPools });

  const anyFilterActive = isGlobalFilterActive(globalFilter);

  const visibleCollapseKeys: string[] = [];
  for (const group of groups) {
    visibleCollapseKeys.push(`team:disc:${group.id}`);
    for (const pool of group.poolsInGroup) visibleCollapseKeys.push(`team:pool:${pool.id}`);
  }

  // Precompute the filtered people for each pool once, both for rendering and for "select all visible".
  const peopleByPool = new Map<string, Person[]>();
  const visiblePersonIds: string[] = [];
  for (const group of groups) {
    for (const pool of group.poolsInGroup) {
      const rolePeople = engine.peopleInPool(pool.id);
      peopleByPool.set(pool.id, rolePeople);
      for (const person of rolePeople) visiblePersonIds.push(person.id);
    }
  }
  const allVisibleSelected = visiblePersonIds.length > 0 && visiblePersonIds.every((id) => selected.has(id));

  function toggleSelected(personId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId); else next.add(personId);
      return next;
    });
  }
  function togglePoolSelection(poolPeople: Person[]): void {
    const poolIds = poolPeople.map((p) => p.id);
    const allOn = poolIds.length > 0 && poolIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) poolIds.forEach((id) => next.delete(id));
      else poolIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const selectedPeople = people.filter((p) => selected.has(p.id));

  if (disciplines.length === 0 && pools.length === 0 && people.length === 0) {
    return (
      <>
        <EmptyState
          icon="team"
          title="No team set up yet"
          description="Add a discipline, then roles and people, to start staffing projects by name."
          action={<Button variant="primary" icon="plus" onClick={() => setNewDiscipline(true)}>New discipline</Button>}
        />
        {newDiscipline && (
          <DisciplineFormDrawer
            onClose={() => setNewDiscipline(false)}
            onSave={(v: DisciplineFormValue) => { createDiscipline(v); setNewDiscipline(false); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="team-view">
      <div className="view-header">
        <div>
          <h1>Teams</h1>
          <p className="view-sub">Disciplines, roles and people — the org chart behind staffing</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setNewDiscipline(true)}>New discipline</Button>
      </div>

      <GlobalFilterBar options={options} />

      <div className="team-toolbar">
        {visibleCollapseKeys.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setManyCollapsed(visibleCollapseKeys, false)}>Expand all</Button>
            <Button variant="ghost" size="sm" onClick={() => setManyCollapsed(visibleCollapseKeys, true)}>Collapse all</Button>
          </>
        )}
        {visiblePersonIds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visiblePersonIds))}
          >
            {allVisibleSelected ? 'Deselect all' : `Select all (${visiblePersonIds.length})`}
          </Button>
        )}
        {selected.size > 0 && (
          <div className="team-batch-bar">
            <span>{selected.size} selected</span>
            <Button size="sm" variant="primary" onClick={() => setShowBatchEdit(true)}>Batch edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      <div className="team-disciplines">
        {groups.map((group) => (
          <Collapsible
            key={group.id}
            scopeKey={`team:disc:${group.id}`}
            className="card discipline-card"
            summary={
              <>
                <span className="discipline-dot" style={{ background: group.discipline?.color ?? '#9ca3af' }} />
                <h2>{group.discipline?.name ?? 'Unassigned'}</h2>
                <span className="discipline-role-count">{group.poolsInGroup.length} role{group.poolsInGroup.length === 1 ? '' : 's'}</span>
                <div className="discipline-actions" onClick={(e) => e.stopPropagation()}>
                  {group.discipline && (
                    <>
                      <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingDiscipline(group.discipline)}>Edit</Button>
                      <ConfirmButton label="Delete" onConfirm={() => deleteDiscipline(group.discipline!.id)} />
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="plus"
                    onClick={() => { setNewPoolDisciplineId(group.discipline?.id ?? null); setShowNewPool(true); }}
                  >
                    Add role
                  </Button>
                </div>
              </>
            }
          >
            {group.poolsInGroup.length === 0 ? (
              <p className="empty-inline">No roles in this discipline yet.</p>
            ) : (
              <div className="team-roles">
                {group.poolsInGroup.map((pool) => {
                  const rolePeople = peopleByPool.get(pool.id) ?? [];
                  const poolAllSelected = rolePeople.length > 0 && rolePeople.every((p) => selected.has(p.id));
                  const poolOverridden = pool.importDisciplineId !== pool.disciplineId;
                  return (
                    <Collapsible
                      key={pool.id}
                      scopeKey={`team:pool:${pool.id}`}
                      className="team-role"
                      summary={
                        <>
                          <span className="pool-dot" style={{ background: pool.color }} />
                          <h3>{pool.name}</h3>
                          {poolOverridden && (
                            <span className="team-override-flag" title="This role's discipline is set by a Structure override, which takes precedence over the Discipline field in Edit role.">
                              <Icon name="structure" size={12} />
                            </span>
                          )}
                          <span className="team-role-capacity">{engine.getCapacity(pool.id, period)} FTE</span>
                          <div className="team-role-actions" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingPool(pool)}>Edit</Button>
                            <ConfirmButton label="Delete" onConfirm={() => deletePool(pool.id)} />
                            <Button variant="ghost" size="sm" icon="plus" onClick={() => setNewPersonForPool(pool.id)}>Add person</Button>
                          </div>
                        </>
                      }
                    >
                      {rolePeople.length === 0 ? (
                        <p className="empty-inline">No people in this role yet.</p>
                      ) : (
                        <table className="data-table team-people-table">
                          <thead>
                            <tr>
                              <th>
                                <input
                                  type="checkbox"
                                  className="team-select-checkbox"
                                  checked={poolAllSelected}
                                  onChange={() => togglePoolSelection(rolePeople)}
                                  aria-label="Select all in this role"
                                />
                              </th>
                              <th>Name</th>
                              <th>Team</th>
                              <th>Site</th>
                              <th>Assigned now</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {rolePeople.map((person) => (
                              <tr key={person.id} className={person.active ? '' : 'person-inactive'}>
                                <td>
                                  <input
                                    type="checkbox"
                                    className="team-select-checkbox"
                                    checked={selected.has(person.id)}
                                    onChange={() => toggleSelected(person.id)}
                                    aria-label={`Select ${person.name}`}
                                  />
                                </td>
                                <td>
                                  {person.name}
                                  {person.importPoolId !== person.poolId && (
                                    <span className="team-override-flag" title="This person's role is set by a Structure override or role-remap rule, which takes precedence over the Role field in Edit person.">
                                      <Icon name="structure" size={11} />
                                    </span>
                                  )}
                                </td>
                                <td>{person.team || '—'}</td>
                                <td>{person.site || '—'}</td>
                                <td>
                                  {engine.getPersonAssigned(person.id, period)}
                                  {overAllocatedNow.has(person.id) && (
                                    <span className="team-overalloc-flag" title={overAllocatedNow.get(person.id)}>
                                      <Icon name="warning" size={12} />
                                    </span>
                                  )}
                                </td>
                                <td>{person.active ? 'Active' : 'Inactive'}</td>
                                <td className="team-people-actions">
                                  <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingPerson(person)} />
                                  <ConfirmButton label="Delete" onConfirm={() => deletePerson(person.id)} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </Collapsible>
        ))}
        {groups.length === 0 && anyFilterActive && (
          <p className="empty-inline empty-inline-filtered">No discipline matches the current filters.</p>
        )}
      </div>

      {newDiscipline && (
        <DisciplineFormDrawer
          onClose={() => setNewDiscipline(false)}
          onSave={(v: DisciplineFormValue) => { createDiscipline(v); setNewDiscipline(false); }}
        />
      )}
      {editingDiscipline && (
        <DisciplineFormDrawer
          discipline={editingDiscipline}
          onClose={() => setEditingDiscipline(null)}
          onSave={(v: DisciplineFormValue) => { updateDiscipline({ ...editingDiscipline, ...v }); setEditingDiscipline(null); }}
        />
      )}
      {showNewPool && (
        <PoolFormDrawer
          disciplines={disciplines}
          defaultDisciplineId={newPoolDisciplineId}
          onClose={() => setShowNewPool(false)}
          onSave={(v: PoolFormValue) => { createPool({ ...v, capacityFte: 0 }); setShowNewPool(false); }}
        />
      )}
      {editingPool && (
        <PoolFormDrawer
          pool={editingPool}
          disciplines={disciplines}
          onClose={() => setEditingPool(null)}
          onSave={(v: PoolFormValue) => { updatePool({ ...editingPool, ...v }); setEditingPool(null); }}
        />
      )}
      {newPersonForPool && (
        <PersonFormDrawer
          pools={visiblePools}
          defaultPoolId={newPersonForPool}
          teamOptions={knownTeamNames}
          siteOptions={knownSiteNames}
          onClose={() => setNewPersonForPool(null)}
          onSave={(v: PersonFormValue) => { createPerson(v); setNewPersonForPool(null); }}
        />
      )}
      {editingPerson && (
        <PersonFormDrawer
          person={editingPerson}
          pools={visiblePools}
          teamOptions={knownTeamNames}
          siteOptions={knownSiteNames}
          onClose={() => setEditingPerson(null)}
          onSave={(v: PersonFormValue) => { updatePerson({ ...editingPerson, ...v }); setEditingPerson(null); }}
        />
      )}
      {showBatchEdit && (
        <BatchEditPersonDrawer
          count={selectedPeople.length}
          pools={visiblePools}
          teamOptions={knownTeamNames}
          onClose={() => setShowBatchEdit(false)}
          onSave={(patch: BatchPersonPatch) => {
            batchUpdatePeople(selectedPeople.map((p) => p.id), patch);
            setShowBatchEdit(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
