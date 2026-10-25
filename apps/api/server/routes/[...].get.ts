import { defineHandler } from "nitro";
export default defineHandler((event) => {
  const pathname = event.url.pathname;
  if (pathname === "/" || pathname === "") {
    return Response.redirect(new URL("/playlist.m3u8", event.url.origin).toString(), 308);
  }
  if (pathname === "/live" || pathname === "/live/") {
    return new Response("usage: /live/{rcti|mnctv|gtv|inews}.m3u8", { status: 404 });
  }
  return new Response(`unknown route: ${pathname}`, { status: 404 });
});
