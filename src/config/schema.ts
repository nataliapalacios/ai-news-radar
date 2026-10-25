import { z } from "zod";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");

export const WatchItem = z.object({
  name: z.string().min(1),
  /** Terms matched on word boundaries against KEV, NVD descriptions and headlines. */
  match: z.array(z.string().min(2)).min(1),
  /** NVD CPE "vendor:product" pairs ("vendor:*" = any product). When set, an NVD CVE must list one of them. */
  cpe: z.array(z.string().regex(/^[^:*]+:[^:]+$/, "expected vendor:product")).default([]),
  /** Alert on critical NVD scores. Off for huge vendors, where only CISA KEV and news early signals alert. */
  nvd: z.boolean().default(true),
  vendor_feed: z.url().optional(),
});
export type WatchItem = z.infer<typeof WatchItem>;

export const Source = z.object({
  name: z.string().min(1),
  type: z.enum(["rss", "kev", "nvd"]),
  url: z.url().refine((u) => u.startsWith("https://"), "sources must use https"),
  /** Domain where the articles live, when the feed is hosted elsewhere (e.g. FeedBurner). */
  site: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  topic: z.enum(["ai", "security"]),
  /** For general feeds (a business school, a vendor blog): keep only items that match the topic keywords. */
  require_keywords: z.boolean().default(false),
});
export type Source = z.infer<typeof Source>;

export const Config = z.object({
  recipients: z.array(z.email()).min(1),
  timezone: z.string().default("UTC"),
  email_language: z.enum(["en"]).default("en"),
  alerts: z.object({
    every_hours: z.number().int().min(1).max(24).default(2),
    watchlist: z.array(WatchItem).min(1),
    cvss_min: z.number().min(0).max(10).default(9),
    severity_keywords: z.array(z.string().min(2)).min(1),
    early_signal_min_sources: z.number().int().min(1).default(2),
    kev_lookback_days: z.number().int().min(1).max(30).default(3),
    nvd_lookback_hours: z.number().int().min(1).max(168).default(6),
    quiet_hours: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).nullable().default(null),
  }),
  daily: z.object({
    send_at: hhmm.default("07:00"),
    top_n: z.number().int().min(1).max(10).default(3),
    window_hours: z.number().int().min(1).default(24),
    window_hours_if_thin: z.number().int().min(1).default(36),
    thin_threshold: z.number().int().min(1).default(10),
    summarize_n: z.number().int().min(1).max(12).default(6),
    min_per_topic: z.object({ ai: z.number().int().min(0), security: z.number().int().min(0) }),
    runners_up: z.number().int().min(0).max(10).default(5),
    /** "AI in brief" section: this many more AI stories, two lines each. 0 turns it off. */
    ai_briefs: z.number().int().min(0).max(10).default(5),
  }),
  topics: z.object({
    ai: z.object({ keywords: z.array(z.string()) }),
    security: z.object({ keywords: z.array(z.string()) }),
  }),
  sources: z.array(Source).min(1),
  blocked_domains: z.array(z.string()).default([]),
  models: z.object({
    daily: z.string().default("claude-haiku-5-5"),
    monthly: z.string().default("claude-sonnet-5-5"),
  }),
});
export type Config = z.infer<typeof Config>;
