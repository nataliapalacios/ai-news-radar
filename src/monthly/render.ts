import { esc, link, page } from "../email/html.js";
import type { Email } from "../email/send.js";
import type { ArchiveItem, Trends } from "../llm/types.js";
import type { MonthStats } from "./trends.js";

export function renderMonthly(
  stats: MonthStats,
  trends: Trends["trends"],
  watchNext: string[],
  archive: ArchiveItem[],
  urls: Map<string, string>,
): Email {
  const label = new Date(`${stats.month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const byId = new Map(archive.map((a) => [a.id, a]));
  const statLines = [
    `Digests sent: ${stats.days_with_digest}`,
    `Top stories: ${stats.stories.security} security · ${stats.stories.ai} AI`,
    `Alerts: ${stats.alerts.red} confirmed · ${stats.alerts.orange} early signals`,
    `Watchlist CVEs: ${stats.watchlist_cves.length ? stats.watchlist_cves.join(", ") : "none"}`,
    `CISA KEV additions on your watchlist: ${stats.kev_additions}`,
    `Sources that contributed most: ${stats.top_sources.map(([s, n]) => `${s} (${n})`).join(", ") || "n/a"}`,
    `Sources with no top story: ${stats.quiet_sources.join(", ") || "none"}`,
    `Model cost this month: US$${stats.usage_usd.toFixed(2)}`,
  ];

  const text: string[] = [`${label}: ${trends.length} trends`, ""];
  const html: string[] = [`<h1 style="margin:0 0 16px;font-size:20px">${esc(label)}</h1>`];
  if (!trends.length) {
    const line = "Not enough verified stories this month to back a trend. The stats below are complete.";
    text.push(line, "");
    html.push(`<p>${esc(line)}</p>`);
  }
  trends.forEach((t, i) => {
    const cited = t.item_ids.map((id) => byId.get(id)!).filter(Boolean);
    text.push(`${i + 1}. ${t.title}`, `   ${t.summary}`, ...cited.map((c) => `   - ${c.title} (${c.source}, ${c.date}) ${urls.get(c.id) ?? ""}`), "");
    html.push(`<div style="margin:0 0 18px"><h2 style="margin:0 0 4px;font-size:17px">${i + 1}. ${esc(t.title)}</h2><p style="margin:0 0 6px">${esc(t.summary)}</p>
<ul style="margin:0;padding-left:20px;font-size:14px">${cited.map((c) => `<li>${urls.get(c.id) ? link(c.title, urls.get(c.id)!) : esc(c.title)} <span style="color:#6b7280">· ${esc(c.source)}, ${esc(c.date)}</span></li>`).join("")}</ul></div>`);
  });
  if (watchNext.length) {
    text.push("Watch next month:", ...watchNext.map((w) => `- ${w}`), "");
    html.push(`<h3 style="margin:20px 0 6px;font-size:14px;text-transform:uppercase;color:#4b5563">Watch next month</h3><ul style="margin:0;padding-left:20px">${watchNext.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`);
  }
  text.push("The numbers (counted, not generated):", ...statLines.map((s) => `- ${s}`), "", "--", "AI News Radar · every trend cites stories you received this month.");
  html.push(
    `<h3 style="margin:20px 0 6px;font-size:14px;text-transform:uppercase;color:#4b5563">The numbers (counted, not generated)</h3><ul style="margin:0;padding-left:20px">${statLines.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`,
    `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">AI News Radar · every trend cites stories you received this month.</p>`,
  );
  return { subject: `[Radar] ${label} · ${trends.length} trends`, text: text.join("\n"), html: page(`Radar ${label}`, html.join("\n")) };
}
