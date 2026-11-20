// Minimal key-value port. Production uses Forge KVS (@forge/kvs); tests use MemoryKv.
// Keeping the port small means the repository logic is testable without Forge.

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every entry whose key starts with `prefix`, in key order. */
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
  setMany<T>(items: Array<{ key: string; value: T }>): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

// Page and batch sizes kept small on purpose: the SDK does not state its limits
// (VERIFY V5 against the KVS docs before raising them).
export const PAGE_SIZE = 20;
export const BATCH_SIZE = 20;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** In-memory KV with the same prefix and ordering behaviour, for tests and local scripts. */
export class MemoryKv implements KV {
  readonly data = new Map<string, unknown>();

  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list<T>(prefix: string) {
    return [...this.data.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort()
      .map((key) => ({ key, value: structuredClone(this.data.get(key)) as T }));
  }
  async setMany<T>(items: Array<{ key: string; value: T }>) {
    for (const i of items) await this.set(i.key, i.value);
  }
  async deleteMany(keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}
