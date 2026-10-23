import { defineHandler } from "nitro";
import { Effect } from "effect";
import { Routes } from "../../src/routes.js";
import { respond } from "../utils/respond.js";

export default defineHandler(() =>
  respond(
    Routes.use((routes) => routes.channels).pipe(Effect.map((data) => Response.json(data)))
  )
);
