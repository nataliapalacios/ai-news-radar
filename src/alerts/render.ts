import { esc, link, page } from "../email/html.js";
import type { Email } from "../email/send.js";
import type { Alert } from "./match.js";

const WHY: Record<Alert["reason"], string> = {
  kev: "actively exploited (CISA KEV)",
  cvss: "critical severity (NVD)",
  tier1_source: "reported by a primary source",
  multi_source: "reported by several sources",
};

export function alertSubject(a: Alert): string {
  if (a.level === "red") {
    const what = a.reason === "cvss" && a.cvss !== null ? `critical (CVSS ${a.cvss.toFixed(1)})` : WHY[a.reason];
    return `🔴 [Radar] ${a.product}: ${a.cve} ${what}`;
  }
  return `🟠 [Radar] Early signal: ${a.product}${a.cve ? ` ${a.cve}` : ""}, ${WHY[a.reason]}`;
}

export function renderAlerts(alerts: Alert[]): Email {
  const [first] = alerts;
  if (!first) throw new Error("no alerts to render");
  const more = alerts.length > 1 ? ` (+${alerts.length - 1} more)` : "";
  return {
    subject: alertSubject(first) + more,
    text: alerts.map(alertText).join("\n\n----------\n\n") + FOOTER_TEXT,
    html: page("Radar alert", alerts.map(alertHtml).join('<hr style="border:0;border-top:1px solid #e5e7eb;margin:20px 0">') + FOOTER_HTML),
  };
}

function headline(a: Alert): string {
  return a.level === "red"
    ? `🔴 CONFIRMED · ${a.product}${a.cve ? ` · ${a.cve}` : ""}`
    : `🟠 EARLY SIGNAL (not confirmed) · ${a.product}${a.cve ? ` · ${a.cve}` : ""}`;
}

function alertText(a: Alert): string {
  const lines = [headline(a), ""];
  if (a.supersedes) lines.push("This confirms an early signal sent earlier.", "");
  if (a.confirmed.length) lines.push("What's confirmed:", ...a.confirmed.map((c) => `- ${c}`), "");
  if (a.description) lines.push("Official description:", a.description, "");
  if (a.reported.length)
    lines.push(
      a.level === "orange" ? "What's reported (not yet confirmed by CISA or NVD):" : "Also reported:",
      ...a.reported.map((r) => `- ${r.source}: ${r.title}\n  ${r.url}`),
      "",
    );
  if (a.links.length) lines.push("Fix, advisory and references:", ...a.links.map((l) => `- ${l.label}: ${l.url}`));
  return lines.join("\n");
}

function alertHtml(a: Alert): string {
  const color = a.level === "red" ? "#b91c1c" : "#b45309";
  const parts = [`<h2 style="margin:0 0 12px;font-size:18px;color:${color}">${esc(headline(a))}</h2>`];
  if (a.supersedes) parts.push(`<p style="margin:0 0 12px">This confirms an early signal sent earlier.</p>`);
  if (a.confirmed.length)
    parts.push(section("What's confirmed", `<ul style="margin:0;padding-left:20px">${a.confirmed.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`));
  if (a.description) parts.push(section("Official description", `<p style="margin:0">${esc(a.description)}</p>`));
  if (a.reported.length)
    parts.push(section(
      a.level === "orange" ? "What's reported (not yet confirmed by CISA or NVD)" : "Also reported",
      `<ul style="margin:0;padding-left:20px">${a.reported.map((r) => `<li>${esc(r.source)}: ${link(r.title, r.url)}</li>`).join("")}</ul>`,
    ));
  if (a.links.length)
    parts.push(section("Fix, advisory and references", `<ul style="margin:0;padding-left:20px">${a.links.map((l) => `<li>${link(l.label, l.url)}</li>`).join("")}</ul>`));
  return parts.join("\n");
}

function section(title: string, body: string): string {
  return `<h3 style="margin:16px 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#4b5563">${esc(title)}</h3>${body}`;
}

const FOOTER_TEXT =
  "\n\n--\nAI News Radar · defensive use only: links point to advisories and fixes, never to exploit code.\nCheck your vendor's advisory before acting.";
const FOOTER_HTML = `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">AI News Radar · defensive use only: links point to advisories and fixes, never to exploit code. Check your vendor's advisory before acting.</p>`;
