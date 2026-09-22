import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import schemaSql from './schema.sql?raw';
import { genericPoolName, isGenericPoolName } from '../domain/identity';

let sqlJsModule: SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModule) {
    // The custom locateFile only makes sense in a browser-like renderer (Electron's window global
    // is defined there): it turns the wasm filename into a fetchable URL relative to BASE_URL.
    // Under Node (tests), BASE_URL is always "/" regardless of this file's actual location, which
    // turns into an absolute drive-root path and breaks — sql.js's own default locateFile already
    // resolves the wasm file correctly there via a plain fs.readFileSync, so skip the override.
    sqlJsModule = await initSqlJs(
      typeof window === 'undefined'
        ? undefined
        : { locateFile: (file: string) => `${import.meta.env.BASE_URL}${file}` },
    );
  }
  return sqlJsModule;
}

// v7 adds cinematics/LOQ tables; purely additive (all CREATE TABLE IF NOT EXISTS), so no
// migrateV6toV7() step is needed — see migrate() below.
// v8 reshapes loq_resources into one row per assignment window (adds start_date/finish_date,
// drops UNIQUE(loq_id, person_id) so a person can have several disjoint windows) — this needs an
// actual migrate step, see migrateV7toV8() below.
// v9 adds cinematics.jira_key (Epic-level Jira binding, see docs/INTEGRATIONS.md §3) — a plain
// column addition, see migrateV8toV9() below.
export const SCHEMA_VERSION = '10';

/** Thin wrapper around a sql.js Database: schema bootstrap, typed helpers, byte export. */
export class PlannerDatabase {
  private readonly db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  static async createNew(): Promise<PlannerDatabase> {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    const wrapper = new PlannerDatabase(db);
    wrapper.applySchema();
    return wrapper;
  }

  static async openFromBytes(bytes: Uint8Array): Promise<PlannerDatabase> {
    const SQL = await getSqlJs();
    const db = new SQL.Database(bytes);
    const wrapper = new PlannerDatabase(db);
    wrapper.applySchema(); // idempotent — heals a DB created by an older schema version
    return wrapper;
  }

  private applySchema(): void {
    this.db.exec(schemaSql);
    const from = this.getSetting('schema_version');
    this.migrate(from);
    // See the comment above idx_cinematics_project in schema.sql: this index has to wait until
    // migrate() has guaranteed the column exists (fresh DBs already have it from schemaSql above;
    // migrateV8toV9() adds it to older ones), so it can't live in the static schema batch.
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cinematics_jira_key ON cinematics(jira_key) WHERE jira_key IS NOT NULL;');
    this.setSetting('schema_version', SCHEMA_VERSION);
    this.healDuplicateGenericPools();
    this.healDanglingReferences();
  }

  /**
   * Collapses any discipline that ended up with more than one generic ("— Unspecified role") pool
   * back to one. This used to happen whenever resolveGenericPoolId (useStore.ts) matched by exact
   * name instead of disciplineId + isGenericPoolName: after a discipline rename, the old generic
   * pool's name (frozen at creation) no longer matched the freshly-computed name, so the next
   * "Overwrite needs from assignments" silently created a second one and wrote into it — leaving
   * the discipline's total need split across two pools, with the stale one un-reachable from the UI
   * and never zeroed out no matter how many times Overwrite ran. Keeps the oldest (lowest
   * sort_order) pool, sums every other one's requirement allocations onto it period-by-period, then
   * deletes the extras; healDanglingReferences (run right after) sweeps their now-orphaned rows.
   */
  private healDuplicateGenericPools(): void {
    type PoolRow = { id: string; name: string; discipline_id: string | null; sort_order: number };
    const pools = this.query<PoolRow>('SELECT id, name, discipline_id, sort_order FROM resource_pools');
    const byDiscipline = new Map<string, PoolRow[]>();
    for (const p of pools) {
      if (!p.discipline_id || !isGenericPoolName(p.name)) continue;
      const arr = byDiscipline.get(p.discipline_id) ?? [];
      arr.push(p);
      byDiscipline.set(p.discipline_id, arr);
    }

    for (const dupes of byDiscipline.values()) {
      if (dupes.length < 2) continue;
      dupes.sort((a, b) => a.sort_order - b.sort_order);
      const [canonical, ...extras] = dupes;

      for (const extra of extras) {
        const reqs = this.query<{ id: string; project_id: string; scenario_id: string }>(
          'SELECT id, project_id, scenario_id FROM requirements WHERE pool_id = ?',
          [extra.id],
        );
        for (const req of reqs) {
          const allocs = this.query<{ period: string; fte: number }>(
            'SELECT period, fte FROM requirement_allocations WHERE requirement_id = ?',
            [req.id],
          );
          if (allocs.length > 0) {
            const existingReq = this.query<{ id: string }>(
              'SELECT id FROM requirements WHERE project_id = ? AND pool_id = ? AND scenario_id = ?',
              [req.project_id, canonical.id, req.scenario_id],
            )[0];
            let canonicalReqId = existingReq?.id;
            if (!canonicalReqId) {
              canonicalReqId = `req_mig_dup_${extra.id}_${req.id}`;
              this.exec('INSERT INTO requirements (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)', [canonicalReqId, req.project_id, canonical.id, req.scenario_id]);
            }
            const existingByPeriod = new Map(
              this.query<{ period: string; fte: number }>('SELECT period, fte FROM requirement_allocations WHERE requirement_id = ?', [canonicalReqId])
                .map((a) => [a.period, a.fte]),
            );
            for (const a of allocs) {
              const total = (existingByPeriod.get(a.period) ?? 0) + a.fte;
              this.exec(
                `INSERT INTO requirement_allocations (requirement_id, period, fte) VALUES (?, ?, ?)
                 ON CONFLICT(requirement_id, period) DO UPDATE SET fte = excluded.fte`,
                [canonicalReqId, a.period, total],
              );
            }
          }
          this.exec('DELETE FROM requirements WHERE id = ?', [req.id]);
        }
        this.exec('DELETE FROM resource_pools WHERE id = ?', [extra.id]);
      }
    }
  }

