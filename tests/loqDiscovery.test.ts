import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCOVERY_KEYWORDS,
  detectDepartment,
  disciplineKey,
  discoverMissingLoqs,
  discoverMissingLoqsForProject,
  parseLoqLevel,
  resolveDiscoveryKeywords,
  suggestDisciplineForAssignee,
  suggestDisciplineForRows,
} from '../src/domain/loqDiscovery';
import type { NormalizedJiraIssue } from '../src/import/jiraSync';
import { discipline, loq, person, pool } from './fixtures';

function issue(overrides: Partial<NormalizedJiraIssue> = {}): NormalizedJiraIssue {
  return {
    key: 'X-1',
    summary: '',
    issueType: 'Task',
    status: 'To Do',
    labels: [],
    assignee: null,
    startDate: null,
    dueDate: null,
    resolutionDate: null,
    parentKey: null,
    cinematicName: null,
    loqTarget: null,
    scopeValue: null,
    epicLinkKey: null,
    linkedIssueKeys: [],
    issueLinks: [],
    updatedAt: null,
    ...overrides,
  };
}

// The six tracked disciplines, spelled as they appear in the plan. disciplineKey() normalizes each
// onto the keys of DEFAULT_DISCOVERY_KEYWORDS.
const DISCIPLINES = [
  discipline({ id: 'd-anim', name: 'Anim' }),
  discipline({ id: 'd-light', name: 'Light' }),
  discipline({ id: 'd-vfx', name: 'VFX' }),
  discipline({ id: 'd-cindesign', name: 'CIN Design' }),
  discipline({ id: 'd-techanim', name: 'Tech Anim' }),
  discipline({ id: 'd-props', name: 'Props' }),
];

describe('disciplineKey', () => {
  it('strips accents, lowercases, and single-spaces so plan names and config keys line up', () => {
    expect(disciplineKey('CIN Design')).toBe('cin design');
    expect(disciplineKey('  Tech   Anim ')).toBe('tech anim');
    expect(disciplineKey('Éclairage')).toBe('eclairage');
  });
});

describe('detectDepartment', () => {
  const kw = DEFAULT_DISCOVERY_KEYWORDS;

  it('matches a single-token keyword only on a whole token — TechAnim never triggers Anim', () => {
    // OVR `-`-separated
    expect(detectDepartment('SOLO_S000_CIN Fixers-Anim-L1', kw)).toBe('anim');
    // NEO ` | `-separated
    expect(detectDepartment('SEQ08_SC160_CIN2_Anika | Anim L1', kw)).toBe('anim');
    // TechAnim must resolve to tech anim, not anim
    expect(detectDepartment('SOLO_S000-TechAnim-L2', kw)).toBe('tech anim');
    expect(detectDepartment('Anika | TechAnim L2', kw)).toBe('tech anim');
  });

  it('matches a multi-word keyword against the alphanumeric-collapsed summary (jammed or spaced)', () => {
    expect(detectDepartment('SOLO_S000-CinDesign-L0', kw)).toBe('cin design');
    expect(detectDepartment('Anika | CIN Design L0', kw)).toBe('cin design');
  });

  it('detects Light/VFX/Props on both separators', () => {
    expect(detectDepartment('X-Light-L1', kw)).toBe('light');
    expect(detectDepartment('X | VFX L2', kw)).toBe('vfx');
    expect(detectDepartment('X-Props-L1', kw)).toBe('props');
  });

  it('returns null for departments outside the tracked set (Audio, Music, Narration, …)', () => {
    expect(detectDepartment('X-AudioPass-L1', kw)).toBeNull();
    expect(detectDepartment('Anika | Music L1', kw)).toBeNull();
    expect(detectDepartment('X-Narration-L2', kw)).toBeNull();
  });

  it('honours a custom keyword map (scalable to another project convention)', () => {
    const custom = { animation: ['animation', 'anim'] };
    expect(detectDepartment('Shot-Animation-L1', custom)).toBe('animation');
    expect(detectDepartment('Shot-Light-L1', custom)).toBeNull(); // light no longer configured
  });
});

