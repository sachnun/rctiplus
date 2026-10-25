import { Clock, Context, Effect, Layer, Ref } from "effect";

export type CacheEntry = { readonly value: unknown; readonly at: number };

export class Cache extends Context.Service<
  Cache,
  {
    get<T>(key: string, ttlMs: number): Effect.Effect<T | undefined>;
    set(key: string, value: unknown): Effect.Effect<void>;
    delete(key: string): Effect.Effect<void>;
  }
>()("rctiplus/Cache") {
  static readonly layer = Layer.effect(
    Cache,
    Effect.gen(function* () {
      const store = yield* Ref.make(new Map<string, CacheEntry>());

      const get = Effect.fnUntraced(function* <T>(key: string, ttlMs: number) {
        const now = yield* Clock.currentTimeMillis;
        const entries = yield* Ref.get(store);
        const hit = entries.get(key);
        if (!hit) return undefined;
        if (now - hit.at >= ttlMs) return undefined;
        return hit.value as T;
      });

      const set = Effect.fnUntraced(function* (key: string, value: unknown) {
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(store, (entries) => new Map(entries).set(key, { value, at: now }));
      });

      const remove = Effect.fnUntraced(function* (key: string) {
        yield* Ref.update(store, (entries) => {
          const next = new Map(entries);
          next.delete(key);
          return next;
        });
      });

      return Cache.of({ get, set, delete: remove });
    })
  );
}
