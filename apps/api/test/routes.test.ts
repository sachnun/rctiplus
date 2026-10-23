import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AppLayer } from "../src/app-layer.js";
import { ProxyError } from "../src/errors.js";
import { Routes } from "../src/routes.js";

const PAGE = `var visitorsToken = "${"x".repeat(150)}";`;

const SCHEDULE_HTML = [
  `<a onclick="ok; clickCatchup( 'https://www.rctiplus.com/tv/rcti/328332/si-cantik?date=2026-07-29');return false;"` +
    ` href="https://www.rctiplus.com/tv/rcti/328332/si-cantik?date=2026-07-29">` +
    `<h2>Si Cantik</h2><br> <h4>00:15 - 01:30 </h4></a>`,
].join("\n");

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === "https://www.rctiplus.com/tv/rcti") {
      return new Response(PAGE + SCHEDULE_HTML);
    }
    if (url.startsWith("https://www.rctiplus.com/tv/")) return new Response(PAGE);
    if (url.includes("toutatis.rctiplus.com")) {
      return Response.json({ data: { url: "https://cdn.example/master.m3u8" } });
    }
    if (url.includes("cdn.example/master.m3u8")) {
      return new Response(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=223255,RESOLUTION=256x144",
          "lo.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720",
          "hi.m3u8",
        ].join("\n"),
        { headers: { "content-type": "application/vnd.apple.mpegurl" } }
      );
    }
    return new Response("#EXTM3U\n#EXT-X-VERSION:3\nseg-1.ts\n", {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetch;
});

const run = <A, E>(effect: Effect.Effect<A, E, Routes>) =>
  Effect.runPromise(Effect.provide(effect.pipe(Effect.provide(AppLayer)), AppLayer));

describe("routes", () => {
  test("serves the channel list without touching the network", async () => {
    const channels = await run(Routes.use((routes) => routes.channels));
    expect(channels).toEqual({ channels: ["rcti", "mnctv", "gtv", "inews"] });
    expect(calls).toHaveLength(0);
  });

  test("rejects unknown channels with a 404", async () => {
    const error = await Effect.runPromise(
      Effect.flip(Routes.use((routes) => routes.live("nope")).pipe(Effect.provide(AppLayer)))
    );
    expect(error).toBeInstanceOf(ProxyError);
    expect(error.status).toBe(404);
    expect(error.message).toContain("unknown channel");
  });

  test("rejects a non numeric replay epg id", async () => {
    const error = await Effect.runPromise(
      Effect.flip(Routes.use((routes) => routes.replay("abc")).pipe(Effect.provide(AppLayer)))
    );
    expect(error.status).toBe(404);
  });

  test("pins the best variant for a live master", async () => {
    const body = await run(Routes.use((routes) => routes.live("rcti", "best")));
    expect(body.status).toBeUndefined();
    expect(body.headers["Content-Type"]).toBe("application/vnd.apple.mpegurl");
    expect(String(body.body)).toContain("RESOLUTION=1280x720");
    expect(String(body.body)).not.toContain("RESOLUTION=256x144");
    expect(String(body.body)).toContain("/h/");
  });

  test("serves the schedule as JSON", async () => {
    const schedule = (await run(Routes.use((routes) => routes.schedule("rcti")))) as {
      items: ReadonlyArray<{ epg_id: number }>;
    };
    expect(schedule.items[0]?.epg_id).toBe(328332);
  });

  test("serves a day listing from the schedule fast path", async () => {
    const day = (await run(Routes.use((routes) => routes.historyDay("2026-07-29", "rcti")))) as {
      items: ReadonlyArray<{ playable: boolean }>;
    };
    expect(day.items.length).toBe(1);
    expect(day.items[0]?.playable).toBe(true);
  });

  test("rejects an invalid history date with a 400", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Routes.use((routes) => routes.historyDay("2026-7-29")).pipe(Effect.provide(AppLayer))
      )
    );
    expect(error.status).toBe(400);
  });

  test("rejects unknown channels on the schedule route", async () => {
    const error = await Effect.runPromise(
      Effect.flip(Routes.use((routes) => routes.schedule("nope")).pipe(Effect.provide(AppLayer)))
    );
    expect(error.status).toBe(404);
  });

  test("rewrites proxied assets through /h/", async () => {
    const asset = await run(
      Routes.use((routes) =>
        routes.asset("aHR0cHM6Ly9jZG4uZXhhbXBsZS9hL2luZGV4Lm0zdTg", {})
      )
    );
    expect("redirect" in asset).toBe(false);
    if ("redirect" in asset) return;
    expect(String(asset.body)).toContain("/h/");
  });
});
