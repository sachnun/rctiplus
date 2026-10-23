import { Clock, Context, Effect, Layer, Ref } from "effect";
import { CONFIG } from "./config.js";

/**
 * Anonymous visitor JWT manager.
 *
 * Every JSON API call must carry `Authorization: <visitor JWT>` plus the
 * `apikey` header. The web app embeds a fresh token in every page render
 * (`var visitorsToken = "..."`); the manager re-extracts it periodically and
 * falls back to the baked token when extraction fails.
 */
export class TokenManager extends Context.Service<
  TokenManager,
  {
    get(): Effect.Effect<string>;
    headers(): Effect.Effect<Record<string, string>>;
  }
>()("rctiplus/TokenManager") {
  static readonly layer = Layer.effect(
    TokenManager,
    Effect.gen(function* () {
      const state = yield* Ref.make({ token: CONFIG.fallbackToken, at: 0 });

      const refresh = Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const now = yield* Clock.currentTimeMillis;
        if (now - current.at < CONFIG.ttl.token) return current.token;

        const html = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${CONFIG.siteBase}/tv/rcti`, {
              headers: { "User-Agent": CONFIG.userAgent },
              signal: AbortSignal.timeout(CONFIG.timeouts.token),
            });
            return res.text();
          },
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => ""));

        const fresh = html.match(/visitorsToken\s*=\s*"([^"]+)"/)?.[1];
        if (!fresh || fresh.length <= 100) return current.token;

        yield* Ref.set(state, { token: fresh, at: now });
        return fresh;
      });

      const headers = Effect.gen(function* () {
        const token = yield* refresh;
        return {
          Authorization: token,
          apikey: CONFIG.apiKey,
          Origin: CONFIG.origin,
          Referer: CONFIG.referer,
          "User-Agent": CONFIG.userAgent,
        };
      });

      return TokenManager.of({ get: () => refresh, headers: () => headers });
    })
  );
}