describe('parseLoqLevel', () => {
  it('prefers the LOQ Target field when it carries a level (OVR)', () => {
    expect(parseLoqLevel('SOLO-Anim-L1', 'L2')).toBe('L2'); // field wins over summary
  });
  it('falls back to the summary when the field is empty (NEO)', () => {
    expect(parseLoqLevel('Anika | Anim L1', null)).toBe('L1');
    expect(parseLoqLevel('Anika | Anim L3', '')).toBe('L3');
  });
  it('returns null when neither carries an L0-L3 token', () => {
    expect(parseLoqLevel('SOLO-CinDesign-MocapPrep', null)).toBeNull();
  });
});

describe('resolveDiscoveryKeywords', () => {
  const global = { anim: ['anim'] };
  const perProject = { light: ['light'] };
  it('per-project override wins, then global, then built-in default (whole-map replacement)', () => {
    expect(resolveDiscoveryKeywords(perProject, global)).toBe(perProject);
    expect(resolveDiscoveryKeywords(null, global)).toBe(global);
    expect(resolveDiscoveryKeywords(null, null)).toBe(DEFAULT_DISCOVERY_KEYWORDS);
    expect(resolveDiscoveryKeywords(undefined, undefined)).toBe(DEFAULT_DISCOVERY_KEYWORDS);
  });
});

describe('discoverMissingLoqs', () => {
  const CINE = 'cine-1';

  it('proposes only tracked-department LOQs that are outward-linked from the epic (OVR shape)', () => {
    const epic = issue({ key: 'OVR-EPIC', linkedIssueKeys: ['OVR-1', 'OVR-2', 'OVR-3', 'OVR-4'] });
    const family = [
      epic,
      issue({ key: 'OVR-1', summary: 'CIN Fixers-Anim-L1', loqTarget: 'L1' }),
      issue({ key: 'OVR-2', summary: 'CIN Fixers-Light-L2', loqTarget: 'L2' }),
      issue({ key: 'OVR-3', summary: 'CIN Fixers-AudioPass-L1', loqTarget: 'L1' }), // untracked dept
      issue({ key: 'OVR-4', summary: 'CIN Fixers-Narration-L2', loqTarget: 'L2' }), // untracked dept
      // A bug sharing the Cinematics List value but NOT linked from the epic → excluded structurally.
      issue({ key: 'OVR-BUG', summary: 'CIN Fixers-Anim-L1 crash', issueType: 'Bug' }),
    ];
    const result = discoverMissingLoqs({
      epicIssue: epic,
      familyIssues: family,
      planLoqs: [],
      disciplines: DISCIPLINES,
      keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => r.jiraKey)).toEqual(['OVR-1', 'OVR-2']);
    expect(result[0]).toMatchObject({ disciplineKey: 'anim', disciplineId: 'd-anim', disciplineName: 'Anim', level: 'L1' });
    expect(result[1]).toMatchObject({ disciplineKey: 'light', disciplineId: 'd-light', disciplineName: 'Light', level: 'L2' });
  });

  it('reads the level from the summary when the LOQ Target field is empty (NEO shape)', () => {
    const epic = issue({ key: 'NEO-EPIC', linkedIssueKeys: ['NEO-1', 'NEO-2'] });
    const family = [
      epic,
      issue({ key: 'NEO-1', summary: 'Anika | Anim L1', loqTarget: null }),
      issue({ key: 'NEO-2', summary: 'Anika | CIN Design L0', loqTarget: null }),
    ];
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs: [], disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => [r.disciplineKey, r.level])).toEqual([
      ['anim', 'L1'],
      ['cin design', 'L0'],
    ]);
  });

  it('treats coverage as (discipline × level): Anim-L1 in the plan does not mask Light-L1', () => {
    const epic = issue({ key: 'E', linkedIssueKeys: ['A1', 'L1'] });
    const family = [
      epic,
      issue({ key: 'A1', summary: 'C-Anim-L1', loqTarget: 'L1' }),
      issue({ key: 'L1', summary: 'C-Light-L1', loqTarget: 'L1' }),
    ];
    const planLoqs = [loq({ cinematicId: CINE, disciplineId: 'd-anim', type: 'L1' })]; // covers Anim-L1 only
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs, disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => r.jiraKey)).toEqual(['L1']); // Anim-L1 covered, Light-L1 still proposed
  });

  it('excludes an issue already bound by jiraKey even at a different level', () => {
    const epic = issue({ key: 'E', linkedIssueKeys: ['A2'] });
    const family = [epic, issue({ key: 'A2', summary: 'C-Anim-L2', loqTarget: 'L2' })];
    const planLoqs = [loq({ cinematicId: CINE, disciplineId: 'd-anim', type: 'L1', jiraKey: 'A2' })];
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs, disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result).toEqual([]);
  });

  it('resolves an unknown-to-the-plan department to disciplineId null (UI shows "create it first")', () => {
    const epic = issue({ key: 'E', linkedIssueKeys: ['P1'] });
    const family = [epic, issue({ key: 'P1', summary: 'C-Props-L1', loqTarget: 'L1' })];
    // Plan has no Props discipline.
    const noProps = DISCIPLINES.filter((d) => d.id !== 'd-props');
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs: [], disciplines: noProps, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ disciplineKey: 'props', disciplineId: null, disciplineName: null, level: 'L1' });
  });

  it('sorts by department, then level, then key, and dedups repeated (dept, level, key)', () => {
    const epic = issue({ key: 'E', linkedIssueKeys: ['V2', 'A1', 'A2'] });
    const family = [
      epic,
      issue({ key: 'V2', summary: 'C-VFX-L2', loqTarget: 'L2' }),
      issue({ key: 'A2', summary: 'C-Anim-L2', loqTarget: 'L2' }),
      issue({ key: 'A1', summary: 'C-Anim-L1', loqTarget: 'L1' }),
    ];
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs: [], disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => r.jiraKey)).toEqual(['A1', 'A2', 'V2']); // anim L1, anim L2, vfx L2
  });

  it('returns [] when the cinematic has no bound epic', () => {
    const result = discoverMissingLoqs({
      epicIssue: null, familyIssues: [], planLoqs: [], disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result).toEqual([]);
  });

  it('skips a linked child that is absent from the fetched batch', () => {
    const epic = issue({ key: 'E', linkedIssueKeys: ['MISSING', 'A1'] });
    const family = [epic, issue({ key: 'A1', summary: 'C-Anim-L1', loqTarget: 'L1' })];
    const result = discoverMissingLoqs({
      epicIssue: epic, familyIssues: family, planLoqs: [], disciplines: DISCIPLINES, keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => r.jiraKey)).toEqual(['A1']);
  });
});

