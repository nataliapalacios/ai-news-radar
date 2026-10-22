import { esc, link, page } from "../email/html.js";
import type { Email } from "../email/send.js";
import type { DailyItem, DailyRun } from "./pipeline.js";

const ACTION: Record<string, string> = {
  patch: "Patch: a fix is available",
  try: "Try it",
  read: "Worth reading in full",
  watch: "Developing: keep an eye on it",
  none: "",
};

const fmtDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

export function renderDaily(run: DailyRun, tz: string): Email {
  const day = fmtDay(run.generated_at, tz);
  const lead = run.top[0]?.title ?? "No story passed verification today";
  const more = run.top.length > 1 ? ` + ${run.top.length - 1} more` : "";
  const footer = `Verified ${run.generated_at.slice(11, 16)} UTC · ${run.candidates} candidates · ${run.summarized} summarized · ${run.dropped.length} dropped`;

  const text: string[] = [];
  const html: string[] = [];
  if (run.alerts_24h.length) {
    const line = `🔴 Alerts in the last 24 h: ${run.alerts_24h.map((a) => `${a.product}${a.cve ? ` ${a.cve}` : ""}`).join(", ")} (see alert emails)`;
    text.push(line, "");
    html.push(`<p style="margin:0 0 16px;padding:8px 12px;background:#fef2f2;border-left:3px solid #b91c1c">${esc(line)}</p>`);
  }
  run.top.forEach((it, i) => {
    text.push(...itemText(it, i + 1, tz), "");
    html.push(itemHtml(it, i + 1, tz));
  });
  for (const t of run.missing_topics) {
    const line = `No ${t === "ai" ? "AI" : "security"} story passed verification today.`;
    text.push(line, "");
    html.push(`<p style="color:#6b7280">${esc(line)}</p>`);
  }
  if (run.runners_up.length) {
    text.push("Also on the radar:", ...run.runners_up.map((r) => `- ${r.title} (${r.source})\n  ${r.url}`), "");
    html.push(
      `<h3 style="margin:24px 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#4b5563">Also on the radar</h3>` +
      `<ul style="margin:0;padding-left:20px">${run.runners_up.map((r) => `<li>${link(r.title, r.url)} <span style="color:#6b7280">· ${esc(r.source)}</span></li>`).join("")}</ul>`,
    );
  }
  text.push("--", footer, "AI News Radar · summaries link to the original; every quote was checked against the article.");
  html.push(`<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${esc(footer)}<br>AI News Radar · summaries link to the original; every quote was checked against the article.</p>`);

  return { subject: `[Radar] ${day} · ${lead}${more}`, text: text.join("\n"), html: page(`Radar ${day}`, html.join("\n")) };
}

function itemText(it: DailyItem, n: number, tz: string): string[] {
  const out = [
    `${n} · ${it.topic.toUpperCase()} · ${it.title}`,
    `   ${it.source} · ${fmtDay(it.published, tz)}${it.also_covered_by.length ? ` · also covered by ${it.also_covered_by.length} outlet(s)` : ""}`,
    `   Why it matters: ${it.why_it_matters}`,
    ...it.claims.map((c) => `   Key fact: "${c.quote}"`),
  ];
  if (ACTION[it.action]) out.push(`   Action: ${ACTION[it.action]}`);
  if (it.flags.length) out.push(`   Note: ${it.flags.join(", ").replace(/_/g, " ")}`);
  out.push(`   Read: ${it.url}`);
  return out;
}

function itemHtml(it: DailyItem, n: number, tz: string): string {
  const color = it.topic === "security" ? "#b91c1c" : "#1d4ed8";
  const covered = it.also_covered_by.length
    ? ` · also covered by ${it.also_covered_by.map((o) => link(o.source, o.url)).join(", ")}`
    : "";
  return `<div style="margin:0 0 20px">
<div style="font-size:12px;font-weight:600;letter-spacing:.06em;color:${color}">${n} · ${esc(it.topic.toUpperCase())}</div>
<h2 style="margin:2px 0 4px;font-size:17px;line-height:1.35">${link(it.title, it.url)}</h2>
<div style="font-size:13px;color:#6b7280">${esc(it.source)} · ${esc(fmtDay(it.published, tz))}${covered}</div>
<p style="margin:8px 0">${esc(it.why_it_matters)}</p>
${it.claims.map((c) => `<blockquote style="margin:6px 0;padding:4px 10px;border-left:3px solid #d1d5db;color:#374151">“${esc(c.quote)}”</blockquote>`).join("")}
${ACTION[it.action] ? `<div style="font-size:13px;margin-top:6px"><strong>${esc(ACTION[it.action]!)}</strong></div>` : ""}
${it.flags.length ? `<div style="font-size:12px;color:#92400e">Note: ${esc(it.flags.join(", ").replace(/_/g, " "))}</div>` : ""}
</div>`;
}
