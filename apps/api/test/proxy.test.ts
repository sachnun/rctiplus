import { describe, expect, test } from "bun:test";
import { CONFIG } from "../src/config.js";
import { channelId, playerChannels, qualityFilter } from "../src/routes.js";
import { b64, filterMaster, isNotModified, parseRange, unb64 } from "../src/hls.js";
import { decodeEntities, parseSchedule } from "../src/schedule.js";

describe("b64", () => {
  test("round-trips URLs with special characters", () => {
    const url = "https://cdn.example/v/a.m3u8?hdntl=exp=1~acl=%2F*~hmac=xyz";
    expect(unb64(b64(url))).toBe(url);
  });
});

describe("filterMaster", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-STREAM-INF:BANDWIDTH=223255,RESOLUTION=256x144",
    "a-144.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720",
    "a-720.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=806255,RESOLUTION=854x480",
    "a-480.m3u8",
  ].join("\n");

  test("pins the highest variant for mode best", () => {
    const out = filterMaster(master, { mode: "best" }).split("\n");
    expect(out).toHaveLength(4);
    expect(out[2]).toContain("RESOLUTION=1280x720");
    expect(out[3]).toBe("a-720.m3u8");
  });

  test("picks the highest variant at or below the requested height", () => {
    const out = filterMaster(master, { mode: "max-height", height: 480 }).split("\n");
    expect(out[2]).toContain("RESOLUTION=854x480");
    expect(out[3]).toBe("a-480.m3u8");
  });

  test("leaves a variant-less playlist untouched", () => {
    const plain = "#EXTM3U\n#EXT-X-VERSION:3\nsomething.ts\n";
    expect(filterMaster(plain, { mode: "best" })).toBe(plain);
  });
});

describe("parseRange", () => {
  test("parses closed, open and suffix ranges", () => {
    expect(parseRange("bytes=2-5", 8)).toEqual([2, 5]);
    expect(parseRange("bytes=3-", 8)).toEqual([3, 7]);
    expect(parseRange("bytes=-3", 8)).toEqual([5, 7]);
  });

  test("rejects malformed and unsatisfiable ranges", () => {
    expect(parseRange("bytes=9-10", 8)).toBeNull();
    expect(parseRange("items=0-1", 8)).toBeNull();
    expect(parseRange("bytes=0-1", 0)).toBeNull();
  });
});

describe("isNotModified", () => {
  test("matches an If-None-Match ETag", () => {
    expect(isNotModified({ ifNoneMatch: 'W/"aa"' }, { etag: 'W/"aa"' })).toBe(true);
    expect(isNotModified({ ifNoneMatch: 'W/"bb"' }, { etag: 'W/"aa"' })).toBe(false);
  });

  test("falls back to If-Modified-Since", () => {
    const lastModified = "Wed, 05 Aug 2026 04:36:30 GMT";
    expect(isNotModified({ ifModifiedSince: lastModified }, { lastModified })).toBe(true);
    expect(isNotModified({ ifModifiedSince: "Wed, 05 Aug 2026 04:36:29 GMT" }, { lastModified })).toBe(
      false
    );
  });
});

describe("qualityFilter", () => {
  test("maps query values onto variant filters", () => {
    expect(qualityFilter("best")).toEqual({ mode: "best" });
    expect(qualityFilter("480")).toEqual({ mode: "max-height", height: 480 });
    expect(qualityFilter("auto")).toBeUndefined();
    expect(qualityFilter(undefined)).toBeUndefined();
  });
});

describe("channels", () => {
  test("lists each channel once, in declaration order", () => {
    expect(playerChannels()).toEqual(["rcti", "mnctv", "gtv", "inews"]);
  });

  test("resolves slugs case-insensitively", () => {
    expect(channelId("RCTI")).toBe(1);
    expect(channelId("globaltv")).toBe(3);
    expect(channelId("nope")).toBeUndefined();
  });
});

describe("schedule parsing", () => {
  const entry = (channel: string, id: number, slug: string, title: string) => {
    const date = "2026-07-29";
    return (
      `<a onclick="ok; clickCatchup( 'https://www.rctiplus.com/tv/${channel}/${id}/${slug}?date=${date}');return false;"` +
      ` href="https://www.rctiplus.com/tv/${channel}/${id}/${slug}?date=${date}">` +
      `<h2>${title}</h2><br> <h4>00:15 - 01:30 </h4></a>`
    );
  };

  test("parses catch-up entries into schedule items", () => {
    const html = entry("rcti", 328332, "si-cantik", "Si Cantik");
    expect(parseSchedule(html, "rcti")[0]).toEqual({
      epg_id: 328332,
      slug: "si-cantik",
      date: "2026-07-29",
      title: "Si Cantik",
      start: "00:15",
      end: "01:30",
      url: "/replay/328332.m3u8",
      permalink: "https://www.rctiplus.com/tv/rcti/328332/si-cantik?date=2026-07-29",
    });
  });

  test("filters out entries from other channels", () => {
    const html = [
      entry("rcti", 1, "a-b", "RCTI Show"),
      entry("mnctv", 2, "c-d", "MNCTV Show"),
    ].join("\n");
    expect(parseSchedule(html, "rcti").map((item) => item.epg_id)).toEqual([1]);
  });

  test("decodes HTML entities in titles", () => {
    expect(decodeEntities("Berita &amp; Info")).toBe("Berita & Info");
    expect(decodeEntities("Kuis &#39;Ajaib&#39;")).toBe("Kuis 'Ajaib'");
  });
});

describe("config", () => {
  test("carries the RCTI+ contract", () => {
    expect(CONFIG.apiBase).toBe("https://toutatis.rctiplus.com/video/live/api/v1");
    expect(CONFIG.referer).toBe("https://www.rctiplus.com/");
    expect(CONFIG.ttl.live).toBeGreaterThan(0);
  });
});
