// Routing synced with the Jira URL via the Forge bridge (view.createHistory), so routes
// like /commitments/c-nw-ehr are deep-linkable and back/forward work. If the bridge
// history is unavailable (local preview), an in-memory history is used instead (V7).
import { view } from '@forge/bridge';
import { useEffect, useState } from 'react';

interface MiniHistory {
  location: { pathname: string; search?: string };
  push(path: string): void;
  listen(cb: (arg: unknown) => void): () => void;
}

function memoryHistory(): MiniHistory {
  const listeners = new Set<(arg: unknown) => void>();
  const h: MiniHistory = {
    location: { pathname: '/' },
    push(path) {
      const [pathname, search] = path.split('?');
      h.location = { pathname: pathname || '/', search: search ? `?${search}` : '' };
      listeners.forEach((l) => l(h.location));
    },
    listen(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return h;
}

let historyPromise: Promise<MiniHistory> | null = null;
function getHistory(): Promise<MiniHistory> {
  historyPromise ??= view
    .createHistory()
    .then((h) => h as unknown as MiniHistory)
    .catch(() => memoryHistory());
  return historyPromise;
}

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function toRoute(loc: { pathname: string; search?: string }): Route {
  const path = loc.pathname || '/';
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(loc.search ?? '') };
}

export function useRoute(): Route | null {
  const [route, setRoute] = useState<Route | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getHistory().then((h) => {
      setRoute(toRoute(h.location));
      // history v4 passes (location, action); v5 passes ({ location, action }).
      unlisten = h.listen((arg) => {
        const a = arg as { location?: { pathname: string; search?: string }; pathname?: string; search?: string };
        setRoute(toRoute(a.location ?? (a as { pathname: string; search?: string })));
      });
    });
    return () => unlisten?.();
  }, []);
  return route;
}

export function navigate(path: string): void {
  getHistory().then((h) => h.push(path));
}
