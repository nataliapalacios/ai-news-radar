import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { robotsAllows, safeFetch } from "../net/fetch.js";

export interface Article {
  url: string;
  canonical: string;
  title: string;
  text: string;
  published: string | null;
  lang: string | null;
  httpStatus: number;
  textHash: string;
  verifiedAt: string;
  /** Too little text to verify anything: paywall, consent wall or a JS-only page. */
  paywall: boolean;
}

export type DropReason =
  | "url_unreachable" | "robots_disallowed" | "no_date" | "source_not_approved" | "blocked_domain"
  | "duplicate" | "no_verifiable_quote" | "invalid_output" | "paywall" | "out_of_window";

export class Dropped extends Error {
  constructor(public reason: DropReason, detail = "") {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

const MIN_TEXT_CHARS = 600;

/** V1 + V2 + V8: fetch the live page, read its text and dates, record the audit trail. */
export async function fetchArticle(url: string, allow: string[], now = new Date()): Promise<Article> {
  if (!(await robotsAllows(url, allow))) throw new Dropped("robots_disallowed", url);
  let res;
  try {
    res = await safeFetch(url, { allow });
  } catch (e) {
    throw new Dropped("url_unreachable", (e as Error).message);
  }
  if (res.status !== 200) throw new Dropped("url_unreachable", `HTTP ${res.status}`);
  return { ...extractArticle(res.body, res.url), httpStatus: res.status, verifiedAt: now.toISOString() };
}

export function extractArticle(html: string, url: string): Omit<Article, "httpStatus" | "verifiedAt"> {
  // jsdom never runs page scripts or loads subresources unless asked to; we don't ask.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const published =
    toIso(meta('meta[property="article:published_time"]')) ??
    toIso(meta('meta[name="article:published_time"]')) ??
    toIso(jsonLdDate(doc)) ??
    toIso(meta('meta[name="date"]') ?? meta('meta[name="pubdate"]') ?? meta('meta[itemprop="datePublished"]')) ??
    toIso(doc.querySelector("time[datetime]")?.getAttribute("datetime") ?? null);
  const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const lang = doc.documentElement.getAttribute("lang");
  const parsed = new Readability(doc).parse();
  const text = (parsed?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return {
    url,
    canonical: canonicalHref ? new URL(canonicalHref, url).href : url,
    title: (parsed?.title ?? doc.title ?? "").trim(),
    text,
    published,
    lang: lang ? lang.slice(0, 2).toLowerCase() : null,
    textHash: createHash("sha256").update(text).digest("hex"),
    paywall: text.length < MIN_TEXT_CHARS,
  };
}

function jsonLdDate(doc: Document): string | null {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findKey(JSON.parse(s.textContent ?? ""), "datePublished");
      if (found) return found;
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return null;
}

function findKey(node: unknown, key: string): string | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findKey(n, key);
      if (r) return r;
    }
  } else if (node && typeof node === "object") {
    const v = (node as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
    for (const child of Object.values(node)) {
      const r = findKey(child, key);
      if (r) return r;
    }
  }
  return null;
}

function toIso(d: string | null): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
