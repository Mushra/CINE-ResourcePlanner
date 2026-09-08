import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { isGenericPoolName } from '../../domain/identity';
import { todayPeriod } from '../../domain/periods';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ConfirmButton } from '../components/ConfirmButton';
import { Collapsible } from '../components/Collapsible';
import { FilterMenu, type FilterOption } from '../components/FilterMenu';
import { DisciplineFormDrawer, type DisciplineFormValue } from '../components/DisciplineFormDrawer';
import { PoolFormDrawer, type PoolFormValue } from '../components/PoolFormDrawer';
import { PersonFormDrawer, type PersonFormValue } from '../components/PersonFormDrawer';
import { BatchEditPersonDrawer, type BatchPersonPatch } from '../components/BatchEditPersonDrawer';
import type { Discipline, Person, ResourcePool } from '../../domain/types';

const NO_TEAM_KEY = '__no_team__';

export function Team() {
  const engine = useStore((s) => s.engine);
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

  const [teamFilter, setTeamFilter] = useState<Set<string> | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);

  const period = todayPeriod();

  const visiblePools = pools.filter((p) => !isGenericPoolName(p.name));

  const teamOptions: FilterOption[] = useMemo(() => {
    const known = [...new Set(people.map((p) => p.team).filter((t) => t.trim().length > 0))].sort();
    const options = known.map((t) => ({ id: t, label: t }));
    if (people.some((p) => !p.team.trim())) options.unshift({ id: NO_TEAM_KEY, label: 'No team' });
    return options;
  }, [people]);
  const knownTeamNames = useMemo(() => teamOptions.filter((o) => o.id !== NO_TEAM_KEY).map((o) => o.label), [teamOptions]);

  function matchesTeamFilter(person: Person): boolean {
    if (!teamFilter) return true;
    return teamFilter.has(person.team.trim() ? person.team : NO_TEAM_KEY);
  }

  const allGroups: { id: string; discipline: Discipline | null; poolsInGroup: ResourcePool[] }[] = engine.disciplines().map((d) => ({
    id: d.id,
    discipline: d,
    poolsInGroup: engine.poolsInDiscipline(d.id).filter((p) => !isGenericPoolName(p.name)),
  }));
  const unassignedPools = engine.poolsInDiscipline(UNASSIGNED_DISCIPLINE_ID).filter((p) => !isGenericPoolName(p.name));
  if (unassignedPools.length > 0) allGroups.push({ id: UNASSIGNED_DISCIPLINE_ID, discipline: null, poolsInGroup: unassignedPools });

  const disciplineOptions: FilterOption[] = allGroups.map((g) => ({ id: g.id, label: g.discipline?.name ?? 'Unassigned', color: g.discipline?.color ?? '#9ca3af' }));

  const anyFilterActive = teamFilter !== null || disciplineFilter !== null;
  const groups = allGroups.filter((g) => !disciplineFilter || disciplineFilter.has(g.id));

  // Precompute the filtered people for each pool once, both for rendering and for "select all visible".
  const peopleByPool = new Map<string, Person[]>();
  const visiblePersonIds: string[] = [];
  for (const group of groups) {
    for (const pool of group.poolsInGroup) {
      const rolePeople = engine.peopleInPool(pool.id).filter(matchesTeamFilter);
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

      <div className="team-toolbar">
        <FilterMenu label="Team" options={teamOptions} activeIds={teamFilter} onChange={setTeamFilter} />
        <FilterMenu label="Discipline" options={disciplineOptions} activeIds={disciplineFilter} onChange={setDisciplineFilter} />
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
                  const rolePeopleAll = engine.peopleInPool(pool.id);
                  const rolePeople = peopleByPool.get(pool.id) ?? [];
                  const poolAllSelected = rolePeople.length > 0 && rolePeople.every((p) => selected.has(p.id));
                  return (
                    <Collapsible
                      key={pool.id}
                      scopeKey={`team:pool:${pool.id}`}
                      className="team-role"
                      summary={
                        <>
                          <span className="pool-dot" style={{ background: pool.color }} />
                          <h3>{pool.name}</h3>
                          <span className="team-role-capacity">{engine.getCapacity(pool.id, period)} FTE</span>
                          <div className="team-role-actions" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingPool(pool)}>Edit</Button>
                            <ConfirmButton label="Delete" onConfirm={() => deletePool(pool.id)} />
                            <Button variant="ghost" size="sm" icon="plus" onClick={() => setNewPersonForPool(pool.id)}>Add person</Button>
                          </div>
                        </>
                      }
                    >
                      {rolePeopleAll.length === 0 ? (
                        <p className="empty-inline">No people in this role yet.</p>
                      ) : rolePeople.length === 0 ? (
                        <p className="empty-inline empty-inline-filtered">No one here matches the current filters.</p>
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
                                <td>{person.name}</td>
                                <td>{person.team || '—'}</td>
                                <td>{engine.getPersonAssigned(person.id, period)}</td>
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
          onClose={() => setNewPersonForPool(null)}
          onSave={(v: PersonFormValue) => { createPerson(v); setNewPersonForPool(null); }}
        />
      )}
      {editingPerson && (
        <PersonFormDrawer
          person={editingPerson}
          pools={visiblePools}
          teamOptions={knownTeamNames}
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
