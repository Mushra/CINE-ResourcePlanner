import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { addMonths, comparePeriod, periodFromISODate, periodRange, todayPeriod } from '../../domain/periods';
import { getSanityChecks } from '../../engine/validation';
import { UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { BASE_SCENARIO_ID } from '../../db/repository';
import { isGenericPoolName } from '../../domain/identity';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { ConfirmButton } from '../components/ConfirmButton';
import { Collapsible } from '../components/Collapsible';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import { CinematicFormDrawer, type CinematicFormValue } from '../components/CinematicFormDrawer';
import { MppImportDrawer } from '../components/MppImportDrawer';
import { JiraBindingDrawer } from '../components/JiraBindingDrawer';
import { RequirementTimeline, type AssignmentPoolGroup, type RequirementGroup, type RequirementLane } from '../components/RequirementTimeline';
import { deriveProjectStatus, STATUS_LABEL } from '../../domain/projectStatus';
import type { Cinematic } from '../../domain/types';

const CERTAINTY_LABEL: Record<string, string> = { confirmed: 'Confirmed', estimated: 'Estimated', tbd: 'TBD' };
const UNASSIGNED_COLOR = '#9ca3af';

export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.data.projects.find((p) => p.id === projectId));
  const engine = useStore((s) => s.engine);
  const disciplines = useStore((s) => s.data.disciplines);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const cinematics = useStore((s) => s.data.cinematics);
  const loqs = useStore((s) => s.data.loqs);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const createCinematic = useStore((s) => s.createCinematic);
  const updateCinematic = useStore((s) => s.updateCinematic);
  const deleteCinematic = useStore((s) => s.deleteCinematic);
  const requirements = useStore((s) => s.data.requirements);
  const requirementAllocations = useStore((s) => s.data.requirementAllocations);
  const personAssignments = useStore((s) => s.data.personAssignments);
  const personAssignmentAllocations = useStore((s) => s.data.personAssignmentAllocations);
  const setDisciplineRequirement = useStore((s) => s.setDisciplineRequirement);
  const setDisciplineRequirementRange = useStore((s) => s.setDisciplineRequirementRange);
  const setPersonAssignment = useStore((s) => s.setPersonAssignment);
  const setPersonAssignmentRange = useStore((s) => s.setPersonAssignmentRange);
  const clearRequirementPool = useStore((s) => s.clearRequirementPool);
  const clearPersonAssignment = useStore((s) => s.clearPersonAssignment);
  const upsertDisciplineRequirementInterval = useStore((s) => s.upsertDisciplineRequirementInterval);
  const removeDisciplineRequirementInterval = useStore((s) => s.removeDisciplineRequirementInterval);
  const upsertPersonAssignmentInterval = useStore((s) => s.upsertPersonAssignmentInterval);
  const removePersonAssignmentInterval = useStore((s) => s.removePersonAssignmentInterval);
  const feedRequirementsFromAssignments = useStore((s) => s.feedRequirementsFromAssignments);
  const backToProjects = useUiStore((s) => s.backToProjects);
  const openCinematic = useUiStore((s) => s.openCinematic);
  const [editing, setEditing] = useState(false);
  const [newCinematic, setNewCinematic] = useState(false);
  const [editingCinematic, setEditingCinematic] = useState<Cinematic | null>(null);
  const [importingMpp, setImportingMpp] = useState(false);
  const [syncingJira, setSyncingJira] = useState(false);

  const checks = project ? getSanityChecks(engine).filter((c) => c.projectId === project.id) : [];

  if (!project) {
    return (
      <div className="project-detail-view">
        <button type="button" className="back-link" onClick={backToProjects}><Icon name="arrow-left" size={14} /> Back to projects</button>
        <p>This project no longer exists.</p>
      </div>
    );
  }

  const explicitLifecycle = periodRange(periodFromISODate(project.startDate), periodFromISODate(project.endDate));
  const allocatedPeriods = engine.projectAllocatedPeriods(project.id);
  // Editable window = the project's lifecycle unioned with any already-allocated months, padded 6
  // months past the later of the two — so the drag editor always offers room to plan ahead of the
  // recorded end date, rather than locking editing to the current start/end.
  const combinedPeriods = [...explicitLifecycle, ...allocatedPeriods];
  const months = combinedPeriods.length > 0
    ? periodRange(
        combinedPeriods.reduce((min, p) => (comparePeriod(p, min) < 0 ? p : min), combinedPeriods[0]),
        addMonths(combinedPeriods.reduce((max, p) => (comparePeriod(p, max) > 0 ? p : max), combinedPeriods[0]), 6),
      )
    : periodRange(todayPeriod(), addMonths(todayPeriod(), 3));

  const disciplineStaffingByMonth = months.map((m) => engine.getProjectDisciplineStaffing(project.id, m));
  const disciplineIdsWithSignal = new Set<string>();
  disciplineStaffingByMonth.forEach((lines) => {
    for (const line of lines) {
      if (line.required > 0.001 || line.assigned > 0.001) disciplineIdsWithSignal.add(line.disciplineId);
    }
  });
  const usedPoolIds = new Set(engine.projectPoolIds(project.id));
  const assignedPersonIds = new Set<string>();
  months.forEach((m) => {
    for (const line of engine.getProjectPersonStaffing(project.id, m).lines) {
      if (line.fte > 0.001) assignedPersonIds.add(line.personId);
    }
  });

  const groupDefs = [...disciplineIdsWithSignal]
    .map((disciplineId) => {
      if (disciplineId === UNASSIGNED_DISCIPLINE_ID) return { disciplineId, label: 'Unassigned', color: UNASSIGNED_COLOR };
      const discipline = disciplines.find((d) => d.id === disciplineId);
      return { disciplineId, label: discipline?.name ?? disciplineId, color: discipline?.color ?? UNASSIGNED_COLOR };
    })
    .sort((a, b) => (
      a.disciplineId === UNASSIGNED_DISCIPLINE_ID ? 1
      : b.disciplineId === UNASSIGNED_DISCIPLINE_ID ? -1
      : a.label.localeCompare(b.label)
    ));

  const timelineGroups: RequirementGroup[] = groupDefs.map((def) => {
    const genericPool = pools.find((p) => p.disciplineId === def.disciplineId && isGenericPoolName(p.name));
    const genericReq = genericPool
      ? requirements.find((r) => r.poolId === genericPool.id && r.projectId === project.id && r.scenarioId === BASE_SCENARIO_ID)
      : undefined;

    const needLane: RequirementLane = {
      key: `disc:${def.disciplineId}`,
      label: def.label,
      color: def.color,
      values: disciplineStaffingByMonth.map((lines) => lines.find((l) => l.disciplineId === def.disciplineId)?.required ?? 0),
      onCommitRange: (periods, fte) => setDisciplineRequirementRange(project.id, def.disciplineId, periods, fte),
      onRemove: genericPool ? () => clearRequirementPool(project.id, genericPool.id) : undefined,
      intervals: genericPool
        ? (genericReq ? requirementAllocations.filter((a) => a.requirementId === genericReq.id) : [])
        : undefined,
      onAddInterval: genericPool
        ? (startDate, finishDate, fte) => upsertDisciplineRequirementInterval(project.id, def.disciplineId, null, startDate, finishDate, fte)
        : undefined,
      onUpdateInterval: genericPool
        ? (intervalId, startDate, finishDate, fte) => upsertDisciplineRequirementInterval(project.id, def.disciplineId, intervalId, startDate, finishDate, fte)
        : undefined,
      onDeleteInterval: genericPool ? (intervalId) => removeDisciplineRequirementInterval(intervalId) : undefined,
    };
    const assignedTotals = disciplineStaffingByMonth.map((lines) => lines.find((l) => l.disciplineId === def.disciplineId)?.assigned ?? 0);

    const disciplinePools = pools.filter((p) => (
      !isGenericPoolName(p.name)
      && (def.disciplineId === UNASSIGNED_DISCIPLINE_ID ? p.disciplineId === null : p.disciplineId === def.disciplineId)
    ));
    const specificPools = disciplinePools.filter((p) => usedPoolIds.has(p.id));

    const poolGroups: AssignmentPoolGroup[] = specificPools.map((pool) => {
      const memberNames = new Map<string, string>();
      const memberFteByMonth = new Map<string, number[]>();
      months.forEach((m, mi) => {
        for (const line of engine.getProjectPersonStaffing(project.id, m).lines) {
          if (line.poolId !== pool.id) continue;
          memberNames.set(line.personId, line.personName);
          if (!memberFteByMonth.has(line.personId)) memberFteByMonth.set(line.personId, months.map(() => 0));
          memberFteByMonth.get(line.personId)![mi] = line.fte;
        }
      });
      const personLanes: RequirementLane[] = [...memberNames.keys()]
        .sort((a, b) => memberNames.get(a)!.localeCompare(memberNames.get(b)!))
        .map((personId) => {
          const asn = personAssignments.find((a) => a.personId === personId && a.projectId === project.id && a.scenarioId === BASE_SCENARIO_ID);
          return {
            key: personId,
            label: memberNames.get(personId)!,
            color: pool.color,
            values: memberFteByMonth.get(personId)!,
            onCommitRange: (periods, fte) => setPersonAssignmentRange(personId, project.id, periods, fte),
            onRemove: () => clearPersonAssignment(personId, project.id),
            intervals: asn ? personAssignmentAllocations.filter((a) => a.personAssignmentId === asn.id) : [],
            onAddInterval: (startDate, finishDate, fte) => upsertPersonAssignmentInterval(personId, project.id, null, startDate, finishDate, fte),
            onUpdateInterval: (intervalId, startDate, finishDate, fte) => upsertPersonAssignmentInterval(personId, project.id, intervalId, startDate, finishDate, fte),
            onDeleteInterval: (intervalId) => removePersonAssignmentInterval(intervalId),
          };
        });
      return { poolId: pool.id, poolName: pool.name, color: pool.color, personLanes };
    });

    const disciplinePoolIds = new Set(disciplinePools.map((p) => p.id));
    const addPersonOptions = people
      .filter((p) => p.poolId && disciplinePoolIds.has(p.poolId) && !assignedPersonIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: `${p.name} (${pools.find((pl) => pl.id === p.poolId)?.name ?? ''})` }));

    return {
      key: def.disciplineId,
      label: def.label,
      color: def.color,
      needLane,
      assignedTotals,
      poolGroups,
      addPersonOptions,
      onAddPerson: (personId) => setPersonAssignment(personId, project.id, months[0] ?? todayPeriod(), 1),
    };
  });

  const addableDisciplines = disciplines
    .filter((d) => !disciplineIdsWithSignal.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const projectCinematics = cinematics
    .filter((c) => c.projectId === project.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const loqCountByCinematic = new Map<string, number>();
  for (const loq of loqs) loqCountByCinematic.set(loq.cinematicId, (loqCountByCinematic.get(loq.cinematicId) ?? 0) + 1);

  return (
    <div className="project-detail-view">
      <button type="button" className="back-link" onClick={backToProjects}><Icon name="arrow-left" size={14} /> Back to projects</button>

      <div className="card detail-header">
        <div className="detail-header-top">
          <div>
            <h1>{project.name}</h1>
            <div className="detail-meta">
              <span className={`status-dot status-${deriveProjectStatus(project)}`} />
              <span>{STATUS_LABEL[deriveProjectStatus(project)]}</span>
              <span className="meta-sep">·</span>
              <span className={`priority-badge priority-${project.priority}`}>{project.priority}</span>
              {project.isDispo && (
                <>
                  <span className="meta-sep">·</span>
                  <span className="dispo-badge">Dispo</span>
                </>
              )}
            </div>
          </div>
          <div className="detail-header-actions">
            <Button variant="secondary" icon="edit" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmButton label="Delete" onConfirm={() => { deleteProject(project.id); backToProjects(); }} />
          </div>
        </div>

        <div className="detail-dates">
          <DateChip label="Start" date={project.startDate} certainty={project.startCertainty} />
          <DateChip label="End" date={project.endDate} certainty={project.endCertainty} />
        </div>

        {project.notes && <p className="detail-notes">{project.notes}</p>}

        {checks.length > 0 && (
          <Collapsible scopeKey={`projdetail:checks:${project.id}`} count={checks.length} summary={<span>Warnings</span>}>
            <div className="detail-checks">
              {checks.map((c) => (
                <div key={c.id} className="detail-check-row">
                  <StatusPill tone={c.severity}>{c.severity}</StatusPill>
                  <span>{c.message} — {c.impact}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}
      </div>

      <div className="card cinematics-card">
        <div className="panel-header">
          <h2>Cinematics</h2>
          <span className="panel-sub">LOQ-level milestones under this project</span>
          <div className="panel-header-toggles">
            <Button variant="secondary" size="sm" icon="file-plus" onClick={() => setImportingMpp(true)}>Import .mpp</Button>
            <Button variant="secondary" size="sm" icon="link" onClick={() => setSyncingJira(true)}>Sync with Jira</Button>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setNewCinematic(true)}>New cinematic</Button>
          </div>
        </div>

        {projectCinematics.length === 0 ? (
          <p className="empty-inline">No cinematics yet. Add one to start scheduling LOQs.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Target date</th>
                  <th>LOQs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projectCinematics.map((cinematic) => (
                  <tr key={cinematic.id} className="clickable-row" onClick={() => openCinematic(cinematic.id)}>
                    <td className="cell-name">{cinematic.name}</td>
                    <td>{cinematic.targetDate ?? <span className="tbd-text">TBD</span>}</td>
                    <td>{loqCountByCinematic.get(cinematic.id) ?? 0}</td>
                    <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingCinematic(cinematic)}>Edit</Button>
                      <ConfirmButton label="Delete" onConfirm={() => deleteCinematic(cinematic.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card requirements-card">
        <div className="panel-header">
          <h2>Staffing</h2>
          <span className="panel-sub">Needs (by discipline) and who's actually assigned, by month</span>
          <div className="panel-header-toggles">
            <Button variant="ghost" size="sm" icon="download" onClick={() => feedRequirementsFromAssignments(project.id, 'fill-empty')}>Fill empty needs from assignments</Button>
            <ConfirmButton
              label="Overwrite needs from assignments"
              confirmLabel="Overwrite"
              icon="download"
              onConfirm={() => feedRequirementsFromAssignments(project.id, 'overwrite')}
            />
          </div>
        </div>

        {timelineGroups.length === 0 ? (
          <p className="empty-inline">No resource requirements yet. Add a discipline below to set a need.</p>
        ) : (
          <RequirementTimeline months={months} groups={timelineGroups} projectId={project.id} />
        )}

        {addableDisciplines.length > 0 && (
          <div className="person-add-assignment">
            <select
              className="person-add-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) setDisciplineRequirement(project.id, e.target.value, months[0] ?? todayPeriod(), 1);
                e.target.value = '';
              }}
            >
              <option value="" disabled>+ Add discipline…</option>
              {addableDisciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {editing && (
        <ProjectFormDrawer
          project={project}
          onClose={() => setEditing(false)}
          onSave={(value: ProjectFormValue) => {
            updateProject({ ...project, ...value });
            setEditing(false);
          }}
        />
      )}

      {newCinematic && (
        <CinematicFormDrawer
          onClose={() => setNewCinematic(false)}
          onSave={(value: CinematicFormValue) => {
            createCinematic({ projectId: project.id, ...value });
            setNewCinematic(false);
          }}
        />
      )}

      {editingCinematic && (
        <CinematicFormDrawer
          cinematic={editingCinematic}
          onClose={() => setEditingCinematic(null)}
          onSave={(value: CinematicFormValue) => {
            updateCinematic({ ...editingCinematic, ...value });
            setEditingCinematic(null);
          }}
        />
      )}

      {importingMpp && (
        <MppImportDrawer projectId={project.id} projectName={project.name} onClose={() => setImportingMpp(false)} />
      )}

      {syncingJira && (
        <JiraBindingDrawer projectId={project.id} projectName={project.name} onClose={() => setSyncingJira(false)} />
      )}
    </div>
  );
}

function DateChip({ label, date, certainty }: { label: string; date: string | null; certainty: string }) {
  return (
    <div className={`date-chip certainty-${certainty}`}>
      <span className="date-chip-label">{label}</span>
      <span className="date-chip-value">{date ?? 'TBD'}</span>
      <span className="date-chip-certainty">{CERTAINTY_LABEL[certainty]}</span>
    </div>
  );
}
