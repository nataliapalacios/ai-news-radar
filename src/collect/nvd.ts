import { safeFetch } from "../net/fetch.js";

export interface NvdCve {
  id: string;
  published: string;
  description: string;
  cvss: number | null;
  /** "vendor:product" pairs from the CVE's CPE configurations. */
  cpes: string[];
  references: string[];
}

const PAGE = 2000;

export interface NvdQuery {
  keyword?: string;
  /** "vendor:product": only CVEs whose configurations match this CPE. */
  cpe?: string;
  apiKey?: string;
  by?: "published" | "modified";
}

/** One query per watchlist CPE (or keyword when an item has no CPE), paced for the public rate limit. */
export async function fetchNvdForWatchlist(
  baseUrl: string,
  allow: string[],
  watch: { match: string[]; cpe: string[] }[],
  start: Date,
  end: Date,
  opts: Pick<NvdQuery, "apiKey" | "by"> = {},
): Promise<NvdCve[]> {
  const queries = watch.flatMap((w): NvdQuery[] =>
    w.cpe.length ? w.cpe.map((cpe) => ({ cpe })) : w.match.map((keyword) => ({ keyword })),
  );
  const byId = new Map<string, NvdCve>();
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(opts.apiKey ? 700 : 6500);
    for (const c of await fetchNvd(baseUrl, allow, start, end, { ...opts, ...q })) byId.set(c.id, c);
  }
  return [...byId.values()];
}

/**
 * CVEs published (or, with by: "modified", changed) in [start, end]. NVD caps a range at 120 days and, without a key,
 * at 5 requests per 30 s; callers keep ranges short and calls few.
 */
export async function fetchNvd(
  baseUrl: string,
  allow: string[],
  start: Date,
  end: Date,
  opts: NvdQuery = {},
): Promise<NvdCve[]> {
  const out: NvdCve[] = [];
  for (let index = 0; ; index += PAGE) {
    const [from, to] = opts.by === "modified" ? ["lastModStartDate", "lastModEndDate"] : ["pubStartDate", "pubEndDate"];
    const q = new URLSearchParams({
      [from]: start.toISOString(),
      [to]: end.toISOString(),
      resultsPerPage: String(PAGE),
      startIndex: String(index),
    });
    if (opts.keyword) q.set("keywordSearch", opts.keyword);
    if (opts.cpe) q.set("virtualMatchString", `cpe:2.3:a:${opts.cpe}`);
    const res = await safeFetch(`${baseUrl}?${q}`, {
      allow,
      timeoutMs: 60_000,
      maxBytes: 60_000_000,
      headers: opts.apiKey ? { apiKey: opts.apiKey } : {},
    });
    if (res.status !== 200) throw new Error(`NVD: HTTP ${res.status}`);
    const page = JSON.parse(res.body) as { totalResults: number; vulnerabilities: { cve: RawCve }[] };
    out.push(...page.vulnerabilities.map((v) => toCve(v.cve)));
    if (index + PAGE >= page.totalResults) return out;
    await sleep(opts.apiKey ? 700 : 6500);
  }
}

interface RawCve {
  id: string;
  published: string;
  descriptions?: { lang: string; value: string }[];
  metrics?: Record<string, { cvssData?: { baseScore?: number } }[] | undefined>;
  configurations?: { nodes?: { cpeMatch?: { criteria?: string }[] }[] }[];
  references?: { url: string }[];
}

export function toCve(raw: RawCve): NvdCve {
  const m = raw.metrics ?? {};
  const scores = ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30"]
    .flatMap((k) => m[k] ?? [])
    .map((x) => x.cvssData?.baseScore)
    .filter((s): s is number => typeof s === "number");
  const cpes = new Set<string>();
  for (const c of raw.configurations ?? [])
    for (const n of c.nodes ?? [])
      for (const cm of n.cpeMatch ?? []) {
        const parts = cm.criteria?.split(":");
        if (parts && parts.length > 4) cpes.add(`${parts[3]}:${parts[4]}`.toLowerCase());
      }
  return {
    id: raw.id,
    published: new Date(`${raw.published.replace(/Z?$/, "Z")}`).toISOString(),
    description: raw.descriptions?.find((d) => d.lang === "en")?.value ?? "",
    cvss: scores.length ? Math.max(...scores) : null,
    cpes: [...cpes],
    references: (raw.references ?? []).map((r) => r.url).slice(0, 10),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