  /**
   * sql.js never enforces the `ON DELETE SET NULL`/`CASCADE` declared in schema.sql (the
   * foreign_keys pragma defaults off), so a delete written before that was accounted for — or any
   * future one that misses it — can leave a dangling reference. Run defensively on every load to
   * repair anything a save from before the relevant delete-path fix left behind: a pool/person
   * pointing at a gone discipline/pool falls back to "Unassigned"/"no role" like any other
   * unset value, and a requirement/assignment/override pointing at a gone pool/person/requirement
   * (nothing sensible to fall back to) is removed along with it. Same rules extend to the v7
   * cinematics/LOQ tables below: a LOQ has no "Unassigned" fallback for a gone cinematic or
   * discipline (it's fundamentally typed by both), so it's removed along with its own children;
   * a resource/dependency-template edge that only loses a person/discipline falls back the same
   * way an existing pool/person reference does.
   */
  private healDanglingReferences(): void {
    this.db.exec('UPDATE resource_pools SET discipline_id = NULL WHERE discipline_id IS NOT NULL AND discipline_id NOT IN (SELECT id FROM disciplines)');
    this.db.exec('UPDATE people SET pool_id = NULL WHERE pool_id IS NOT NULL AND pool_id NOT IN (SELECT id FROM resource_pools)');
    this.db.exec('DELETE FROM requirement_allocations WHERE requirement_id IN (SELECT id FROM requirements WHERE pool_id NOT IN (SELECT id FROM resource_pools))');
    this.db.exec('DELETE FROM requirements WHERE pool_id NOT IN (SELECT id FROM resource_pools)');
    this.db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id IN (SELECT id FROM person_assignments WHERE person_id NOT IN (SELECT id FROM people))');
    this.db.exec('DELETE FROM person_assignments WHERE person_id NOT IN (SELECT id FROM people)');
    // Same class of dangling reference, but against a deleted project — deleteProject() only
    // started cleaning these up itself once this heal was added; sweep up anything a save from
    // before that fix already left behind.
    this.db.exec('DELETE FROM requirement_allocations WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id NOT IN (SELECT id FROM projects))');
    this.db.exec('DELETE FROM requirements WHERE project_id NOT IN (SELECT id FROM projects)');
    this.db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id IN (SELECT id FROM person_assignments WHERE project_id NOT IN (SELECT id FROM projects))');
    this.db.exec('DELETE FROM person_assignments WHERE project_id NOT IN (SELECT id FROM projects)');
    // Defensive: catch any allocation left orphaned by a requirement/assignment already gone for
    // some other reason.
    this.db.exec('DELETE FROM requirement_allocations WHERE requirement_id NOT IN (SELECT id FROM requirements)');
    this.db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id NOT IN (SELECT id FROM person_assignments)');

    // v7 cinematics/LOQ tables — same defensive sweep, run parent-first so each statement also
    // catches anything newly orphaned by the one before it.
    this.db.exec('DELETE FROM cinematics WHERE project_id NOT IN (SELECT id FROM projects)');
    this.db.exec('DELETE FROM loqs WHERE cinematic_id NOT IN (SELECT id FROM cinematics)');
    // A LOQ is fundamentally typed by its discipline (unlike a pool/person, there's no sensible
    // "Unassigned" fallback), so a discipline-less LOQ is removed rather than nulled.
    this.db.exec('DELETE FROM loqs WHERE discipline_id NOT IN (SELECT id FROM disciplines)');
    this.db.exec('DELETE FROM loq_commitment_events WHERE loq_id NOT IN (SELECT id FROM loqs)');
    this.db.exec('DELETE FROM loq_resources WHERE loq_id NOT IN (SELECT id FROM loqs)');
    this.db.exec('DELETE FROM variance_events WHERE loq_id NOT IN (SELECT id FROM loqs)');
    this.db.exec('DELETE FROM jira_sync_state WHERE loq_id NOT IN (SELECT id FROM loqs)');
    this.db.exec('DELETE FROM loq_dependencies WHERE predecessor_loq_id NOT IN (SELECT id FROM loqs) OR successor_loq_id NOT IN (SELECT id FROM loqs)');
    // A gone person just drops the resource row — the LOQ itself survives.
    this.db.exec('DELETE FROM loq_resources WHERE person_id NOT IN (SELECT id FROM people)');
    this.db.exec('DELETE FROM dependency_templates WHERE predecessor_discipline_id NOT IN (SELECT id FROM disciplines) OR successor_discipline_id NOT IN (SELECT id FROM disciplines)');
    // template_id is ON DELETE SET NULL (an override without a template is still a valid,
    // independently-editable edge), unlike the deletes above.
    this.db.exec('UPDATE loq_dependencies SET template_id = NULL WHERE template_id IS NOT NULL AND template_id NOT IN (SELECT id FROM dependency_templates)');
  }

