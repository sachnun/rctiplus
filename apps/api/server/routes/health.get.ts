import { defineHandler } from "nitro";
export default defineHandler(() => Response.json({ status: "ok" }));
