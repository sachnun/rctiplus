import { describe, expect, test } from "bun:test";
import { createApiClient } from "../app/utils/api";
import { shouldRestartOnPlay } from "../app/utils/player";
import {
  addDays,
  formatDate,
  normalizeTitle,
  resolveApiBase,
  titleSimilarity,
} from "../app/utils/format";

describe("resolveApiBase", () => {
  test("trims a configured base URL", () => {
    expect(resolveApiBase("https://api.example.com/")).toBe("https://api.example.com");
  });

  test("ignores blank configuration", () => {
    expect(resolveApiBase("   ")).toBe("");
    expect(resolveApiBase(undefined)).toBe("");
  });
});

describe("createApiClient", () => {
  const api = createApiClient("https://api.example.com/");

  test("builds live stream URLs", () => {
    expect(api.streamUrl("rcti")).toBe("https://api.example.com/rcti.m3u8");
  });

  test("builds replay URLs", () => {
    expect(api.replayUrl(328332)).toBe("https://api.example.com/replay/328332.m3u8");
  });

  test("encodes JSON API query parameters", () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ channel: "rcti", items: [] });
    }) as typeof fetch;

    void api.schedule("rcti");
    void api.historyPrev("2026-07-29", "mnctv");
    expect(urls).toEqual([
      "https://api.example.com/schedule?channel=rcti",
      "https://api.example.com/history/prev?before=2026-07-29&channel=mnctv",
    ]);
  });
});

describe("formatDate", () => {
  const now = new Date();
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  test("labels near dates relatively", () => {
    expect(formatDate(iso(now))).toBe("Today");
    expect(formatDate(addDays(iso(now), -1))).toBe("Yesterday");
    expect(formatDate(addDays(iso(now), 1))).toBe("Tomorrow");
  });

  test("returns the input when unparseable", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("addDays", () => {
  test("crosses month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("titleSimilarity", () => {
  test("scores identical titles as 1", () => {
    expect(titleSimilarity("Si Cantik Dari Masa Lalu", "Si Cantik Dari Masa Lalu")).toBe(1);
  });

  test("is tolerant of episode suffixes", () => {
    const score = titleSimilarity("Si Cantik Dari Masa Lalu", "Si Cantik Dari Masa Lalu Episode 12");
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });

  test("normalizes punctuation and case", () => {
    expect(normalizeTitle("Kuis 'Ajaib'!")).toBe("kuis ajaib");
  });
});

describe("shouldRestartOnPlay", () => {
  test("keeps an attached player running", () => {
    expect(shouldRestartOnPlay({ attached: true, now: 1_000, lastRestartAt: 0 })).toBe(false);
  });

  test("restarts a detached player once the guard window passed", () => {
    expect(shouldRestartOnPlay({ attached: false, now: 5_000, lastRestartAt: 0 })).toBe(true);
  });

  test("ignores a restart request inside the guard window", () => {
    expect(shouldRestartOnPlay({ attached: false, now: 1_500, lastRestartAt: 1_000 })).toBe(false);
  });
});
