import { defineHandler } from "nitro";
import { Routes } from "../../src/routes.js";
import { playlist, respond } from "../utils/respond.js";

export default defineHandler((event) => {
  const quality = event.url.searchParams.get("quality") ?? undefined;
  const origin = event.url.origin;
  return respond(Routes.use((routes) => playlist(routes.catalog(quality, origin))));
});
