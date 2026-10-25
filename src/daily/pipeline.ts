import { createHash } from "node:crypto";
import { type Alert, findCves, matchesAny } from "../alerts/match.js";
import type { FeedItem } from "../collect/rss.js";
import type { Config } from "../config/schema.js";
import { type Article, type DropReason, Dropped } from "../extract/article.js";
import { CRITERIA, type Candidate, type Llm, type Scores } from "../llm/types.js";
import { type Cluster, cluster, titleSimilarity } from "../verify/dedupe.js";
import { verifyClaims } from "../verify/quotes.js";
import { assertApproved } from "../verify/sources.js";
import { pickWithMix } from "./select.js";

export interface DailyItem {
  id: string;
  url: string;
  canonical: string;
  title: string;
  source: string;
  tier: number;
  published: string;
  topic: "ai" | "security";
  scores: Scores;
  total: number;
  why_it_matters: string;
  claims: { text: string; quote: string }[];
  action: string;
  cves: string[];
  flags: string[];
  also_covered_by: { source: string; url: string }[];
  verified_at: string;
  http_status: number;
  text_hash: string;
}

/** One "AI in brief" line pair: why it matters + one verified fact. */
export interface Brief {
  id: string;
  title: string;
  url: string;
  source: string;
  published: string;
  why_it_matters: string;
  fact: string;
  quote: string;
  /** "feed summary" when the page couldn't be read and the quote was checked against the feed text. */
  basis: "article" | "feed summary";
}

export function toBrief(d: DailyItem): Brief {
  // The second line should add something: take the fact that overlaps least with "why it matters".
  const c = [...d.claims].sort((a, b) => titleSimilarity(a.text, d.why_it_matters) - titleSimilarity(b.text, d.why_it_matters))[0];
  return {
    id: d.id, title: d.title, url: d.url, source: d.source, published: d.published,
    why_it_matters: d.why_it_matters, fact: c!.text, quote: c!.quote,
    basis: d.flags.includes("from_feed_summary") ? "feed summary" : "article",
  };
}

/** A feed summary shorter than this can't back a quote. */
const FEED_FALLBACK_MIN = 150;
const FETCH_REASONS = new Set<DropReason>(["url_unreachable", "robots_disallowed", "paywall"]);

export interface RunnerUp {
  id: string;
  title: string;
  url: string;
  source: string;
  topic: string;
  total: number;
}

export interface DailyRun {
  date: string;
  generated_at: string;
  window_hours: number;
  candidates: number;
  summarized: number;
  top: DailyItem[];
  ai_briefs: Brief[];
  runners_up: RunnerUp[];
  dropped: { url: string; title: string; source: string; reason: DropReason }[];
  missing_topics: string[];
  alerts_24h: { level: string; product: string; cve: string | null; subject_time: string }[];
  /** Alerts not emailed on their own (delivery: red_only / daily), shown in full at the top. */
  alerts_held?: Alert[];
  source_errors: string[];
  usage: { input: number; output: number; usd: number };
}

export interface PipelineDeps {
  cfg: Config;
  allow: string[];
  llm: Llm;
  fetchArticle: (url: string) => Promise<Article>;
  now: Date;
}

const sum = (s: Scores) => CRITERIA.reduce((t, k) => t + s[k], 0);

