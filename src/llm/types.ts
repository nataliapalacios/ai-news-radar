import { z } from "zod";

export const CRITERIA = ["impact", "actionability", "novelty", "authority", "relevance"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Record<Criterion, number>;

export const PrescoreOut = z.object({
  scores: z.array(z.object({
    id: z.string(),
    impact: z.number().int(),
    actionability: z.number().int(),
    novelty: z.number().int(),
    authority: z.number().int(),
    relevance: z.number().int(),
  })),
});

export const SummaryOut = z.object({
  title: z.string(),
  why_it_matters: z.string(),
  claims: z.array(z.object({ text: z.string(), quote: z.string() })),
  action: z.enum(["patch", "try", "read", "watch", "none"]),
  topic: z.enum(["ai", "security"]),
  cves: z.array(z.string()),
  flags: z.array(z.enum(["opinion", "vendor_marketing", "speculative"])),
});
export type Summary = z.infer<typeof SummaryOut>;

export const TrendsOut = z.object({
  trends: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    item_ids: z.array(z.string()),
  })),
  watch_next_month: z.array(z.string()),
});
export type Trends = z.infer<typeof TrendsOut>;

export interface Candidate {
  id: string;
  title: string;
  excerpt: string;
  source: string;
  tier: number;
  topic: "ai" | "security";
}

export interface ArchiveItem {
  id: string;
  date: string;
  title: string;
  source: string;
  topic: string;
  why_it_matters: string;
}

export interface Usage {
  input: number;
  output: number;
  usd: number;
}

export interface Llm {
  prescore(cands: Candidate[], focus: string[]): Promise<Map<string, Scores>>;
  /** null when the model declines or returns nothing usable. */
  summarize(c: Candidate, articleText: string): Promise<Summary | null>;
  trends(items: ArchiveItem[], stats: string): Promise<Trends | null>;
  usage: Usage;
}

export const clampScore = (n: number) => Math.max(0, Math.min(20, Math.round(n)));
