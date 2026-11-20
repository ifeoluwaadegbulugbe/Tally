// Tiny data hook over Forge resolvers (blueprint H1): loading, error, data, refetch.
import { invoke } from '@forge/bridge';
import { useCallback, useEffect, useState } from 'react';
import type { Result } from '../../../src/core/types';

/** One-off resolver call for actions (save, seed, reset). Never throws. */
export async function callResolver<T>(name: string, payload: Record<string, unknown> = {}): Promise<Result<T>> {
  try {
    const res = (await invoke<Result<T>>(name, payload)) as Result<T> | undefined;
    return res ?? { ok: false, code: 'internal', message: 'No response.' };
  } catch (e) {
    return { ok: false, code: 'internal', message: e instanceof Error ? e.message : String(e) };
  }
}

export interface ResolverState<T> {
  data: T | null;
  error: { code: string; message: string; call: string } | null;
  loading: boolean;
  refetch: () => void;
}

export function useResolver<T>(name: string, payload?: Record<string, unknown>): ResolverState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ResolverState<T>['error']>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(payload ?? {});

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    invoke<Result<T>>(name, payload ?? {})
      .then((raw) => {
        if (!live) return;
        // Our resolvers never return invoke metadata, so the body is the envelope itself.
        const res = raw as Result<T> | undefined;
        if (!res) setError({ code: 'internal', message: 'No response.', call: name });
        else if (res.ok) setData(res.data);
        else setError({ code: res.code, message: res.message, call: name });
      })
      .catch((e: unknown) => {
        if (live) setError({ code: 'internal', message: e instanceof Error ? e.message : String(e), call: name });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refetch };
}
