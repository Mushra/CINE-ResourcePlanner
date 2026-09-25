import { useStore } from '../../../store/useStore';
import { addMonths, comparePeriod, periodFromISODate, periodRange, todayPeriod } from '../../../domain/periods';
import { UNASSIGNED_DISCIPLINE_ID } from '../../../engine/planning';
import { BASE_SCENARIO_ID } from '../../../db/repository';
import { isGenericPoolName } from '../../../domain/identity';
import { Button } from '../../components/Button';
import { ConfirmButton } from '../../components/ConfirmButton';
import { RequirementTimeline, type AssignmentPoolGroup, type RequirementGroup, type RequirementLane } from '../../components/RequirementTimeline';
import type { Project } from '../../../domain/types';

const UNASSIGNED_COLOR = '#9ca3af';

/**
 * The pre-existing "Staffing" card (RPM-style requirement-vs-assignment timeline), unchanged in
 * behavior — extracted verbatim out of ProjectDetail so it can live behind Watchtower's
 * Production/Staffing switch. See docs/WATCHTOWER.md — staffing % (this view) and planned
 * production (the Production view's LOQs) are deliberately not merged; that reconciliation is
 * future engine work, not something this view invents.
 */
export function StaffingView({ project }: { project: Project }) {
  const disciplines = useStore((s) => s.data.disciplines);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const engine = useStore((s) => s.engine);
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

  return (
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
  );
}
