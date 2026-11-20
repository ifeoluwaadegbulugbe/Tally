// Forge KVS adapter for the KV port. Only this file imports @forge/kvs.
import { kvs, WhereConditions } from '@forge/kvs';
import { BATCH_SIZE, chunk, PAGE_SIZE } from './kv';
import type { KV } from './kv';

function assertBatch(result: { failedKeys: Array<{ key: string; error: { code: string } }> }, op: string) {
  if (result.failedKeys.length > 0) {
    const first = result.failedKeys[0]!;
    throw new Error(`KVS ${op} failed for ${result.failedKeys.length} key(s), first ${first.key}: ${first.error.code}`);
  }
}

export const forgeKv: KV = {
  get: <T>(key: string) => kvs.get<T>(key),
  set: <T>(key: string, value: T) => kvs.set(key, value),
  delete: (key: string) => kvs.delete(key),

  async list<T>(prefix: string) {
    const out: Array<{ key: string; value: T }> = [];
    let cursor: string | undefined;
    do {
      let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(PAGE_SIZE);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany<T>();
      for (const r of page.results) out.push({ key: r.key, value: r.value });
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  },

  async setMany<T>(items: Array<{ key: string; value: T }>) {
    for (const part of chunk(items, BATCH_SIZE)) {
      assertBatch(await kvs.batchSet(part.map((i) => ({ key: i.key, value: i.value }))), 'batchSet');
    }
  },

  async deleteMany(keys: string[]) {
    for (const part of chunk(keys, BATCH_SIZE)) {
      assertBatch(await kvs.batchDelete(part.map((key) => ({ key }))), 'batchDelete');
    }
  },
};
