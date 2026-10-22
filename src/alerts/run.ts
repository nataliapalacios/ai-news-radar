import { fetchKev } from "../collect/kev.js";
import { fetchNvdForWatchlist, type NvdCve } from "../collect/nvd.js";
import { fetchAllFeeds, fetchFeed, type FeedItem } from "../collect/rss.js";
import { allowedDomains, loadConfig } from "../config/load.js";
import { sendEmail } from "../email/send.js";
import { markSuccess } from "../state/health.js";
import { appendAlert, Seen } from "../state/store.js";
import { inQuietHours, productDayKey, matchKev, matchNews, matchNvd, mergeRed, newAlerts } from "./match.js";
import { renderAlerts } from "./render.js";

const NEWS_WINDOW_HOURS = 24;

const now = new Date();
const cfg = loadConfig();
const allow = allowedDomains(cfg);
const seen = new Seen();
const errors: string[] = [];

async function attempt<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return fallback;
  }
}

const kevSrc = cfg.sources.find((s) => s.type === "kev");
const nvdSrc = cfg.sources.find((s) => s.type === "nvd");

const kev = kevSrc ? await attempt("CISA KEV", () => fetchKev(kevSrc.url, allow), []) : [];
const nvd: NvdCve[] = nvdSrc
  ? await attempt("NVD", () =>
      fetchNvdForWatchlist(nvdSrc.url, allow, cfg.alerts.watchlist, new Date(now.getTime() - cfg.alerts.nvd_lookback_hours * 3_600_000), now, {
        apiKey: process.env.NVD_API_KEY,
        // Modified, not published: NVD often scores a CVE days after publishing it.
        by: "modified",
      }), [])
  : [];
const feeds = await fetchAllFeeds(cfg.sources.filter((s) => s.topic === "security"), allow);
errors.push(...feeds.errors);
const vendor: FeedItem[] = (
  await Promise.all(
    cfg.alerts.watchlist
      .filter((w) => w.vendor_feed)
      .map((w) =>
        attempt(`${w.name} vendor feed`, () =>
          fetchFeed({ name: `${w.name} (vendor)`, url: w.vendor_feed!, tier: 1, topic: "security" }, allow), []),
      ),
  )
).flat();

const news = [...feeds.items, ...vendor].filter((i) => !seen.has(`news:${i.url}`));
const candidates = [
  ...mergeRed([
    ...matchKev(kev, cfg.alerts.watchlist, now, cfg.alerts.kev_lookback_days),
    ...matchNvd(nvd, cfg.alerts.watchlist, cfg.alerts.cvss_min, now),
  ]),
  ...matchNews(news, cfg.alerts.watchlist, {
    severityKeywords: cfg.alerts.severity_keywords,
    minSources: cfg.alerts.early_signal_min_sources,
    hours: NEWS_WINDOW_HOURS,
  }, now),
];

const quiet = inQuietHours(cfg.alerts.quiet_hours, cfg.timezone, now);
const toSend = newAlerts(candidates, seen).filter((a) => a.level === "red" || !quiet);

if (toSend.length) {
  console.log(await sendEmail(cfg.recipients, renderAlerts(toSend)));
  for (const a of toSend) {
    seen.add(a.key, now);
    seen.add(productDayKey(a.product, now), now);
    for (const r of a.reported) seen.add(`news:${r.url}`, now);
    appendAlert(a, now);
  }
}
seen.save(now);

console.log(
  `alerts: KEV ${kev.length} · NVD ${nvd.length} · news ${news.length} · candidates ${candidates.length} · sent ${toSend.length}${quiet ? " · quiet hours" : ""}`,
);
for (const e of errors) console.warn(`source error: ${e}`);

// Partial source failures are tolerated; losing every source is a failed run.
if (!kev.length && !nvd.length && !feeds.items.length) {
  console.error("all sources failed");
  process.exit(1);
}
markSuccess("alerts", now);
