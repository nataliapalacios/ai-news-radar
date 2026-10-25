import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeedItem } from "../src/collect/rss.js";
import { parseConfig } from "../src/config/load.js";
import { buildDaily, type DailyRun } from "../src/daily/pipeline.js";
import { renderDaily } from "../src/daily/render.js";
import { pickWithMix } from "../src/daily/select.js";
import { type Article, Dropped, extractArticle } from "../src/extract/article.js";
import { MockLlm } from "../src/llm/mock.js";
import type { Summary } from "../src/llm/types.js";
import { verifyTrends } from "../src/monthly/trends.js";

const cfg = parseConfig(readFileSync("radar.config.example.yaml", "utf8"));
const now = new Date("2026-10-21T12:00:00Z");
const html = readFileSync(new URL("./fixtures/meta-date.html", import.meta.url), "utf8");

const item = (o: Partial<FeedItem>): FeedItem => ({
  url: "https://www.bleepingcomputer.com/news/1", title: "Widget server patched after critical flaw", excerpt: "patch available",
  published: "2026-10-21T09:00:00Z", source: "BleepingComputer", tier: 2, topic: "security", ...o,
});

const article = (url: string): Article => ({ ...extractArticle(html, url), httpStatus: 200, verifiedAt: now.toISOString() });

function deps(over: { fetchArticle?: (u: string) => Promise<Article>; llm?: MockLlm } = {}) {
  return {
    cfg, now, allow: ["bleepingcomputer.com", "securityweek.com", "deepmind.google", "openai.com"],
    llm: over.llm ?? new MockLlm(),
    fetchArticle: over.fetchArticle ?? (async (u: string) => article(u)),
  };
}
const none = { urls: new Set<string>(), cves: new Set<string>() };

describe("mix rules", () => {
  it("reserves one per topic, then fills by score", () => {
    const items = [
      { id: "s1", topic: "security" as const, total: 90 }, { id: "s2", topic: "security" as const, total: 85 },
      { id: "s3", topic: "security" as const, total: 80 }, { id: "a1", topic: "ai" as const, total: 40 },
    ];
    expect(pickWithMix(items, 3, { ai: 1, security: 1 }).picked.map((i) => i.id)).toEqual(["s1", "s2", "a1"]);
  });

  it("reports a missing topic instead of padding", () => {
    const out = pickWithMix([{ id: "s1", topic: "security" as const, total: 90 }], 3, { ai: 1, security: 1 });
    expect(out.missing).toEqual(["ai"]);
    expect(out.picked).toHaveLength(1);
  });
});