  /** Fresh DBs (from === null) never had the legacy tables — nothing to migrate. */
  private migrate(from: string | null): void {
    if (from === null) return;
    if (Number(from) < 2) this.migrateV1toV2();
    if (Number(from) < 4) this.migrateV3toV4();
    if (Number(from) < 5) this.migrateV4toV5();
    if (Number(from) < 6) this.migrateV5toV6();
    if (Number(from) < 8) this.migrateV7toV8();
    if (Number(from) < 9) this.migrateV8toV9();
    if (Number(from) < 10) this.migrateV9toV10();
  }

  /**
   * v1 had pool-level assignments only. v2 introduces people; each pool's assignment history
   * is preserved by synthesizing one person per pool that inherits its capacity and assignments,
   * so getCapacity/getAssignedCapacity return identical numbers pre/post migration.
   */
  private migrateV1toV2(): void {
    const hasLegacyAssignments = this.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'",
    ).length > 0;
    if (!hasLegacyAssignments) return;

    const poolColumns = this.query<{ name: string }>("PRAGMA table_info(resource_pools)");
    const hasDisciplineColumn = poolColumns.some((c) => c.name === 'discipline_id');
    if (!hasDisciplineColumn) {
      this.db.exec('ALTER TABLE resource_pools ADD COLUMN discipline_id TEXT REFERENCES disciplines(id)');
    }

