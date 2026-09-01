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

export const SCHEMA_VERSION = '1';

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
    this.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['schema_version', SCHEMA_VERSION],
    );
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
