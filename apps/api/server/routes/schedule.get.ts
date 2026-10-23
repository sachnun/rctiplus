import { defineHandler } from "nitro";
import { Effect } from "effect";
import { Routes } from "../../src/routes.js";
import { respond } from "../utils/respond.js";

export default defineHandler((event) => {
  const channel = event.url.searchParams.get("channel") ?? "rcti";
  return respond(
    Routes.use((routes) => routes.schedule(channel)).pipe(
      Effect.map((data) => Response.json(data, { headers: { "cache-control": "no-store" } }))
    )
  );
});
