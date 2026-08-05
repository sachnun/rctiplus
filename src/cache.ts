/**
 * Minimal TTL cache shared across the proxy services.
 *
 * Entries are `{ value, at }`; reads expire once `Date.now() - at` exceeds the
 * caller-supplied TTL.  Keys are plain strings (`live:1`, `epg:328332`,
 * `schedule:rcti`, ...).
 */

export interface Cache {
  /** Return the cached value if it is newer than `ttlMs`, else undefined. */
  get<T>(key: string, ttlMs: number): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

interface CacheEntry {
  value: unknown;
  at: number;
}

export function createCache(): Cache {
  const store = new Map<string, CacheEntry>();

  return {
    get<T>(key: string, ttlMs: number): T | undefined {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
      return undefined;
    },

    set(key: string, value: unknown): void {
      store.set(key, { value, at: Date.now() });
    },

    delete(key: string): void {
      store.delete(key);
    },
  };
}
