import type { FeedItem } from "../collect/rss.js";
import type { KevEntry } from "../collect/kev.js";
import type { NvdCve } from "../collect/nvd.js";
import type { WatchItem } from "../config/schema.js";

export type Level = "red" | "orange";

export interface Link {
  label: string;
  url: string;
}

export interface Alert {
  level: Level;
  /** Dedupe key: one email per key, ever. */
  key: string;
  product: string;
  cve: string | null;
  reason: "kev" | "cvss" | "multi_source" | "tier1_source";
  /** Statements taken from structured sources (KEV, NVD): fields, not prose we wrote. */
  confirmed: string[];
  /** Headlines that report it, exactly as published. */
  reported: { source: string; title: string; url: string; published: string | null }[];
  cvss: number | null;
  description: string;
  links: Link[];
  detectedAt: string;
  /** Key of an earlier early-signal alert this one confirms. */
  supersedes?: string;
}

const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

/** Marks a product as alerted for the day, so CVE-less follow-up coverage doesn't alert again. */
export const productDayKey = (product: string, at: Date | string) =>
  `orange:${product.toLowerCase()}:${new Date(at).toISOString().slice(0, 10)}`;

export function termRegex(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i");
}

export function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((t) => termRegex(t).test(text));
}

export function findCves(text: string): string[] {
  return [...new Set((text.match(CVE_RE) ?? []).map((c) => c.toUpperCase()))];
}

/** References that point at exploit code or PoCs are never included (defensive-only rule). */
export function isOffensiveLink(url: string): boolean {
  if (/exploit|packetstorm|metasploit|nuclei|proof-of-concept|(^|[^a-z])poc([^a-z]|$)/i.test(url)) return true;
  // Code hosts mostly carry PoCs in CVE references; keep only their advisory pages.
  const u = new URL(url);
  if (/(^|\.)(github\.com|gist\.github\.com|gitlab\.com)$/.test(u.hostname))
    return !/^\/(advisories\/|[^/]+\/[^/]+\/security\/advisories\/)/.test(u.pathname);
  return false;
}

const nvdLink = (cve: string): Link => ({ label: `NVD ${cve}`, url: `https://nvd.nist.gov/vuln/detail/${cve}` });
const KEV_LINK: Link = {
  label: "CISA Known Exploited Vulnerabilities catalog",
  url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
};

export function matchKev(entries: KevEntry[], watch: WatchItem[], now: Date, lookbackDays: number): Alert[] {
  const since = now.getTime() - lookbackDays * 86_400_000;
  const out: Alert[] = [];
  for (const e of entries) {
    if (new Date(`${e.dateAdded}T00:00:00Z`).getTime() < since) continue;
    const w = watch.find((w) => matchesAny(`${e.vendorProject} ${e.product}`, w.match));
    if (!w) continue;
    out.push({
      level: "red",
      key: `red:${e.cveID}`,
      product: w.name,
      cve: e.cveID,
      reason: "kev",
      confirmed: [
        `Added to CISA KEV on ${e.dateAdded}: ${e.vulnerabilityName}.`,
        ...(e.requiredAction ? [`CISA required action: ${e.requiredAction}`] : []),
        ...(e.knownRansomwareCampaignUse === "Known" ? ["CISA lists known use in ransomware campaigns."] : []),
      ],
      reported: [],
      cvss: null,
      description: e.shortDescription,
      links: [nvdLink(e.cveID), KEV_LINK],
      detectedAt: now.toISOString(),
    });
  }
  return out;
}

export function cveMatchesWatch(c: NvdCve, w: WatchItem): boolean {
  if (w.cpe.length) return c.cpes.some((p) => w.cpe.includes(p));
  return matchesAny(c.description, w.match);
}

