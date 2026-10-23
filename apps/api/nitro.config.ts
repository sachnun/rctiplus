import { defineConfig } from "nitro";

export default defineConfig({
  preset:
    process.env.NITRO_PRESET ?? (process.env.NODE_ENV === "production" ? "cloudflare_module" : "node"),
  cloudflare: {
    wrangler: { name: process.env.CLOUDFLARE_WORKER_NAME ?? "rctiplus-api" },
  },
  serverDir: "./server",
  compatibilityDate: "2025-07-15",
  devServer: {
    hostname: "localhost",
    port: 3000,
  },
  routeRules: {
    "/**": {
      cors: true,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "*",
        "access-control-expose-headers": "*",
      },
    },
    "/": { redirect: { to: "/channels", status: 308 } },
    "/health": { headers: { "cache-control": "no-store" } },
  },
});
