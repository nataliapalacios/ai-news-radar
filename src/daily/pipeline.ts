import { createHash } from "node:crypto";
import { findCves } from "../alerts/match.js";
import type { FeedItem } from "../collect/rss.js";
import type { Config } from "../config/schema.js";
import { type Article, type DropReason, Dropped } from "../extract/article.js";
import { CRITERIA, type Candidate, type Llm, type Scores } from "../llm/types.js";
import { cluster } from "../verify/dedupe.js";
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
  runners_up: RunnerUp[];
  dropped: { url: string; title: string; source: string; reason: DropReason }[];
  missing_topics: string[];
  alerts_24h: { level: string; product: string; cve: string | null; subject_time: string }[];
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
): Promise<Pick<DailyRun, "candidates" | "summarized" | "top" | "runners_up" | "dropped" | "missing_topics">> {
  const { cfg, allow, llm, now } = deps;
  const date = now.toISOString().slice(0, 10);
  const dropped: DailyRun["dropped"] = [];
  const drop = (it: FeedItem, reason: DropReason) => dropped.push({ url: it.url, title: it.title, source: it.source, reason });

  // V4 and the time window, on what the feeds say.
  const since = now.getTime() - windowHours * 3_600_000;
  const fresh: FeedItem[] = [];
  for (const it of feedItems) {
    if (!it.published || new Date(it.published).getTime() < since) continue;
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
  const summarized: DailyItem[] = [];
  for (const c of toSummarize) {
    const cl = byId.get(c.id)!;
    const it = cl.primary;
    try {
      const art = await deps.fetchArticle(it.url); // V1
      const published = it.published ?? art.published; // V2: the feed's date, else the page's
      if (!published) throw new Dropped("no_date");
      if (art.paywall) throw new Dropped("paywall");
      const s = await llm.summarize(c, art.text);
      if (!s) throw new Dropped("invalid_output");
      const claims = verifyClaims(s.claims, art.text).filter((x) => x.quote_verified); // V3
      if (!claims.length) throw new Dropped("no_verifiable_quote");
      summarized.push({
        id: c.id, url: it.url, canonical: art.canonical, title: it.title, source: it.source, tier: it.tier, published,
        topic: it.topic, scores: c.scores, total: c.total, why_it_matters: s.why_it_matters,
        claims: claims.map(({ text, quote }) => ({ text, quote })), action: s.action,
        cves: [...new Set([...s.cves, ...findCves(art.text)])].filter((v) => findCves(v).length).slice(0, 5),
        flags: s.flags, also_covered_by: cl.alsoCoveredBy,
        verified_at: art.verifiedAt, http_status: art.httpStatus, text_hash: art.textHash,
      });
    } catch (e) {
      if (!(e instanceof Dropped)) throw e;
      drop(it, e.reason);
    }
  }

  const { picked: top, missing } = pickWithMix(summarized, cfg.daily.top_n, cfg.daily.min_per_topic);
  const topIds = new Set(top.map((t) => t.id));
  const runners_up = ranked
    .filter((r) => !topIds.has(r.id))
    .sort((a, b) => b.total - a.total)
    .slice(0, cfg.daily.runners_up)
    .map((r) => {
      const p = byId.get(r.id)!.primary;
      return { id: r.id, title: p.title, url: p.url, source: p.source, topic: p.topic, total: r.total };
    });

  return { candidates: cands.length, summarized: toSummarize.length, top, runners_up, dropped, missing_topics: missing };
}
