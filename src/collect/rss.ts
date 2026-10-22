import Parser from "rss-parser";
import type { Source } from "../config/schema.js";
import { safeFetch } from "../net/fetch.js";

export interface FeedItem {
  url: string;
  title: string;
  excerpt: string;
  /** ISO date from the feed, or null when the feed doesn't state one. */
  published: string | null;
  source: string;
  tier: 1 | 2 | 3;
  topic: "ai" | "security";
}

const parser = new Parser();

export async function fetchFeed(
  src: Pick<Source, "name" | "url" | "tier" | "topic">,
  allow: string[],
): Promise<FeedItem[]> {
  const res = await safeFetch(src.url, { allow });
  if (res.status !== 200) throw new Error(`${src.name}: HTTP ${res.status}`);
  return parseFeed(res.body, src);
}

export async function parseFeed(
  xml: string,
  src: Pick<Source, "name" | "tier" | "topic">,
): Promise<FeedItem[]> {
  const feed = await parser.parseString(xml);
  return feed.items.flatMap((it) => {
    const url = it.link?.trim();
    const title = it.title?.trim();
    if (!url || !title || !url.startsWith("https://")) return [];
    return [{
      url,
      title: clean(title),
      excerpt: clean(it.contentSnippet ?? it.summary ?? "").slice(0, 600),
      published: toIso(it.isoDate ?? it.pubDate),
      source: src.name,
      tier: src.tier,
      topic: src.topic,
    }];
  });
}

/** Fetch every RSS source; a broken feed is reported, not fatal. */
export async function fetchAllFeeds(
  sources: Source[],
  allow: string[],
): Promise<{ items: FeedItem[]; errors: string[] }> {
  const rss = sources.filter((s) => s.type === "rss");
  const results = await Promise.allSettled(rss.map((s) => fetchFeed(s, allow)));
  const items: FeedItem[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${rss[i]!.name}: ${String(r.reason?.message ?? r.reason)}`);
  });
  return { items, errors };
}

export function withinHours(item: FeedItem, hours: number, now = new Date()): boolean {
  if (!item.published) return false;
  return now.getTime() - new Date(item.published).getTime() <= hours * 3_600_000;
}

function toIso(d: string | undefined): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function clean(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
