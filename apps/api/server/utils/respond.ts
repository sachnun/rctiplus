import { Cause, Effect, Exit, Option } from "effect";
import { ProxyError } from "../../src/errors.js";
import type { ProxiedBody } from "../../src/hls.js";
import { runRouteExit } from "../../src/runtime.js";
import type { Routes } from "../../src/routes.js";

function toBody(body: Exclude<ProxiedBody["body"], null>): BodyInit {
  if (body instanceof Uint8Array) {
    return new Blob([new Uint8Array(body)]).stream();
  }
  return body;
}

export function proxiedResponse(proxied: ProxiedBody): Response {
  const init: ResponseInit = { status: proxied.status ?? 200, headers: proxied.headers };
  if (proxied.body === null) return new Response(null, init);
  return new Response(toBody(proxied.body), init);
}

export function playlist(
  effect: Effect.Effect<ProxiedBody, ProxyError, Routes>
): Effect.Effect<Response, ProxyError, Routes> {
  return effect.pipe(Effect.map(proxiedResponse));
}

export async function respond(
  effect: Effect.Effect<Response, ProxyError, Routes>
): Promise<Response> {
  const exit = await runRouteExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    return new Response(`proxy error: ${failure.value.message}`, {
      status: failure.value.status,
    });
  }
  console.error("[api] unhandled route failure", Cause.squash(exit.cause));
  return new Response("proxy error: internal error", { status: 500 });
}
