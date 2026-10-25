// Monthly trends for the previous month, or --month YYYY-MM.
import { parseArgs } from "node:util";
import type { Alert } from "../alerts/match.js";
import { loadConfig } from "../config/load.js";
import type { DailyRun } from "../daily/pipeline.js";
import { sendEmail } from "../email/send.js";
import { makeLlm } from "../llm/index.js";
import { markSuccess } from "../state/health.js";
import { readAlerts, readDailies } from "../state/store.js";
import { renderMonthly } from "./render.js";
import { archiveItems, monthStats, verifyTrends } from "./trends.js";

const { values } = parseArgs({ options: { month: { type: "string" } } });
const now = new Date();
const month = values.month ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const cfg = loadConfig();
const llm = makeLlm(cfg);

const dailies = readDailies<DailyRun>(month);
const alerts = readAlerts<Alert>(month);
const stats = monthStats(month, dailies, alerts, cfg.sources.filter((s) => s.type === "rss").map((s) => s.name));
const archive = archiveItems(dailies);
const urls = new Map(
  dailies.flatMap((d) => [
    ...d.top.map((t) => [t.id, t.url] as const),
    ...(d.ai_briefs ?? []).map((b) => [b.id, b.url] as const),
    ...d.runners_up.map((r) => [r.id, r.url] as const),
  ]),
);

const out = archive.length >= 4 ? await llm.trends(archive, JSON.stringify(stats)) : null;
const trends = out ? verifyTrends(out, archive) : [];
const dropped = (out?.trends.length ?? 0) - trends.length;

console.log(await sendEmail(cfg.recipients, renderMonthly(stats, trends, out?.watch_next_month ?? [], archive, urls)));
console.log(`monthly ${month}: ${dailies.length} digests · ${archive.length} items · ${trends.length} trends (${dropped} dropped by V6) · US$${llm.usage.usd.toFixed(4)}`);
markSuccess("monthly", now);
