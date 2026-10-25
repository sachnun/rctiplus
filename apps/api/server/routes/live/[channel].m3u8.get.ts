import { defineHandler } from "nitro";
import { Routes } from "../../../src/routes.js";
import { playlist, respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const channel = event.context.params?.channel ?? "";
  const quality = event.url.searchParams.get("quality") ?? undefined;
  return respond(Routes.use((routes) => playlist(routes.live(channel, quality))));
});
