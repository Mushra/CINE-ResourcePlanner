import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { isGenericPoolName } from '../../domain/identity';
import { todayPeriod } from '../../domain/periods';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ConfirmButton } from '../components/ConfirmButton';
import { Collapsible } from '../components/Collapsible';
import { DisciplineFormDrawer, type DisciplineFormValue } from '../components/DisciplineFormDrawer';
import { PoolFormDrawer, type PoolFormValue } from '../components/PoolFormDrawer';
import { PersonFormDrawer, type PersonFormValue } from '../components/PersonFormDrawer';
import type { Discipline, Person, ResourcePool } from '../../domain/types';

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
  const deletePerson = useStore((s) => s.deletePerson);

  const [newDiscipline, setNewDiscipline] = useState(false);
  const [editingDiscipline, setEditingDiscipline] = useState<Discipline | null>(null);
  const [showNewPool, setShowNewPool] = useState(false);
  const [newPoolDisciplineId, setNewPoolDisciplineId] = useState<string | null>(null);
  const [editingPool, setEditingPool] = useState<ResourcePool | null>(null);
  const [newPersonForPool, setNewPersonForPool] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);

  const period = todayPeriod();

  const visiblePools = pools.filter((p) => !isGenericPoolName(p.name));

  const groups: { id: string; discipline: Discipline | null; poolsInGroup: ResourcePool[] }[] = engine.disciplines().map((d) => ({
    id: d.id,
    discipline: d,
    poolsInGroup: engine.poolsInDiscipline(d.id).filter((p) => !isGenericPoolName(p.name)),
  }));
  const unassignedPools = engine.poolsInDiscipline(UNASSIGNED_DISCIPLINE_ID).filter((p) => !isGenericPoolName(p.name));
  if (unassignedPools.length > 0) groups.push({ id: UNASSIGNED_DISCIPLINE_ID, discipline: null, poolsInGroup: unassignedPools });

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
                  const rolePeople = engine.peopleInPool(pool.id);
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
                      {rolePeople.length === 0 ? (
                        <p className="empty-inline">No people in this role yet.</p>
                      ) : (
                        <table className="data-table team-people-table">
                          <thead>
                            <tr>
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
          onClose={() => setNewPersonForPool(null)}
          onSave={(v: PersonFormValue) => { createPerson(v); setNewPersonForPool(null); }}
        />
      )}
      {editingPerson && (
        <PersonFormDrawer
          person={editingPerson}
          pools={visiblePools}
          onClose={() => setEditingPerson(null)}
          onSave={(v: PersonFormValue) => { updatePerson({ ...editingPerson, ...v }); setEditingPerson(null); }}
        />
      )}
    </div>
  );
}
