import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MemoryConsentStore, SqliteConsentStore, applyConsentEvent, type ConsentStore } from '../src/index.js';

const P = '+15550001111';

function contract(name: string, make: () => ConsentStore) {
  describe(`${name} ConsentStore contract`, () => {
    it('returns null for unknown keys', async () => {
      expect(await make().get('a', P)).toBeNull();
    });
    it('round-trips and upserts', async () => {
      const s = make();
      await s.put({ accountId: 'a', phone: P, status: 'pending', updatedAt: '2030-01-01T00:00:00.000Z' });
      await s.put({ accountId: 'a', phone: P, status: 'opted_in', updatedAt: '2030-01-02T00:00:00.000Z', source: 'web' });
      expect(await s.get('a', P)).toEqual({ accountId: 'a', phone: P, status: 'opted_in', updatedAt: '2030-01-02T00:00:00.000Z', source: 'web' });
    });
    it('isolates accounts and phones', async () => {
      const s = make();
      await s.put({ accountId: 'a', phone: P, status: 'opted_out', updatedAt: '2030-01-01T00:00:00.000Z' });
      expect(await s.get('b', P)).toBeNull();
      expect(await s.get('a', '+15550002222')).toBeNull();
    });
    it('works with the state machine', async () => {
      const s = make();
      await applyConsentEvent(s, 'a', P, { type: 'grant' });
      await applyConsentEvent(s, 'a', P, { type: 'stop' });
      expect((await s.get('a', P))?.status).toBe('opted_out');
    });
  });
}

contract('Memory', () => new MemoryConsentStore());
contract('SQLite', () => new SqliteConsentStore(new Database(':memory:')));

describe('SqliteConsentStore specifics', () => {
  it('keeps an append-only event log', async () => {
    const db = new Database(':memory:');
    const s = new SqliteConsentStore(db);
    await applyConsentEvent(s, 'a', P, { type: 'grant', source: 'web' });
    await applyConsentEvent(s, 'a', P, { type: 'stop', source: 'inbound:STOP' });
    const rows = db.prepare('SELECT status, source FROM sms_consent_events ORDER BY id').all();
    expect(rows).toEqual([
      { status: 'opted_in', source: 'web' },
      { status: 'opted_out', source: 'inbound:STOP' },
    ]);
  });

  it('supports a custom table and rejects unsafe names', async () => {
    const db = new Database(':memory:');
    const s = new SqliteConsentStore(db, 'my_consents');
    await s.put({ accountId: 'a', phone: P, status: 'pending', updatedAt: 'x' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM my_consents').get()).toEqual({ n: 1 });
    expect(() => new SqliteConsentStore(db, 'x; DROP TABLE y')).toThrow(/Invalid table/);
  });

  it('enforces valid statuses at the database level', () => {
    const db = new Database(':memory:');
    new SqliteConsentStore(db);
    expect(() => db.prepare("INSERT INTO sms_consent VALUES ('a','p','bogus','t',NULL)").run()).toThrow();
  });
});