describe("daily pipeline", () => {
  it("keeps only verified quotes and records the audit trail", async () => {
    const out = await buildDaily([item({}), item({ url: "https://deepmind.google/blog/x", title: "New model card", source: "Google DeepMind", tier: 1, topic: "ai" })], 24, none, deps());
    expect(out.top).toHaveLength(2);
    for (const t of out.top) {
      expect(t.claims.length).toBeGreaterThan(0);
      expect(t.http_status).toBe(200);
      expect(t.text_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("drops a story whose model quotes are invented", async () => {
    const llm = new MockLlm();
    llm.summarize = async (): Promise<Summary> => ({
      title: "x", why_it_matters: "x", claims: [{ text: "x", quote: "This sentence does not appear anywhere in the article text." }],
      action: "none", topic: "security", cves: [], flags: [],
    });
    const out = await buildDaily([item({})], 24, none, deps({ llm }));
    expect(out.top).toHaveLength(0);
    expect(out.dropped[0]?.reason).toBe("no_verifiable_quote");
  });

  it("drops unreachable and non-allowlisted URLs with a reason", async () => {
    const out = await buildDaily(
      [item({}), item({ url: "https://copycat.example/1", title: "Something else entirely" })],
      24, none,
      deps({ fetchArticle: async () => { throw new Dropped("url_unreachable", "HTTP 404"); } }),
    );
    expect(out.dropped.map((d) => d.reason).sort()).toEqual(["source_not_approved", "url_unreachable"]);
  });

  it("drops paywalled pages", async () => {
    const out = await buildDaily([item({})], 24, none, deps({ fetchArticle: async (u) => ({ ...article(u), paywall: true }) }));
    expect(out.dropped[0]?.reason).toBe("paywall");
  });

  it("skips stories already sent as alerts", async () => {
    const out = await buildDaily([item({ title: "Critical CVE-2026-12345 patched" })], 24, { urls: new Set(), cves: new Set(["CVE-2026-12345"]) }, deps());
    expect(out.candidates).toBe(0);
  });

  it("ignores items outside the window", async () => {
    const out = await buildDaily([item({ published: "2026-10-19T00:00:00Z" })], 24, none, deps());
    expect(out.candidates).toBe(0);
  });

  it("renders an email that escapes article text", async () => {
    const out = await buildDaily([item({ title: "<img src=x onerror=alert(1)> Widget server patched" })], 24, none, deps());
    const run: DailyRun = { date: "2026-10-21", generated_at: now.toISOString(), window_hours: 24, ...out, alerts_24h: [], source_errors: [], usage: { input: 0, output: 0, usd: 0 } };
    const email = renderDaily(run, "Europe/Madrid");
    expect(email.html).not.toContain("<img");
    expect(email.subject).toContain("[Radar] Wed 21 Oct");
    expect(email.text).toContain("No AI story passed verification today.");
  });
});

describe("monthly lock (V6)", () => {
  it("drops trends that cite fewer than two real items", () => {
    const archive = [{ id: "a" }, { id: "b" }, { id: "c" }].map((x) => ({ ...x, date: "", title: "", source: "", topic: "ai", why_it_matters: "" }));
    const kept = verifyTrends({
      trends: [
        { title: "ok", summary: "", item_ids: ["a", "b"] },
        { title: "invented ids", summary: "", item_ids: ["a", "zzz"] },
        { title: "duplicate id", summary: "", item_ids: ["c", "c"] },
      ],
      watch_next_month: [],
    }, archive);
    expect(kept.map((t) => t.title)).toEqual(["ok"]);
  });
});

describe("AI in brief", () => {
  const TITLES = ["", "Robotics benchmark released", "Hospital pilots triage assistant", "Chip export rules tightened", "Open dataset for climate forecasting", "Startup raises funds for coding agents", "Regulator opens consultation on chatbots", "University course on model evaluation"];
  const ai = (n: number, o: Partial<FeedItem> = {}) =>
    item({ url: `https://deepmind.google/blog/${n}`, title: TITLES[n]!, source: "Google DeepMind", tier: 1, topic: "ai", excerpt: "AI model update", ...o });

  it("adds up to ai_briefs AI stories beyond the top 3, each with a verified fact", async () => {
    const feed = [item({}), ...[1, 2, 3, 4, 5, 6, 7].map((n) => ai(n))];
    const out = await buildDaily(feed, 24, none, deps());
    expect(out.ai_briefs).toHaveLength(5);
    const topIds = new Set(out.top.map((t) => t.id));
    for (const b of out.ai_briefs) {
      expect(topIds.has(b.id)).toBe(false);
      expect(html).toContain(b.quote.slice(0, 30));
      expect(b.basis).toBe("article");
    }
    expect(out.runners_up.some((r) => out.ai_briefs.some((b) => b.id === r.id))).toBe(false);
  });

  it("briefs a blocked page from the publisher's feed summary, verified against that text", async () => {
    const excerpt = "The company said the new assistant handles scheduling for small teams and will reach all business customers next month across Europe. It costs nothing extra for current subscribers.";
    const out = await buildDaily([item({}), ai(1, { excerpt })], 24, none, deps({
      fetchArticle: async (u) => {
        if (u.includes("deepmind")) throw new Dropped("url_unreachable", "HTTP 403");
        return article(u);
      },
    }));
    expect(out.ai_briefs).toHaveLength(1);
    expect(out.ai_briefs[0]?.basis).toBe("feed summary");
    expect(excerpt).toContain(out.ai_briefs[0]!.quote.replace(/^.*?\. /, "").slice(0, 40));
  });

  it("never uses the feed fallback for the top 3", async () => {
    const out = await buildDaily([item({})], 24, none, deps({ fetchArticle: async () => { throw new Dropped("url_unreachable"); } }));
    expect(out.top).toHaveLength(0);
  });

  it("keeps only on-topic items from general feeds", async () => {
    const out = await buildDaily([
      ai(1, { title: "Dean's letter on campus housing", excerpt: "Housing update", requireKeywords: true }),
      ai(2, { title: "Business school study on generative AI at work", excerpt: "", requireKeywords: true }),
    ], 24, none, deps());
    expect(out.candidates).toBe(1);
  });
});
