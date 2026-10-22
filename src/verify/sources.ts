import { Dropped } from "../extract/article.js";

const under = (host: string, domains: string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

/** V4: only allowlisted domains, never blocked ones. An empty allowlist approves nothing. */
export function assertApproved(url: string, allow: string[], blocked: string[]): void {
  const host = new URL(url).hostname.toLowerCase();
  if (under(host, blocked)) throw new Dropped("blocked_domain", host);
  if (!under(host, allow)) throw new Dropped("source_not_approved", host);
}
