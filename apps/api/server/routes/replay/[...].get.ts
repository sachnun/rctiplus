import { defineHandler } from "nitro";
import { Routes } from "../../../src/routes.js";
import { playlist, respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const rest = event.context.params?._ ?? "";
  const epgId = rest.replace(/\.m3u8$/i, "");
  const quality = event.url.searchParams.get("quality") ?? undefined;
  return respond(Routes.use((routes) => playlist(routes.replay(epgId, quality))));
});
