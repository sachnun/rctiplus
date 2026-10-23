import { defineHandler } from "nitro";
import { Effect } from "effect";
import { Routes } from "../../../src/routes.js";
import { respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const before = event.url.searchParams.get("before");
  if (!before) return new Response("missing before=YYYY-MM-DD", { status: 400 });
  const channel = event.url.searchParams.get("channel") ?? undefined;
  return respond(
    Routes.use((routes) => routes.historyPrev(before, channel)).pipe(
      Effect.map((data) => Response.json(data, { headers: { "cache-control": "no-store" } }))
    )
  );
});