export function itemId(date: string, it: FeedItem): string {
  const src = it.source.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${date}-${src}-${createHash("sha1").update(it.url).digest("hex").slice(0, 8)}`;
}

/** Steps 3–6 of the daily flow: filter, dedupe, pre-score, summarize with verified quotes, pick. */
export async function buildDaily(
  feedItems: FeedItem[],
  windowHours: number,
  exclude: { urls: Set<string>; cves: Set<string> },
  deps: PipelineDeps,
): Promise<Pick<DailyRun, "candidates" | "summarized" | "top" | "ai_briefs" | "runners_up" | "dropped" | "missing_topics">> {
  const { cfg, allow, llm, now } = deps;
  const date = now.toISOString().slice(0, 10);
  const dropped: DailyRun["dropped"] = [];
  const drop = (it: FeedItem, reason: DropReason) => dropped.push({ url: it.url, title: it.title, source: it.source, reason });

  // V4 and the time window, on what the feeds say.
  const since = now.getTime() - windowHours * 3_600_000;
  const fresh: FeedItem[] = [];
  for (const it of feedItems) {
    if (!it.published || new Date(it.published).getTime() < since) continue;
    // General feeds (business schools, vendor blogs): only items about the topic count.
    if (it.requireKeywords && !matchesAny(`${it.title} ${it.excerpt}`, cfg.topics[it.topic].keywords)) continue;
    try {
      assertApproved(it.url, allow, cfg.blocked_domains);
      fresh.push(it);
    } catch (e) {
      drop(it, (e as Dropped).reason);
    }
  }

  // V5, then drop what an alert already covered.
  const clusters = cluster(fresh).filter((c) => {
    const urls = [c.primary.url, ...c.alsoCoveredBy.map((o) => o.url)];
    const cves = findCves(`${c.primary.title} ${c.primary.excerpt}`);
    return !urls.some((u) => exclude.urls.has(u)) && !cves.some((v) => exclude.cves.has(v));
  });

  const byId = new Map(clusters.map((c) => [itemId(date, c.primary), c]));
  const cands: Candidate[] = [...byId].map(([id, c]) => ({
    id, title: c.primary.title, excerpt: c.primary.excerpt, source: c.primary.source, tier: c.primary.tier, topic: c.primary.topic,
  }));
  const focus = [
    ...cfg.alerts.watchlist.map((w) => w.name),
    ...cfg.topics.ai.keywords,
    ...cfg.topics.security.keywords,
  ];
  const scores = cands.length ? await llm.prescore(cands, focus) : new Map<string, Scores>();
  const ranked = cands
    .filter((c) => scores.has(c.id))
    .map((c) => ({ ...c, scores: scores.get(c.id)!, total: sum(scores.get(c.id)!) }));

  // Summarize a few more than we need, with a backup per required topic: the lock will drop some.
  const { ai, security } = cfg.daily.min_per_topic;
  const { picked: toSummarize } = pickWithMix(ranked, cfg.daily.summarize_n, {
    ai: ai ? ai + 1 : 0,
    security: security ? security + 1 : 0,
  });
  const reasonById = new Map<string, DropReason>();
  /** Fetch, summarize and verify one story; null (with a drop reason recorded) when the lock rejects it. */
  async function summarizeOne(c: (typeof ranked)[number], cl: Cluster, feedFallback: boolean): Promise<DailyItem | null> {
    const it = cl.primary;
    try {
      let art: Article | null = null;
      try {
        art = await deps.fetchArticle(it.url); // V1
        if (art.paywall) throw new Dropped("paywall");
      } catch (e) {
        // Briefs only: fall back to the feed's own summary, if it's long enough to quote.
        if (!(e instanceof Dropped) || !feedFallback || it.excerpt.length < FEED_FALLBACK_MIN) throw e;
        art = null;
      }
      const text = art ? art.text : `${it.title}. ${it.excerpt}`;
      const published = it.published ?? art?.published; // V2: the feed's date, else the page's
      if (!published) throw new Dropped("no_date");
      const s = await llm.summarize(c, text);
      if (!s) throw new Dropped("invalid_output");
      const claims = verifyClaims(s.claims, text).filter((x) => x.quote_verified); // V3
      if (!claims.length) throw new Dropped("no_verifiable_quote");
      return {
        id: c.id, url: it.url, canonical: art?.canonical ?? it.url, title: it.title, source: it.source, tier: it.tier, published,
        topic: it.topic, scores: c.scores, total: c.total, why_it_matters: s.why_it_matters,
        claims: claims.map(({ text, quote }) => ({ text, quote })), action: s.action,
        cves: [...new Set([...s.cves, ...findCves(text)])].filter((v) => findCves(v).length).slice(0, 5),
        flags: art ? s.flags : [...s.flags, "from_feed_summary"], also_covered_by: cl.alsoCoveredBy,
        verified_at: art?.verifiedAt ?? now.toISOString(), http_status: art?.httpStatus ?? 0,
        text_hash: art?.textHash ?? createHash("sha256").update(text).digest("hex"),
      };
    } catch (e) {
      if (!(e instanceof Dropped)) throw e;
      drop(it, e.reason);
      reasonById.set(c.id, e.reason);
      return null;
    }
  }

  const summarized: DailyItem[] = [];
  for (const c of toSummarize) {
    const item = await summarizeOne(c, byId.get(c.id)!, false);
    if (item) summarized.push(item);
  }

  const { picked: top, missing } = pickWithMix(summarized, cfg.daily.top_n, cfg.daily.min_per_topic);
  const topIds = new Set(top.map((t) => t.id));

  // "AI in brief": the next AI stories by score, two verified lines each. A story whose page
  // can't be read may still be briefed from the publisher's own feed summary (quotes checked there).
  const ai_briefs: Brief[] = [];
  const done = new Map(summarized.map((s) => [s.id, s]));
  const tried = new Set(toSummarize.map((c) => c.id));
  let attempts = 0;
  for (const c of ranked.filter((r) => r.topic === "ai" && !topIds.has(r.id)).sort((a, b) => b.total - a.total)) {
    if (ai_briefs.length >= cfg.daily.ai_briefs || attempts >= cfg.daily.ai_briefs * 2) break;
    let item = done.get(c.id);
    // New stories, and ones the top 3 rejected only because the page couldn't be read.
    const retry = tried.has(c.id) && FETCH_REASONS.has(reasonById.get(c.id)!);
    if (!item && (!tried.has(c.id) || retry)) {
      attempts++;
      item = (await summarizeOne(c, byId.get(c.id)!, true)) ?? undefined;
      if (item && retry) dropped.splice(dropped.findIndex((d) => d.url === item!.url), 1);
    }
    if (item) ai_briefs.push(toBrief(item));
  }
  const briefIds = new Set(ai_briefs.map((b) => b.id));

  const runners_up = ranked
    .filter((r) => !topIds.has(r.id) && !briefIds.has(r.id))
    .sort((a, b) => b.total - a.total)
    .slice(0, cfg.daily.runners_up)
    .map((r) => {
      const p = byId.get(r.id)!.primary;
      return { id: r.id, title: p.title, url: p.url, source: p.source, topic: p.topic, total: r.total };
    });

  return { candidates: cands.length, summarized: toSummarize.length + attempts, top, ai_briefs, runners_up, dropped, missing_topics: missing };
}
