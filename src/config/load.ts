import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { Config } from "./schema.js";

/** Load the config: $RADAR_CONFIG, else radar.config.yaml, else the example. */
export function loadConfig(path = process.env.RADAR_CONFIG): Config {
  const file =
    path ?? (existsSync("radar.config.yaml") ? "radar.config.yaml" : "radar.config.example.yaml");
  return parseConfig(readFileSync(file, "utf8"), file);
}

export function parseConfig(text: string, label = "config"): Config {
  const result = Config.safeParse(parse(text));
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid ${label}:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Every domain a run may fetch from: source hosts plus vendor feeds. */
export function allowedDomains(cfg: Config): string[] {
  const urls = [
    ...cfg.sources.map((s) => s.url),
    ...cfg.alerts.watchlist.flatMap((w) => (w.vendor_feed ? [w.vendor_feed] : [])),
  ];
  const sites = cfg.sources.flatMap((s) => (s.site ? [s.site] : []));
  return [...new Set([...urls.map((u) => baseDomain(new URL(u).hostname)), ...sites])];
}

/** Strip "www." and feed-only subdomains so articles on the main site are allowed. */
export function baseDomain(host: string): string {
  return host.replace(/^(www|feeds|rss|feed|services)\./, "");
}
