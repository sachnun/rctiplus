import { defineHandler } from "nitro";
import { Routes } from "../../../src/routes.js";
import { playlist, respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const channel = (event.context.params?.channel ?? "").replace(/\.m3u8$/i, "");
  return respond(
    Routes.use((routes) => playlist(routes.days(channel === "" ? undefined : channel)))
  );
});
