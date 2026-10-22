import { z } from "zod";
import { safeFetch } from "../net/fetch.js";

export const KevEntry = z.object({
  cveID: z.string(),
  vendorProject: z.string(),
  product: z.string(),
  vulnerabilityName: z.string(),
  dateAdded: z.string(),
  shortDescription: z.string(),
  requiredAction: z.string().optional().default(""),
  dueDate: z.string().optional().default(""),
  knownRansomwareCampaignUse: z.string().optional().default("Unknown"),
});
export type KevEntry = z.infer<typeof KevEntry>;

const KevCatalog = z.object({ vulnerabilities: z.array(KevEntry) });

export async function fetchKev(url: string, allow: string[]): Promise<KevEntry[]> {
  const res = await safeFetch(url, { allow, maxBytes: 20_000_000, timeoutMs: 30_000 });
  if (res.status !== 200) throw new Error(`CISA KEV: HTTP ${res.status}`);
  return KevCatalog.parse(JSON.parse(res.body)).vulnerabilities;
}
