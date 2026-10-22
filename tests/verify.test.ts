import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeedItem } from "../src/collect/rss.js";
import { Dropped, extractArticle } from "../src/extract/article.js";
import { canonicalUrl, cluster, titleSimilarity } from "../src/verify/dedupe.js";
import { quoteInText, verifyClaims } from "../src/verify/quotes.js";
import { assertApproved } from "../src/verify/sources.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const URL_ = "https://news.example.test/2026/widget-patch?utm_source=x";

describe("extraction (V2, V8)", () => {
  it("reads the date from article:published_time, the canonical URL and the text", () => {
    const a = extractArticle(fixture("meta-date.html"), URL_);
    expect(a.published).toBe("2026-10-21T09:30:00.000Z");
    expect(a.canonical).toBe("https://news.example.test/2026/widget-patch");
    expect(a.lang).toBe("en");
    expect(a.text).toContain("1,200 servers were exposed");
    expect(a.text).not.toContain("Home | Security");
    expect(a.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.paywall).toBe(false);
  });

  it("finds datePublished inside a JSON-LD @graph", () => {
    expect(extractArticle(fixture("jsonld-date.html"), "https://lab.example.test/x").published).toBe("2026-10-20T14:00:00.000Z");
  });

  it("returns no date when the page states none (the run drops it as no_date)", () => {
    expect(extractArticle(fixture("no-date.html"), "https://blog.example.test/x").published).toBeNull();
  });

  it("flags a page with too little text as paywall", () => {
    expect(extractArticle(fixture("paywall.html"), "https://paper.example.test/x").paywall).toBe(true);
  });

  it("never executes page scripts", () => {
    const a = extractArticle(fixture("meta-date.html"), URL_);
    expect(a.text).not.toContain("document.cookie");
  });
});

describe("quote verification (V3)", () => {
  const text = extractArticle(fixture("meta-date.html"), URL_).text;

  it("accepts a real quote", () => {
    expect(quoteInText("According to the advisory, 1,200 servers were exposed when the scan finished on Monday.", text)).toBe(true);
  });

  it("accepts a real quote with different quote marks and spacing", () => {
    expect(quoteInText(`The maintainers said the flaw "affects every release   before 4.2"`, text)).toBe(true);
  });

  it("rejects an invented quote", () => {
    expect(quoteInText("According to the advisory, 12,000 servers were exposed when the scan finished on Monday.", text)).toBe(false);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(quoteInText("the flaw", text)).toBe(false);
  });

  it("marks each claim verified or not", () => {
    const out = verifyClaims(
      [{ text: "1,200 exposed", quote: "1,200 servers were exposed when the scan finished" }, { text: "made up", quote: "this sentence is not in the article at all" }],
      text,
    );
    expect(out.map((c) => c.quote_verified)).toEqual([true, false]);
  });
});

describe("sources (V4)", () => {
  it("drops blocked and non-allowlisted domains", () => {
    expect(() => assertApproved("https://www.bleepingcomputer.com/x", ["bleepingcomputer.com"], [])).not.toThrow();
    expect(() => assertApproved("https://copycat.example/x", ["bleepingcomputer.com"], [])).toThrow(/source_not_approved/);
    expect(() => assertApproved("https://bleepingcomputer.com/x", ["bleepingcomputer.com"], ["bleepingcomputer.com"])).toThrow(/blocked_domain/);
    try {
      assertApproved("https://copycat.example/x", [], ["copycat.example"]);
    } catch (e) {
      expect((e as Dropped).reason).toBe("blocked_domain");
    }
  });
});

describe("dedupe (V5)", () => {
  const item = (o: Partial<FeedItem>): FeedItem => ({
    url: "https://a.example/1", title: "t", excerpt: "", published: "2026-10-21T09:00:00Z", source: "A", tier: 2, topic: "security", ...o,
  });

  it("strips tracking params, www and trailing slashes", () => {
    expect(canonicalUrl("https://www.a.example/post/?utm_source=x&id=2#top")).toBe("https://a.example/post?id=2");
  });

  it("merges the same story from two outlets and keeps the higher tier as primary", () => {
    const out = cluster([
      item({ title: "PHP ships emergency patches for critical PHP2Shell flaws", source: "Outlet B" }),
      item({ url: "https://cisa.example/1", title: "Critical PHP2Shell flaws: PHP ships emergency patches", source: "CISA", tier: 1 }),
      item({ url: "https://c.example/9", title: "New open-weights model tops coding benchmark", source: "Outlet C", topic: "ai" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.primary.source).toBe("CISA");
    expect(out[0]?.alsoCoveredBy).toEqual([{ source: "Outlet B", url: "https://a.example/1" }]);
  });

  it("merges by shared CVE even when titles differ", () => {
    const out = cluster([
      item({ title: "Patch now: CVE-2026-12345 under attack" }),
      item({ url: "https://b.example/2", title: "Widget vendor fixes CVE-2026-12345", source: "B" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps different stories apart", () => {
    expect(titleSimilarity("Ransomware hits hospital chain", "New AI model released")).toBe(0);
  });
});

describe("dedupe by story name (V5)", () => {
  const item = (o: Partial<FeedItem>): FeedItem => ({
    url: "https://a.example/1", title: "t", excerpt: "", published: "2026-10-21T09:00:00Z", source: "A", tier: 2, topic: "security", ...o,
  });

  it("merges two outlets that name the same flaw differently", () => {
    const out = cluster([
      item({ title: "Someone Tried to Exploit PHP2Shell 4 Days Before the Vulnerabilities Were Publicly Disclosed", source: "Outlet A" }),
      item({ url: "https://b.example/2", title: "PHP2Shell Exploitation Started Days Before Patches", source: "Outlet B" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("finds coined names but not plain words or years", async () => {
    const { storyNames } = await import("../src/verify/dedupe.js");
    expect(storyNames("Arista patches VeloCloud zero-day in 2026")).toEqual(["velocloud"]);
    expect(storyNames("Log4Shell returns")).toEqual(["log4shell"]);
  });
});
