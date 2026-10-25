import { defineHandler } from "nitro";
import { Routes } from "../../../../src/routes.js";
import { playlist, respond } from "../../../utils/respond.js";

export default defineHandler((event) => {
  const date = event.context.params?.date ?? "";
  const channel = (event.context.params?.channel ?? "").replace(/\.m3u8$/i, "");
  return respond(
    Routes.use((routes) => playlist(routes.day(date, channel === "" ? undefined : channel)))
  );
});
