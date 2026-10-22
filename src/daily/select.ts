type Topic = "ai" | "security";

export interface Ranked {
  topic: Topic;
  total: number;
}

/**
 * Take the n best, but first reserve the best `min[topic]` of each topic.
 * Topics with too few candidates are reported as missing instead of padded.
 */
export function pickWithMix<T extends Ranked>(
  items: T[],
  n: number,
  min: Record<Topic, number>,
): { picked: T[]; missing: Topic[] } {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const picked: T[] = [];
  const missing: Topic[] = [];
  for (const topic of ["security", "ai"] as const) {
    const ofTopic = sorted.filter((i) => i.topic === topic).slice(0, min[topic]);
    if (ofTopic.length < min[topic]) missing.push(topic);
    picked.push(...ofTopic.slice(0, Math.max(0, n - picked.length)));
  }
  for (const i of sorted) {
    if (picked.length >= n) break;
    if (!picked.includes(i)) picked.push(i);
  }
  return { picked: picked.sort((a, b) => b.total - a.total), missing };
}
