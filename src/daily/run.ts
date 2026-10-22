import type { Alert } from "../alerts/match.js";
import { fetchAllFeeds } from "../collect/rss.js";
import { allowedDomains, loadConfig } from "../config/load.js";
import { sendEmail } from "../email/send.js";
import { fetchArticle } from "../extract/article.js";
import { makeLlm } from "../llm/index.js";
import { markSuccess } from "../state/health.js";
import { dailyFile, readAlerts, writeJson } from "../state/store.js";
import { buildDaily, type DailyRun } from "./pipeline.js";
import { renderDaily } from "./render.js";

const now = new Date();
const cfg = loadConfig();
const allow = allowedDomains(cfg);
const llm = makeLlm(cfg);
const date = now.toISOString().slice(0, 10);

// Stories already sent as alerts in the last 24 h don't take a top-3 slot.
const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const recentAlerts = [...readAlerts<Alert>(prevMonth), ...readAlerts<Alert>(date.slice(0, 7))].filter(
  (a) => now.getTime() - new Date(a.detectedAt).getTime() <= 24 * 3_600_000,
);
const exclude = {
  urls: new Set(recentAlerts.flatMap((a) => a.reported.map((r) => r.url))),
  cves: new Set(recentAlerts.flatMap((a) => (a.cve ? [a.cve] : []))),
};

const feeds = await fetchAllFeeds(cfg.sources, allow);
if (!feeds.items.length) {
  console.error(`no feed items: ${feeds.errors.join("; ")}`);
  process.exit(1);
}
const deps = { cfg, allow, llm, now, fetchArticle: (url: string) => fetchArticle(url, allow, now) };

let windowHours = cfg.daily.window_hours;
const inWindow = (h: number) =>
  feeds.items.filter((i) => i.published && now.getTime() - new Date(i.published).getTime() <= h * 3_600_000).length;
if (now.getUTCDay() === 1 || inWindow(windowHours) < cfg.daily.thin_threshold) windowHours = cfg.daily.window_hours_if_thin;

const built = await buildDaily(feeds.items, windowHours, exclude, deps);
const run: DailyRun = {
  date,
  generated_at: now.toISOString(),
  window_hours: windowHours,
  ...built,
  alerts_24h: recentAlerts.map((a) => ({ level: a.level, product: a.product, cve: a.cve, subject_time: a.detectedAt })),
  source_errors: feeds.errors,
  usage: llm.usage,
};

writeJson(dailyFile(date), run);
console.log(await sendEmail(cfg.recipients, renderDaily(run, cfg.timezone)));
console.log(
  `daily: window ${windowHours} h · candidates ${run.candidates} · summarized ${run.summarized} · top ${run.top.length} · dropped ${run.dropped.length} · tokens ${llm.usage.input}/${llm.usage.output} · US$${llm.usage.usd.toFixed(4)}`,
);
for (const e of feeds.errors) console.warn(`source error: ${e}`);
markSuccess("daily", now);
