// Phase 1 check: every configured source and vendor feed answers with valid data.
import { fetchKev } from "../collect/kev.js";
import { fetchNvd } from "../collect/nvd.js";
import { fetchFeed } from "../collect/rss.js";
import { allowedDomains, loadConfig } from "./load.js";

const cfg = loadConfig();
const allow = allowedDomains(cfg);
const checks = [
  ...cfg.sources.map((s) => ({ name: s.name, run: () => check(s.type, s.url, s.name) })),
  ...cfg.alerts.watchlist.flatMap((w) =>
    w.vendor_feed ? [{ name: `${w.name} vendor feed`, run: () => check("rss", w.vendor_feed!, w.name) }] : [],
  ),
];

async function check(type: string, url: string, name: string): Promise<string> {
  if (type === "kev") return `${(await fetchKev(url, allow)).length} KEV entries`;
  if (type === "nvd") {
    const end = new Date();
    const cves = await fetchNvd(url, allow, new Date(end.getTime() - 6 * 3_600_000), end, {
      apiKey: process.env.NVD_API_KEY,
    });
    return `${cves.length} CVEs in the last 6 h`;
  }
  const items = await fetchFeed({ name, url, tier: 2, topic: "security" }, allow);
  const dated = items.filter((i) => i.published).length;
  const newest = items.map((i) => i.published).filter(Boolean).sort().at(-1) ?? "none";
  return `${items.length} items, ${dated} dated, newest ${newest}`;
}

let failed = 0;
for (const c of checks) {
  try {
    console.log(`OK    ${c.name}: ${await c.run()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.name}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