export function matchNvd(cves: NvdCve[], watch: WatchItem[], cvssMin: number, now: Date): Alert[] {
  const out: Alert[] = [];
  for (const c of cves) {
    if (c.cvss === null || c.cvss < cvssMin) continue;
    const w = watch.find((w) => cveMatchesWatch(c, w));
    if (!w) continue;
    out.push({
      level: "red",
      key: `red:${c.id}`,
      product: w.name,
      cve: c.id,
      reason: "cvss",
      confirmed: [`NVD lists ${c.id} with CVSS ${c.cvss.toFixed(1)} (published ${c.published.slice(0, 10)}).`],
      reported: [],
      cvss: c.cvss,
      description: c.description,
      links: [
        nvdLink(c.id),
        ...c.references.filter((u) => u.startsWith("https://") && !isOffensiveLink(u)).slice(0, 4)
          .map((url) => ({ label: new URL(url).hostname, url })),
      ],
      detectedAt: now.toISOString(),
    });
  }
  return out;
}

export interface NewsRules {
  severityKeywords: string[];
  minSources: number;
  hours: number;
}

/** Early signals: watchlist term + severity keyword in ≥ N sources, or in one tier-1 source. */
export function matchNews(items: FeedItem[], watch: WatchItem[], rules: NewsRules, now: Date): Alert[] {
  const since = now.getTime() - rules.hours * 3_600_000;
  const groups = new Map<string, { w: WatchItem; cve: string | null; items: FeedItem[] }>();
  for (const it of items) {
    if (!it.published || new Date(it.published).getTime() < since) continue;
    const text = `${it.title} ${it.excerpt}`;
    if (!matchesAny(text, rules.severityKeywords)) continue;
    const w = watch.find((w) => matchesAny(text, w.match));
    if (!w) continue;
    const cve = findCves(text)[0] ?? null;
    const key = cve ? `orange:${cve}` : productDayKey(w.name, now);
    const g = groups.get(key) ?? { w, cve, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const out: Alert[] = [];
  for (const [key, g] of groups) {
    const sources = new Set(g.items.map((i) => i.source));
    const tier1 = g.items.some((i) => i.tier === 1);
    if (!tier1 && sources.size < rules.minSources) continue;
    out.push({
      level: "orange",
      key,
      product: g.w.name,
      cve: g.cve,
      reason: tier1 ? "tier1_source" : "multi_source",
      confirmed: [],
      reported: g.items.map((i) => ({ source: i.source, title: i.title, url: i.url, published: i.published })),
      cvss: null,
      description: "",
      links: g.cve ? [nvdLink(g.cve)] : [],
      detectedAt: now.toISOString(),
    });
  }
  return out;
}

/** Merge KEV and NVD hits for the same CVE into one red alert. */
export function mergeRed(alerts: Alert[]): Alert[] {
  const byKey = new Map<string, Alert>();
  for (const a of alerts) {
    const prev = byKey.get(a.key);
    if (!prev) {
      byKey.set(a.key, { ...a });
      continue;
    }
    prev.reason = prev.reason === "kev" || a.reason === "kev" ? "kev" : prev.reason;
    prev.cvss = prev.cvss ?? a.cvss;
    prev.confirmed = [...new Set([...prev.confirmed, ...a.confirmed])];
    prev.description ||= a.description;
    prev.links = dedupeLinks([...prev.links, ...a.links]);
  }
  return [...byKey.values()];
}

function dedupeLinks(links: Link[]): Link[] {
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** Drop alerts already sent; link a new red to the early signal it confirms. */
export function newAlerts(alerts: Alert[], seen: { has(k: string): boolean }): Alert[] {
  const out: Alert[] = [];
  for (const a of alerts) {
    if (seen.has(a.key)) continue;
    if (a.level === "orange" && a.cve && seen.has(`red:${a.cve}`)) continue;
    if (a.level === "red" && a.cve && seen.has(`orange:${a.cve}`)) a.supersedes = `orange:${a.cve}`;
    out.push(a);
  }
  // Reds first, then by product.
  return out.sort((x, y) => (x.level === y.level ? x.product.localeCompare(y.product) : x.level === "red" ? -1 : 1));
}

/** Red always sends; orange waits for the end of quiet hours (HH:MM-HH:MM in the config timezone). */
export function inQuietHours(range: string | null, timezone: string, now: Date): boolean {
  if (!range) return false;
  const [from = "", to = ""] = range.split("-");
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return from <= to ? local >= from && local < to : local >= from || local < to;
}
