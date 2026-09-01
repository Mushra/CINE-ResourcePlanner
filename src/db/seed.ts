import type { PlannerDatabase } from './database';
import {
  createPool,
  createProject,
  getOrCreateAssignment,
  getOrCreateRequirement,
  setAssignmentAllocation,
  setRequirementAllocation,
} from './repository';

type Alloc = Record<string, number>;

function setAllocations(
  db: PlannerDatabase,
  projectId: string,
  poolId: string,
  required: Alloc,
  assigned: Alloc,
): void {
  if (Object.keys(required).length > 0) {
    const req = getOrCreateRequirement(db, projectId, poolId);
    for (const [period, fte] of Object.entries(required)) setRequirementAllocation(db, req.id, period, fte);
  }
  if (Object.keys(assigned).length > 0) {
    const asn = getOrCreateAssignment(db, projectId, poolId);
    for (const [period, fte] of Object.entries(assigned)) setAssignmentAllocation(db, asn.id, period, fte);
  }
}

/**
 * Seeds a demonstrable plan: healthy pools, one over-capacity month (Animation, Nov), one
 * understaffed project (Cinematic Alpha), a critical-priority understaffed month (Charlie), a
 * TBD project (Delta), and visible spare capacity (VFX) alongside the Alpha shortfall — so every
 * V1 sanity-check category fires at least once on first launch.
 */
export function seedDemoData(db: PlannerDatabase): void {
  const animation = createPool(db, { name: 'Animation', capacityFte: 8, color: '#4f7cff' });
  const lighting = createPool(db, { name: 'Lighting', capacityFte: 4, color: '#f5a524' });
  const vfx = createPool(db, { name: 'VFX', capacityFte: 3, color: '#a855f7' });
  const techArt = createPool(db, { name: 'Tech Art', capacityFte: 2, color: '#22c3aa' });
  const techDesign = createPool(db, { name: 'Tech Design', capacityFte: 3, color: '#ec6a9c' });

  const alpha = createProject(db, {
    name: 'Cinematic Alpha',
    status: 'active',
    startDate: '2026-09-01',
    startCertainty: 'estimated',
    endDate: '2026-12-31',
    endCertainty: 'estimated',
    priority: 'medium',
    notes: 'Hero cinematic for the season finale. VFX bar was recently raised — staffing has not caught up.',
  });

  const bravo = createProject(db, {
    name: 'Cinematic Bravo',
    status: 'active',
    startDate: '2026-10-01',
    startCertainty: 'confirmed',
    endDate: '2027-01-31',
    endCertainty: 'estimated',
    priority: 'high',
    notes: 'Fully staffed to plan. Watch Animation capacity in November — portfolio-wide crunch.',
  });

  const charlie = createProject(db, {
    name: 'Cinematic Charlie',
    status: 'planned',
    startDate: '2026-11-01',
    startCertainty: 'estimated',
    endDate: '2027-02-28',
    endCertainty: 'estimated',
    priority: 'critical',
    notes: 'Greenlit for a December trailer beat — Animation is one FTE short that month.',
  });

  const delta = createProject(db, {
    name: 'Cinematic Delta',
    status: 'planned',
    startDate: null,
    startCertainty: 'tbd',
    endDate: null,
    endCertainty: 'tbd',
    priority: 'low',
    notes: 'Pending greenlight. Tech Design has pencilled in early capacity for Q1.',
  });

  // Cinematic Alpha — Animation dips 1 FTE short in November; VFX runs half-staffed throughout.
  setAllocations(db, alpha.id, animation.id,
    { '2026-09': 1, '2026-10': 2, '2026-11': 3, '2026-12': 1 },
    { '2026-09': 1, '2026-10': 2, '2026-11': 2, '2026-12': 1 });
  setAllocations(db, alpha.id, lighting.id,
    { '2026-09': 1, '2026-10': 1, '2026-11': 1 },
    { '2026-09': 1, '2026-10': 1, '2026-11': 1 });
  setAllocations(db, alpha.id, vfx.id,
    { '2026-10': 1, '2026-11': 1 },
    { '2026-10': 0.5, '2026-11': 0.5 });

  // Cinematic Bravo — fully staffed; light Tech Art usage leaves that pool with headroom.
  setAllocations(db, bravo.id, animation.id,
    { '2026-10': 2, '2026-11': 3, '2026-12': 3, '2027-01': 1 },
    { '2026-10': 2, '2026-11': 3, '2026-12': 3, '2027-01': 1 });
  setAllocations(db, bravo.id, lighting.id,
    { '2026-10': 1, '2026-11': 1, '2026-12': 1 },
    { '2026-10': 1, '2026-11': 1, '2026-12': 1 });
  setAllocations(db, bravo.id, techArt.id,
    { '2026-10': 0.5, '2026-11': 0.5, '2026-12': 0.5 },
    { '2026-10': 0.5, '2026-11': 0.5, '2026-12': 0.5 });

  // Cinematic Charlie — critical priority; one FTE short on Animation in December.
  setAllocations(db, charlie.id, animation.id,
    { '2026-11': 3, '2026-12': 2, '2027-01': 1 },
    { '2026-11': 3, '2026-12': 1, '2027-01': 1 });
  setAllocations(db, charlie.id, techDesign.id,
    { '2026-11': 1, '2026-12': 1, '2027-01': 0.5 },
    {});

  // Cinematic Delta — TBD dates; a pencilled-in Tech Design need with no assignment yet.
  setAllocations(db, delta.id, techDesign.id,
    { '2027-03': 1, '2027-04': 1 },
    {});
}

export function isDatabaseEmpty(db: PlannerDatabase): boolean {
  const rows = db.query<{ c: number }>('SELECT COUNT(*) as c FROM projects');
  return (rows[0]?.c ?? 0) === 0;
}
