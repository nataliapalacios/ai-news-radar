/** V3: a quote counts only if it appears in the downloaded article text. */

const MIN_QUOTE_CHARS = 20;

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalize(quote).replace(/^["']|["']$/g, "").trim();
  return q.length >= MIN_QUOTE_CHARS && normalize(text).includes(q);
}

export interface Claim {
  text: string;
  quote: string;
}

export function verifyClaims<C extends Claim>(claims: C[], articleText: string): (C & { quote_verified: boolean })[] {
  return claims.map((c) => ({ ...c, quote_verified: quoteInText(c.quote, articleText) }));
}
