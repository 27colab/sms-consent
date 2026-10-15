import type { ConsentRecord, ConsentStatus, ConsentStore } from './consent.js';

/** Structural subset of a prepared statement, satisfied by better-sqlite3 and node:sqlite. */
export interface SqliteStatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}

/** Structural subset of a synchronous SQLite handle (better-sqlite3 `Database`, `node:sqlite` `DatabaseSync`). */
export interface SqliteDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatementLike;
}

interface Row {
  account_id: string;
  phone: string;
  status: ConsentStatus;
  updated_at: string;
  source: string | null;
}

const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * SQLite-backed ConsentStore. Creates its table on construction.
 * Rows are never deleted: consent history is evidence. Each change is also
 * appended to `<table>_events`.
 */
export class SqliteConsentStore implements ConsentStore {
  private readonly table: string;

  constructor(
    private readonly db: SqliteDatabaseLike,
    table = 'sms_consent',
  ) {
    if (!TABLE_NAME.test(table)) throw new Error(`Invalid table name: ${table}`);
    this.table = table;
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        account_id TEXT NOT NULL,
        phone TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('none','pending','opted_in','opted_out')),
        updated_at TEXT NOT NULL,
        source TEXT,
        PRIMARY KEY (account_id, phone)
      );
      CREATE TABLE IF NOT EXISTS ${table}_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        phone TEXT NOT NULL,
        status TEXT NOT NULL,
        at TEXT NOT NULL,
        source TEXT
      );
    `);
  }

  async get(accountId: string, phone: string): Promise<ConsentRecord | null> {
    const row = this.db
      .prepare(`SELECT account_id, phone, status, updated_at, source FROM ${this.table} WHERE account_id = ? AND phone = ?`)
      .get(accountId, phone) as Row | undefined;
    if (!row) return null;
    return {
      accountId: row.account_id,
      phone: row.phone,
      status: row.status,
      updatedAt: row.updated_at,
      ...(row.source ? { source: row.source } : {}),
    };
  }

  async put(r: ConsentRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (account_id, phone, status, updated_at, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account_id, phone) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, source = excluded.source`,
      )
      .run(r.accountId, r.phone, r.status, r.updatedAt, r.source ?? null);
    this.db
      .prepare(`INSERT INTO ${this.table}_events (account_id, phone, status, at, source) VALUES (?, ?, ?, ?, ?)`)
      .run(r.accountId, r.phone, r.status, r.updatedAt, r.source ?? null);
  }
}
