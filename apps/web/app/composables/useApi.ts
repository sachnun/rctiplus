import { createApiClient } from "~/utils/api";
import { resolveApiBase } from "~/utils/format";

/** Shared, typed client for the proxy API, configured at runtime. */
export function useApi() {
  const config = useRuntimeConfig();
  const base = resolveApiBase(config.public.apiBase);
  return createApiClient(base);
}
