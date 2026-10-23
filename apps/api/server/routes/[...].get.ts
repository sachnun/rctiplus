import { defineHandler } from "nitro";
export default defineHandler((event) => {
  const pathname = event.url.pathname;
  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return new Response("unknown endpoint", { status: 404 });
  }
  return new Response(`unknown route: ${pathname}`, { status: 404 });
});
