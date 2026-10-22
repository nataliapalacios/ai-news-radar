import type { Alert } from "../alerts/match.js";
import type { DailyRun } from "../daily/pipeline.js";
import type { ArchiveItem, Trends } from "../llm/types.js";

export interface MonthStats {
  month: string;
  days_with_digest: number;
  stories: { ai: number; security: number };
  alerts: { red: number; orange: number };
  watchlist_cves: string[];
  kev_additions: number;
  top_sources: [string, number][];
  quiet_sources: string[];
  usage_usd: number;
}

/** Counted in code, never by the model. */
export function monthStats(month: string, dailies: DailyRun[], alerts: Alert[], allSources: string[]): MonthStats {
  const items = dailies.flatMap((d) => d.top);
  const bySource = new Map<string, number>();
  for (const i of items) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  return {
    month,
    days_with_digest: dailies.length,
    stories: {
      ai: items.filter((i) => i.topic === "ai").length,
      security: items.filter((i) => i.topic === "security").length,
    },
    alerts: { red: alerts.filter((a) => a.level === "red").length, orange: alerts.filter((a) => a.level === "orange").length },
    watchlist_cves: [...new Set(alerts.flatMap((a) => (a.cve ? [a.cve] : [])))].sort(),
    kev_additions: alerts.filter((a) => a.reason === "kev").length,
    top_sources: [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 5),
    quiet_sources: allSources.filter((s) => !bySource.has(s)),
    usage_usd: dailies.reduce((t, d) => t + d.usage.usd, 0),
  };
}

/** Top stories plus runners-up: the archive the model may cite. */
export function archiveItems(dailies: DailyRun[]): ArchiveItem[] {
  return dailies.flatMap((d) => [
    ...d.top.map((t) => ({ id: t.id, date: d.date, title: t.title, source: t.source, topic: t.topic, why_it_matters: t.why_it_matters })),
    ...d.runners_up.map((r) => ({ id: r.id, date: d.date, title: r.title, source: r.source, topic: r.topic, why_it_matters: "" })),
  ]);
}

/** V6: a trend survives only if it cites at least two items that exist in the archive. */
export function verifyTrends(t: Trends, archive: ArchiveItem[]): Trends["trends"] {
  const ids = new Set(archive.map((a) => a.id));
  return t.trends
    .map((tr) => ({ ...tr, item_ids: [...new Set(tr.item_ids)].filter((id) => ids.has(id)) }))
    .filter((tr) => tr.item_ids.length >= 2);
}
