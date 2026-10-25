import { defineHandler } from "nitro";
import { Effect } from "effect";
import { Routes } from "../../../src/routes.js";
import { respond } from "../../utils/respond.js";

export default defineHandler((event) => {
  const range = event.req.headers.get("range");
  const ifNoneMatch = event.req.headers.get("if-none-match");
  const ifModifiedSince = event.req.headers.get("if-modified-since");
  const encoded = event.context.params?._ ?? "";
  return respond(
    Routes.use((routes) =>
      routes.asset(encoded, { range, ifNoneMatch, ifModifiedSince })
    ).pipe(
      Effect.map((served) => {
        if ("redirect" in served) {
          return new Response(null, { status: 302, headers: { location: served.redirect } });
        }
        const status = served.status ?? 200;
        if (served.body === null) return new Response(null, { status, headers: served.headers });
        return new Response(served.body as BodyInit, { status, headers: served.headers });
      })
    )
  );
});
