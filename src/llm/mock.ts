import type { ArchiveItem, Candidate, Llm, Scores, Summary, Trends, Usage } from "./types.js";

/**
 * Offline stand-in for Claude (MOCK_LLM=1): deterministic heuristics so the whole
 * pipeline, the lock and the emails can be exercised without an API key.
 */
export class MockLlm implements Llm {
  usage: Usage = { input: 0, output: 0, usd: 0 };

  async prescore(cands: Candidate[], focus: string[]): Promise<Map<string, Scores>> {
    const f = focus.map((k) => k.toLowerCase());
    return new Map(cands.map((c) => {
      const text = `${c.title} ${c.excerpt}`.toLowerCase();
      const hits = f.filter((k) => text.includes(k)).length;
      return [c.id, {
        impact: Math.min(20, 8 + hits * 3),
        actionability: /patch|update|fix|release|launch/.test(text) ? 15 : 8,
        novelty: 12,
        authority: c.tier === 1 ? 18 : 12,
        relevance: Math.min(20, hits * 5),
      }];
    }));
  }

  async summarize(c: Candidate, text: string): Promise<Summary | null> {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 300);
    if (!sentences.length) return null;
    const claims = sentences.slice(0, 2).map((s) => ({ text: s.slice(0, 120), quote: s }));
    return {
      title: c.title,
      why_it_matters: claims[0]!.text,
      claims,
      action: c.topic === "security" ? "patch" : "read",
      topic: c.topic,
      cves: [...new Set(text.match(/CVE-\d{4}-\d{4,7}/g) ?? [])].slice(0, 3),
      flags: [],
    };
  }

  async trends(items: ArchiveItem[]): Promise<Trends | null> {
    const byTopic = new Map<string, ArchiveItem[]>();
    for (const i of items) byTopic.set(i.topic, [...(byTopic.get(i.topic) ?? []), i]);
    return {
      trends: [...byTopic].filter(([, list]) => list.length >= 2).map(([topic, list]) => ({
        title: `${topic === "ai" ? "AI" : "Security"} stories this month`,
        summary: `${list.length} ${topic} stories made the digest, including "${list[0]!.title}".`,
        item_ids: list.slice(0, 3).map((i) => i.id),
      })),
      watch_next_month: [],
    };
  }
}
