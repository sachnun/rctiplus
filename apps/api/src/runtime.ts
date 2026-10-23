import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { AppLayer } from "./app-layer.js";
import { Routes } from "./routes.js";

type AppRuntime = ManagedRuntime.ManagedRuntime<Routes, Layer.Error<typeof AppLayer>>;

let runtime: AppRuntime | undefined;

/** Lazily build the Effect runtime shared by every request. */
export function getRuntime(): AppRuntime {
  runtime ??= ManagedRuntime.make(AppLayer, { memoMap: Layer.makeMemoMapUnsafe() });
  return runtime;
}

/** Run a route effect, rejecting with the typed error on failure. */
export function runRoute<A, E>(effect: Effect.Effect<A, E, Routes>): Promise<A> {
  return getRuntime().runPromise(effect);
}

/** Run a route effect and report the exit for error mapping at the edge. */
export function runRouteExit<A, E>(effect: Effect.Effect<A, E, Routes>): Promise<Exit.Exit<A, E>> {
  return getRuntime().runPromiseExit(effect);
}

export async function disposeRuntime(): Promise<void> {
  const current = runtime;
  runtime = undefined;
  if (current) await current.dispose();
}
