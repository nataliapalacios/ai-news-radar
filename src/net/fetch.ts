import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const USER_AGENT = "Mozilla/5.0 (compatible; AINewsRadar/0.1; private news digest)";
const MAX_REDIRECTS = 5;

export interface FetchOptions {
  /** Domains the URL (and every redirect) must belong to. Empty = any public host. */
  allow: string[];
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  contentType: string;
}

export class BlockedUrlError extends Error {}

export function hostAllowed(host: string, allow: string[]): boolean {
  if (allow.length === 0) return true;
  const h = host.toLowerCase();
  return allow.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Loopback, private, link-local, CGNAT and other non-public ranges. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const p = ip.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

async function assertSafe(url: URL, allow: string[]): Promise<void> {
  if (url.protocol !== "https:") throw new BlockedUrlError(`not https: ${url.href}`);
  if (url.username || url.password) throw new BlockedUrlError(`credentials in URL: ${url.host}`);
  if (!hostAllowed(url.hostname, allow)) throw new BlockedUrlError(`domain not allowed: ${url.hostname}`);
  const addrs = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new BlockedUrlError(`resolves to a private address: ${url.hostname}`);
  }
}

/** HTTPS GET restricted to allowlisted public hosts, with a timeout and a size cap. */
export async function safeFetch(rawUrl: string, opts: FetchOptions): Promise<FetchResult> {
  const { allow, timeoutMs = 15_000, maxBytes = 5_000_000 } = opts;
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafe(url, allow);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT, accept: "*/*", ...opts.headers },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return {
      url: url.href,
      status: res.status,
      body: await readCapped(res, maxBytes),
      contentType: res.headers.get("content-type") ?? "",
    };
  }
  throw new BlockedUrlError(`too many redirects: ${rawUrl}`);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // A cut-off body would parse as broken XML/JSON; fail clearly instead.
      await reader.cancel();
      throw new Error(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const robotsCache = new Map<string, string[]>();

/** Minimal robots.txt check: Disallow prefixes under "User-agent: *". */
export async function robotsAllows(url: string, allow: string[]): Promise<boolean> {
  const u = new URL(url);
  let rules = robotsCache.get(u.origin);
  if (!rules) {
    rules = [];
    try {
      const res = await safeFetch(`${u.origin}/robots.txt`, { allow, timeoutMs: 8_000, maxBytes: 500_000 });
      if (res.status === 200) rules = parseRobots(res.body);
    } catch {
      // No robots.txt reachable: treat as allowed.
    }
    robotsCache.set(u.origin, rules);
  }
  return !rules.some((prefix) => u.pathname.startsWith(prefix));
}

export function parseRobots(text: string): string[] {
  const disallow: string[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      applies = lastWasAgent ? applies || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && key === "disallow" && value) disallow.push(value);
  }
  return disallow;
}
