// Replay the alert rules over a past period without sending email:
//   npm run replay -- --from 2026-09-01 --to 2026-10-22
// KEV and NVD are queried for the whole period. News can only use what feeds still
// carry today (most keep 10–50 items), so early signals are partial for older dates.
import { parseArgs } from "node:util";
import { fetchKev } from "../collect/kev.js";
import { fetchNvdForWatchlist } from "../collect/nvd.js";
import { fetchAllFeeds, fetchFeed, type FeedItem } from "../collect/rss.js";
import { allowedDomains, loadConfig } from "../config/load.js";
import { type Alert, productDayKey, matchKev, matchNews, matchNvd, mergeRed, newAlerts } from "./match.js";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
const to = values.to ? new Date(`${values.to}T23:59:59Z`) : new Date();
const from = values.from ? new Date(`${values.from}T00:00:00Z`) : new Date(to.getTime() - 60 * 86_400_000);
const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
if (days > 120) throw new Error("NVD allows at most 120 days per query");

const cfg = loadConfig();
const allow = allowedDomains(cfg);
const kevSrc = cfg.sources.find((s) => s.type === "kev");
const nvdSrc = cfg.sources.find((s) => s.type === "nvd");

const kev = kevSrc ? await fetchKev(kevSrc.url, allow) : [];
const nvd = nvdSrc
  ? await fetchNvdForWatchlist(nvdSrc.url, allow, cfg.alerts.watchlist, from, to, { apiKey: process.env.NVD_API_KEY })
  : [];
const feeds = await fetchAllFeeds(cfg.sources.filter((s) => s.topic === "security"), allow);
const vendor: FeedItem[] = [];
for (const w of cfg.alerts.watchlist.filter((w) => w.vendor_feed)) {
  vendor.push(...(await fetchFeed({ name: `${w.name} (vendor)`, url: w.vendor_feed!, tier: 1, topic: "security" }, allow)));
}

// KEV: fires on the day it was added. NVD: on the day it was published (a lower bound:
// the score may have arrived later). News: simulated at the end of each day.
const red = mergeRed([
  ...matchKev(kev.filter((e) => new Date(e.dateAdded) <= to), cfg.alerts.watchlist, to, days).map((a) => ({
    ...a,
    detectedAt: `${kev.find((e) => e.cveID === a.cve)!.dateAdded}T00:00:00Z`,
  })),
  ...matchNvd(nvd, cfg.alerts.watchlist, cfg.alerts.cvss_min, to).map((a) => ({
    ...a,
    detectedAt: nvd.find((c) => c.id === a.cve)!.published,
  })),
]);

const sent = new Set<string>();
const orange: Alert[] = [];
for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
  const end = new Date(d.getTime() + 86_399_000);
  for (const a of red) if (a.detectedAt.slice(0, 10) === d.toISOString().slice(0, 10)) sent.add(productDayKey(a.product, d));
  const items = [...feeds.items, ...vendor].filter((i) => i.published && new Date(i.published) <= end);
  const hits = newAlerts(
    matchNews(items, cfg.alerts.watchlist, {
      severityKeywords: cfg.alerts.severity_keywords,
      minSources: cfg.alerts.early_signal_min_sources,
      hours: 24,
    }, end),
    sent,
  );
  for (const a of hits) {
    sent.add(a.key);
    sent.add(productDayKey(a.product, end));
    orange.push({ ...a, detectedAt: a.reported.map((r) => r.published!).sort().at(-1)! });
  }
}

const all = [...red, ...orange].sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
console.log(`Replay ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} · watchlist: ${cfg.alerts.watchlist.map((w) => w.name).join(", ")}`);
console.log(`KEV ${kev.length} entries · NVD ${nvd.length} watchlist CVEs · news ${feeds.items.length + vendor.length} items (oldest ${[...feeds.items, ...vendor].map((i) => i.published).filter(Boolean).sort()[0]?.slice(0, 10) ?? "n/a"})\n`);
if (!all.length) console.log("No alert would have fired.");
for (const a of all) {
  const what = a.level === "red" ? (a.reason === "kev" ? "CISA KEV" : `CVSS ${a.cvss?.toFixed(1)}`) : `${new Set(a.reported.map((r) => r.source)).size} source(s)`;
  console.log(`${a.detectedAt.slice(0, 16).replace("T", " ")}  ${a.level === "red" ? "🔴" : "🟠"}  ${a.product.padEnd(10)} ${(a.cve ?? "-").padEnd(16)} ${what}`);
  for (const r of a.reported.slice(0, 3)) console.log(`                      ${r.source}: ${r.title.slice(0, 90)}`);
}
