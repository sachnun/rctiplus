import { createApiClient } from "~/utils/api";
import { resolveApiBase } from "~/utils/format";

export function useApi() {
  const config = useRuntimeConfig();
  const base = resolveApiBase(config.public.apiBase);
  return createApiClient(base);
}
