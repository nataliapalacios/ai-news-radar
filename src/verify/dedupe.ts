import { findCves } from "../alerts/match.js";
import type { FeedItem } from "../collect/rss.js";

/** V5: one story, one item. The same CVE, URL or a near-identical title merges. */

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|source$)/i;

export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.href;
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "for", "and", "on", "with", "by", "as", "is", "are", "at", "from", "new"]);

function words(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}

export function titleSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Coined names that identify one story: PHP2Shell, VeloCloud, Log4Shell. */
export function storyNames(title: string): string[] {
  return (title.match(/[A-Za-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 5 && /[a-z]/i.test(w) && (/\d/.test(w) || /[a-z][A-Z]/.test(w)))
    .map((w) => w.toLowerCase());
}

export interface Cluster {
  primary: FeedItem;
  alsoCoveredBy: { source: string; url: string }[];
}

/** Group items; the primary is the highest-tier source, then the earliest. */
export function cluster(items: FeedItem[], threshold = 0.6): Cluster[] {
  const sorted = [...items].sort((a, b) => a.tier - b.tier || (a.published ?? "").localeCompare(b.published ?? ""));
  const groups: { items: FeedItem[]; urls: Set<string>; cves: Set<string>; names: Set<string> }[] = [];
  for (const it of sorted) {
    const url = canonicalUrl(it.url);
    const cves = findCves(`${it.title} ${it.excerpt}`);
    const names = storyNames(it.title);
    const g = groups.find(
      (g) =>
        g.urls.has(url) ||
        cves.some((c) => g.cves.has(c)) ||
        names.some((n) => g.names.has(n)) ||
        g.items.some((o) => titleSimilarity(o.title, it.title) >= threshold),
    );
    if (g) {
      g.items.push(it);
      g.urls.add(url);
      cves.forEach((c) => g.cves.add(c));
      names.forEach((n) => g.names.add(n));
    } else {
      groups.push({ items: [it], urls: new Set([url]), cves: new Set(cves), names: new Set(names) });
    }
  }
  return groups.map((g) => {
    const [primary, ...rest] = g.items;
    const others = new Map<string, string>();
    for (const r of rest) if (r.source !== primary!.source && !others.has(r.source)) others.set(r.source, r.url);
    return { primary: primary!, alsoCoveredBy: [...others].map(([source, url]) => ({ source, url })) };
  });
}
