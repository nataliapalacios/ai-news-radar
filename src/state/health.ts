import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/load.js";
import { esc, page } from "../email/html.js";
import { sendEmail } from "../email/send.js";
import { dataDir, writeJson } from "./store.js";

type Health = Record<string, { failures: number; lastOk: string | null }>;

const file = () => join(dataDir(), "health.json");
const read = (): Health => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {});

export function markSuccess(job: string, now = new Date()): void {
  const h = read();
  h[job] = { failures: 0, lastOk: now.toISOString() };
  writeJson(file(), h);
}

/** Count a failed run; on the second in a row, email a short "Radar is down" note. */
export async function markFailure(job: string): Promise<void> {
  const h = read();
  const entry = h[job] ?? { failures: 0, lastOk: null };
  entry.failures++;
  h[job] = entry;
  writeJson(file(), h);
  if (entry.failures !== 2) return;
  const cfg = loadConfig();
  const text = `The "${job}" job failed twice in a row. Last successful run: ${entry.lastOk ?? "never"}.\nNo email from Radar does not mean no news: check the GitHub Actions log.`;
  await sendEmail(cfg.recipients, {
    subject: `⚠️ [Radar] ${job} job is down`,
    text,
    html: page("Radar is down", `<p>${esc(text).replace(/\n/g, "<br>")}</p>`),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await markFailure(process.argv[2] ?? "unknown");
}
