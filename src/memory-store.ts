import type { ConsentRecord, ConsentStore } from './consent.js';

/** In-memory ConsentStore for tests and prototypes. State is lost on restart. */
export class MemoryConsentStore implements ConsentStore {
  private readonly records = new Map<string, ConsentRecord>();

  async get(accountId: string, phone: string): Promise<ConsentRecord | null> {
    const r = this.records.get(key(accountId, phone));
    return r ? { ...r } : null;
  }

  async put(record: ConsentRecord): Promise<void> {
    this.records.set(key(record.accountId, record.phone), { ...record });
  }

  get size(): number {
    return this.records.size;
  }
}

function key(accountId: string, phone: string): string {
  return `${accountId}\u0000${phone}`;
}