    this.db.exec(`
      INSERT INTO people (id, name, pool_id, capacity_fte, active, sort_order)
      SELECT 'person_mig_' || rp.id, rp.name || ' (imported)', rp.id, rp.capacity_fte, 1, rp.sort_order
      FROM resource_pools rp
      WHERE rp.capacity_fte > 0 OR rp.id IN (SELECT DISTINCT pool_id FROM assignments);

      INSERT INTO person_assignments (id, person_id, project_id, scenario_id)
      SELECT a.id, 'person_mig_' || a.pool_id, a.project_id, a.scenario_id
      FROM assignments a;

      INSERT INTO person_assignment_allocations (person_assignment_id, period, fte)
      SELECT assignment_id, period, fte FROM assignment_allocations;

      DROP TABLE IF EXISTS assignment_allocations;
      DROP TABLE IF EXISTS assignments;
    `);
  }

  /** v4 adds Person.team (free-text) and Project.isDispo (bench/availability placeholder flag). */
  private migrateV3toV4(): void {
    const peopleColumns = this.query<{ name: string }>('PRAGMA table_info(people)');
    if (!peopleColumns.some((c) => c.name === 'team')) {
      this.db.exec("ALTER TABLE people ADD COLUMN team TEXT NOT NULL DEFAULT ''");
    }
    const projectColumns = this.query<{ name: string }>('PRAGMA table_info(projects)');
    if (!projectColumns.some((c) => c.name === 'is_dispo')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN is_dispo INTEGER NOT NULL DEFAULT 0');
    }
  }

  /** v5 adds Person.site (free-text studio/location, independent of the team field). */
  private migrateV4toV5(): void {
    const peopleColumns = this.query<{ name: string }>('PRAGMA table_info(people)');
    if (!peopleColumns.some((c) => c.name === 'site')) {
      this.db.exec("ALTER TABLE people ADD COLUMN site TEXT NOT NULL DEFAULT ''");
    }
  }

  /**
   * v6 moves needs to discipline-only granularity: for every (project, discipline) that has
   * specific-pool requirement allocations, sums them per period onto the discipline's generic
   * pool requirement (creating the generic pool/requirement if needed, same convention as
   * resolveGenericPoolId in useStore.ts), then deletes the specific-pool requirement rows
   * (allocations cascade). Assignments are untouched — they stay person→specific-pool. A project
   * with no specific-pool requirements is left alone.
   */
  private migrateV5toV6(): void {
    type PoolRow = { id: string; name: string; discipline_id: string | null };
    type ReqRow = { id: string; project_id: string; pool_id: string; scenario_id: string };
    type AllocRow = { requirement_id: string; period: string; fte: number };

    const pools = this.query<PoolRow>('SELECT id, name, discipline_id FROM resource_pools');
    const poolById = new Map(pools.map((p) => [p.id, p]));
    const disciplines = this.query<{ id: string; name: string; color: string }>('SELECT id, name, color FROM disciplines');
    const disciplineById = new Map(disciplines.map((d) => [d.id, d]));
    const genericPoolByDiscipline = new Map<string, string>();
    for (const p of pools) {
      if (p.discipline_id && isGenericPoolName(p.name)) genericPoolByDiscipline.set(p.discipline_id, p.id);
    }

    const requirements = this.query<ReqRow>('SELECT id, project_id, pool_id, scenario_id FROM requirements');
    const allocations = this.query<AllocRow>('SELECT requirement_id, period, fte FROM requirement_allocations');
    const allocationsByRequirement = new Map<string, AllocRow[]>();
    for (const a of allocations) {
      const arr = allocationsByRequirement.get(a.requirement_id) ?? [];
      arr.push(a);
      allocationsByRequirement.set(a.requirement_id, arr);
    }

    interface Group { projectId: string; disciplineId: string; scenarioId: string; reqIds: string[]; sums: Map<string, number> }
    const groups = new Map<string, Group>();
    for (const req of requirements) {
      const pool = poolById.get(req.pool_id);
      if (!pool || !pool.discipline_id || isGenericPoolName(pool.name)) continue;
      const key = `${req.project_id}|${pool.discipline_id}|${req.scenario_id}`;
      const group = groups.get(key) ?? { projectId: req.project_id, disciplineId: pool.discipline_id, scenarioId: req.scenario_id, reqIds: [], sums: new Map<string, number>() };
      group.reqIds.push(req.id);
      for (const a of allocationsByRequirement.get(req.id) ?? []) {
        if (a.fte <= 0.001) continue;
        group.sums.set(a.period, (group.sums.get(a.period) ?? 0) + a.fte);
      }
      groups.set(key, group);
    }
    if (groups.size === 0) return;

    let maxPoolOrder = this.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM resource_pools')[0]?.m ?? -1;

    for (const group of groups.values()) {
      const discipline = disciplineById.get(group.disciplineId);
      if (!discipline) continue;

      let genericPoolId = genericPoolByDiscipline.get(group.disciplineId);
      if (!genericPoolId) {
        genericPoolId = `pool_mig6_${group.disciplineId}`;
        maxPoolOrder += 1;
        this.exec(
          'INSERT INTO resource_pools (id, name, capacity_fte, color, sort_order, discipline_id) VALUES (?, ?, 0, ?, ?, ?)',
          [genericPoolId, genericPoolName(discipline.name), discipline.color, maxPoolOrder, group.disciplineId],
        );
        genericPoolByDiscipline.set(group.disciplineId, genericPoolId);
      }

      if (group.sums.size > 0) {
        const existingReq = this.query<{ id: string }>(
          'SELECT id FROM requirements WHERE project_id = ? AND pool_id = ? AND scenario_id = ?',
          [group.projectId, genericPoolId, group.scenarioId],
        )[0];
        let genericReqId = existingReq?.id;
        if (!genericReqId) {
          genericReqId = `req_mig6_${group.projectId}_${group.disciplineId}_${group.scenarioId}`;
          this.exec('INSERT INTO requirements (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)', [genericReqId, group.projectId, genericPoolId, group.scenarioId]);
        }
        const existingAllocs = this.query<{ period: string; fte: number }>(
          'SELECT period, fte FROM requirement_allocations WHERE requirement_id = ?',
          [genericReqId],
        );
        const existingByPeriod = new Map(existingAllocs.map((a) => [a.period, a.fte]));
        for (const [period, fte] of group.sums) {
          const total = (existingByPeriod.get(period) ?? 0) + fte;
          this.exec(
            `INSERT INTO requirement_allocations (requirement_id, period, fte) VALUES (?, ?, ?)
             ON CONFLICT(requirement_id, period) DO UPDATE SET fte = excluded.fte`,
            [genericReqId, period, total],
          );
        }
      }

      for (const reqId of group.reqIds) {
        this.exec('DELETE FROM requirements WHERE id = ?', [reqId]);
      }
    }
  }

  /**
   * v8 reshapes loq_resources into one row per assignment window: adds start_date/finish_date and
   * drops UNIQUE(loq_id, person_id) (a person may now have several disjoint windows on the same
   * LOQ). SQLite can't drop a constraint or add columns with a bare ALTER TABLE for this shape, so
   * this rebuilds the table — existing rows keep their id/loq_id/person_id/fte, with both new date
   * columns NULL (an unscheduled window, matching the "not yet scheduled" v8 convention, not a
   * guess at a window). Guarded on the column already existing so a fresh v8 DB (schemaSql already
   * created the new shape) or an already-migrated one is a no-op.
   */
  private migrateV7toV8(): void {
    const columns = this.query<{ name: string }>('PRAGMA table_info(loq_resources)');
    if (columns.some((c) => c.name === 'start_date')) return;

    this.db.exec(`
      CREATE TABLE loq_resources_new (
        id           TEXT PRIMARY KEY,
        loq_id       TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
        person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        start_date   TEXT,
        finish_date  TEXT,
        fte          REAL NOT NULL DEFAULT 1.0
      );
      INSERT INTO loq_resources_new (id, loq_id, person_id, start_date, finish_date, fte)
      SELECT id, loq_id, person_id, NULL, NULL, fte FROM loq_resources;
      DROP TABLE loq_resources;
      ALTER TABLE loq_resources_new RENAME TO loq_resources;
      CREATE INDEX IF NOT EXISTS idx_loq_resources_person ON loq_resources(person_id);
    `);
  }

  /**
   * v9 adds cinematics.jira_key — a plain column addition (unlike v8, no rebuild needed). Guarded
   * on the column already existing so a fresh v9 DB (schemaSql already created it) or an
   * already-migrated one is a no-op. The index on this column is created separately in
   * applySchema(), after migrate() returns — see the comment there.
   */
  private migrateV8toV9(): void {
    const columns = this.query<{ name: string }>('PRAGMA table_info(cinematics)');
    if (columns.some((c) => c.name === 'jira_key')) return;
    this.db.exec('ALTER TABLE cinematics ADD COLUMN jira_key TEXT;');
  }

  /**
   * v10 adds a manual, user-driven paused flag to cinematics and loqs (independent booleans —
   * pausing a Cinematic never cascades to its LOQs). Never written by Jira sync; see
   * checkJiraInconsistency's paused-signal comparison in validation.ts for how a Jira "paused-like"
   * status is surfaced instead of silently applied.
   */
  private migrateV9toV10(): void {
    const cinematicsColumns = this.query<{ name: string }>('PRAGMA table_info(cinematics)');
    if (!cinematicsColumns.some((c) => c.name === 'paused')) {
      this.db.exec('ALTER TABLE cinematics ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;');
    }
    const loqsColumns = this.query<{ name: string }>('PRAGMA table_info(loqs)');
    if (!loqsColumns.some((c) => c.name === 'paused')) {
      this.db.exec('ALTER TABLE loqs ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;');
    }
  }

  exec(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  /** Runs multiple param sets against the same statement — used for bulk allocation writes. */
  execMany(sql: string, paramSets: unknown[][]): void {
    const stmt = this.db.prepare(sql);
    try {
      for (const params of paramSets) {
        stmt.bind(params as never);
        stmt.step();
        stmt.reset();
      }
    } finally {
      stmt.free();
    }
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params as never);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  getSetting(key: string): string | null {
    const rows = this.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0]?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}
