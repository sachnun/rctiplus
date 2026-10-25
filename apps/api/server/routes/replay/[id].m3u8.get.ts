import { defineHandler } from "nitro";
import { Routes } from "../../../src/routes.js";
import { playlist, respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const epgId = (event.context.params?.id ?? "").replace(/\.m3u8$/i, "");
  const quality = event.url.searchParams.get("quality") ?? undefined;
  return respond(Routes.use((routes) => playlist(routes.replay(epgId, quality))));
});
