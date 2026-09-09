import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import schemaSql from './schema.sql?raw';

let sqlJsModule: SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs({
      locateFile: (file: string) => `${import.meta.env.BASE_URL}${file}`,
    });
  }
  return sqlJsModule;
}

export const SCHEMA_VERSION = '5';

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
    this.setSetting('schema_version', SCHEMA_VERSION);
  }

  /** Fresh DBs (from === null) never had the legacy tables — nothing to migrate. */
  private migrate(from: string | null): void {
    if (from === null) return;
    if (Number(from) < 2) this.migrateV1toV2();
    if (Number(from) < 4) this.migrateV3toV4();
    if (Number(from) < 5) this.migrateV4toV5();
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
