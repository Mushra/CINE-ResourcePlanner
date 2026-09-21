import { Drawer } from './Drawer';
import { StatusPill } from './StatusPill';
import type { CheckCategory } from '../../engine/validation';

interface RuleDoc {
  category: CheckCategory;
  title: string;
  severities: ('critical' | 'warning' | 'info')[];
  description: string;
}

const RULES: RuleDoc[] = [
  {
    category: 'over_capacity',
    title: 'Over capacity',
    severities: ['critical'],
    description: "A discipline's total demand across every project in a month exceeds the total capacity of the people staffed in that discipline.",
  },
  {
    category: 'unstaffed_requirement',
    title: 'Unstaffed requirement',
    severities: ['critical'],
    description: "An active project needs a discipline (its requirement is above zero at some point) but has zero people assigned to it, for the whole project.",
  },
  {
    category: 'understaffed_project',
    title: 'Understaffed project',
    severities: ['critical', 'warning'],
    description: "An active project has some people assigned to a discipline in a month, but fewer than the requirement calls for. Critical on high/critical-priority projects, warning otherwise.",
  },
  {
    category: 'over_allocated',
    title: 'Over-allocated (project)',
    severities: ['warning'],
    description: "An active project has more people assigned to a discipline in a month than its requirement calls for.",
  },
  {
    category: 'assignment_without_requirement',
    title: 'Assignment without requirement',
    severities: ['warning'],
    description: 'An active project has people assigned to a discipline in a month where no requirement exists for that discipline at all.',
  },
  {
    category: 'duration_mismatch',
    title: 'Duration mismatch',
    severities: ['warning'],
    description: "A discipline is staffed on a project outside the months its requirement covers — e.g. people still assigned after the discipline's need ends.",
  },
  {
    category: 'invalid_dates',
    title: 'Invalid dates',
    severities: ['critical', 'warning'],
    description: 'A project ends before it starts (critical), or has staffing outside its own start/end dates (warning).',
  },
  {
    category: 'tbd_dates',
    title: 'TBD dates',
    severities: ['warning'],
    description: 'An active project has a start or end date still marked TBD, limiting how reliable its timeline and capacity forecast are.',
  },
  {
    category: 'available_not_assigned',
    title: 'Available capacity not assigned',
    severities: ['info'],
    description: 'A project is understaffed on a discipline while that same discipline has spare, unassigned capacity on other projects that could help cover the gap.',
  },
  {
    category: 'unstaffed_person',
    title: 'Unstaffed person',
    severities: ['info'],
    description: 'An active person with capacity has no real assignment (excluding bench/dispo placeholders) anywhere in the next few months.',
  },
  {
    category: 'over_allocated_person',
    title: 'Over-allocated (person)',
    severities: ['warning'],
    description: "An active person is staffed, across all of their projects combined, above their own capacity in a month.",
  },
  {
    category: 'capacity_conflict_cinematic',
    title: 'Cinematic capacity conflict',
    severities: ['critical'],
    description: "A project's bottom-up LOQ demand for a discipline in a month (summed across all of its Cinematics) exceeds the project's own top-down requirement for that discipline.",
  },
  {
    category: 'loq_at_risk',
    title: 'LOQ at risk',
    severities: ['critical', 'warning'],
    description: "A LOQ's forecast has slipped past its committed date and isn't yet Done. Critical past a 5-day slip, warning otherwise.",
  },
  {
    category: 'loq_root_cause',
    title: 'LOQ root cause',
    severities: ['critical'],
    description: 'A LOQ carrying its own declared variance (or a late actual finish) is the root cause of at least one downstream delay — surfaced once, with the impacted LOQs listed rather than as separate checks.',
  },
  {
    category: 'loq_early_opportunity',
    title: 'Early completion opportunity',
    severities: ['info'],
    description: 'A LOQ is forecast (or actually finished) ahead of its committed date and has a downstream dependent that could be pulled earlier — a flag only, never applied automatically.',
  },
];

// Exported so tests/validationRulesDialog.test.ts can assert RULES stays in sync with CheckCategory
// (see ARCHITECTURE_AUDIT.md §8's drift-risk finding — this hand-maintained mirror has fallen behind
// validation.ts before).
export { RULES };

function SeverityPills({ severities }: { severities: RuleDoc['severities'] }) {
  return (
    <span className="validation-rule-severities">
      {severities.map((s) => (
        <StatusPill key={s} tone={s}>{s === 'critical' ? 'Critical' : s === 'warning' ? 'Warning' : 'Info'}</StatusPill>
      ))}
    </span>
  );
}

export function ValidationRulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="Planning Health Validation Rules" onClose={onClose} width={560}>
      <p className="validation-rules-intro">
        These are the automated checks behind every warning and critical you see on the Dashboard's
        "Needs attention" panel and capacity KPIs, on a project's health badge, and in the Sanity
        Checks sheet of an Excel export. They run continuously on the current scenario — nothing
        here needs to be triggered manually, and a check clears itself as soon as its condition is
        no longer true.
      </p>
      <div className="validation-rules-list">
        {RULES.map((rule) => (
          <div key={rule.category} className="validation-rule">
            <div className="validation-rule-head">
              <strong>{rule.title}</strong>
              <SeverityPills severities={rule.severities} />
            </div>
            <p>{rule.description}</p>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