describe('discoverMissingLoqsForProject', () => {
  it('discovers across every bound cinematic, tags each row, and skips unbound cinematics', () => {
    const family = [
      issue({ key: 'EPIC-B', linkedIssueKeys: ['B-A1'] }),
      issue({ key: 'EPIC-A', linkedIssueKeys: ['A-L1'] }),
      issue({ key: 'B-A1', summary: 'C-Anim-L1', loqTarget: 'L1' }),
      issue({ key: 'A-L1', summary: 'C-Light-L1', loqTarget: 'L1' }),
    ];
    const result = discoverMissingLoqsForProject({
      cinematics: [
        { id: 'cine-b', name: 'Bravo', jiraKey: 'EPIC-B' },
        { id: 'cine-a', name: 'Alpha', jiraKey: 'EPIC-A' },
        { id: 'cine-u', name: 'Unbound', jiraKey: null }, // no epic → skipped
      ],
      familyIssues: family,
      planLoqs: [],
      disciplines: DISCIPLINES,
      keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    // Sorted by cinematicName first (Alpha before Bravo), each row tagged with its cinematic.
    expect(result.map((r) => [r.cinematicName, r.jiraKey])).toEqual([
      ['Alpha', 'A-L1'],
      ['Bravo', 'B-A1'],
    ]);
    expect(result[0]).toMatchObject({ cinematicId: 'cine-a', disciplineId: 'd-light' });
    expect(result[1]).toMatchObject({ cinematicId: 'cine-b', disciplineId: 'd-anim' });
  });

  it('scopes coverage per cinematic — a plan LOQ under one cinematic does not mask another', () => {
    const family = [
      issue({ key: 'EPIC-A', linkedIssueKeys: ['A-A1'] }),
      issue({ key: 'EPIC-B', linkedIssueKeys: ['B-A1'] }),
      issue({ key: 'A-A1', summary: 'C-Anim-L1', loqTarget: 'L1' }),
      issue({ key: 'B-A1', summary: 'C-Anim-L1', loqTarget: 'L1' }),
    ];
    // Cinematic A already has Anim-L1; cinematic B does not.
    const planLoqs = [loq({ cinematicId: 'cine-a', disciplineId: 'd-anim', type: 'L1' })];
    const result = discoverMissingLoqsForProject({
      cinematics: [
        { id: 'cine-a', name: 'Alpha', jiraKey: 'EPIC-A' },
        { id: 'cine-b', name: 'Bravo', jiraKey: 'EPIC-B' },
      ],
      familyIssues: family,
      planLoqs,
      disciplines: DISCIPLINES,
      keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => [r.cinematicName, r.jiraKey])).toEqual([['Bravo', 'B-A1']]);
  });

  it('skips a cinematic whose bound epic is absent from the batch', () => {
    const family = [issue({ key: 'EPIC-A', linkedIssueKeys: ['A-A1'] }), issue({ key: 'A-A1', summary: 'C-Anim-L1', loqTarget: 'L1' })];
    const result = discoverMissingLoqsForProject({
      cinematics: [
        { id: 'cine-a', name: 'Alpha', jiraKey: 'EPIC-A' },
        { id: 'cine-x', name: 'Xray', jiraKey: 'EPIC-GONE' }, // key not in batch
      ],
      familyIssues: family,
      planLoqs: [],
      disciplines: DISCIPLINES,
      keywords: DEFAULT_DISCOVERY_KEYWORDS,
    });
    expect(result.map((r) => r.cinematicId)).toEqual(['cine-a']);
  });
});

describe('suggestDisciplineForAssignee', () => {
  const anim = discipline({ id: 'd-anim', name: 'Animation' });
  const animPool = pool({ id: 'p-anim', name: 'Animator', disciplineId: anim.id });
  const ada = person({ id: 'u-ada', name: 'Ada Lovelace', poolId: animPool.id });

  it("returns the discipline of the matched person's pool", () => {
    expect(suggestDisciplineForAssignee('Ada Lovelace', [ada], [animPool])).toBe('d-anim');
  });

  it('matches accent/order-insensitively (via personMatchKey)', () => {
    const eloise = person({ id: 'u-el', name: 'Éloïse Martin', poolId: animPool.id });
    expect(suggestDisciplineForAssignee('Martin Eloise', [eloise], [animPool])).toBe('d-anim');
  });

  it('returns null for an empty/whitespace assignee, an unknown name, or a person with no pool', () => {
    expect(suggestDisciplineForAssignee(null, [ada], [animPool])).toBeNull();
    expect(suggestDisciplineForAssignee('   ', [ada], [animPool])).toBeNull();
    expect(suggestDisciplineForAssignee('Nobody Here', [ada], [animPool])).toBeNull();
    const poolless = person({ id: 'u-x', name: 'No Pool', poolId: null });
    expect(suggestDisciplineForAssignee('No Pool', [poolless], [animPool])).toBeNull();
  });

  it('returns null when the matched pool carries no discipline', () => {
    const orphanPool = pool({ id: 'p-orphan', name: 'Floaters', disciplineId: null });
    const bob = person({ id: 'u-bob', name: 'Bob', poolId: orphanPool.id });
    expect(suggestDisciplineForAssignee('Bob', [bob], [orphanPool])).toBeNull();
  });

  it('suggestDisciplineForRows returns the first row assignee that resolves', () => {
    const rows = [
      { assignee: 'Nobody Here' },
      { assignee: 'Ada Lovelace' },
      { assignee: null },
    ];
    expect(suggestDisciplineForRows(rows, [ada], [animPool])).toBe('d-anim');
    expect(suggestDisciplineForRows([{ assignee: 'Nobody' }], [ada], [animPool])).toBeNull();
    expect(suggestDisciplineForRows([], [ada], [animPool])).toBeNull();
  });
});
