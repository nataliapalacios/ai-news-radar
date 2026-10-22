import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SEEN_TTL_DAYS = 120;

export const dataDir = () => process.env.RADAR_DATA_DIR ?? "data";

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Keys already acted on (alert sent, item processed) with the time they were recorded. */
export class Seen {
  private map: Record<string, string>;
  private file = join(dataDir(), "seen.json");

  constructor() {
    this.map = readJson<Record<string, string>>(this.file, {});
  }

  has(key: string): boolean {
    return key in this.map;
  }

  add(key: string, at = new Date()): void {
    this.map[key] = at.toISOString();
  }

  save(now = new Date()): void {
    const cutoff = now.getTime() - SEEN_TTL_DAYS * 86_400_000;
    const kept = Object.fromEntries(
      Object.entries(this.map)
        .filter(([, t]) => new Date(t).getTime() >= cutoff)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    writeJson(this.file, kept);
  }
}

const month = (d: Date) => d.toISOString().slice(0, 7);

export function appendAlert(record: object, at = new Date()): void {
  const file = join(dataDir(), "alerts", `${month(at)}.jsonl`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
}

export function readAlerts<T>(yyyyMm: string): T[] {
  const file = join(dataDir(), "alerts", `${yyyyMm}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

export function dailyFile(date: string): string {
  return join(dataDir(), "daily", `${date}.json`);
}

export function readDailies<T>(yyyyMm: string): T[] {
  const dir = join(dataDir(), "daily");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(yyyyMm) && f.endsWith(".json"))
    .sort()
    .map((f) => readJson<T>(join(dir, f), null as T));
}
