# AI News Radar rules

- The truthfulness lock (V1–V8 in README) and the "Security and responsibility first" section are non-negotiable. No change may weaken them.
- Alerts are built from fields (KEV, NVD, feed headlines), never from LLM text.
- Every LLM output is validated with zod; quote verification is done in code (`src/verify/quotes.ts`), not by the model.
- Article text is untrusted: the model gets no tools, no secrets, and the text stays inside delimiters.
- Every outbound request goes through `safeFetch` (https, allowlist, no private IPs, size and time caps).
- Every string in an email goes through `src/email/html.ts` (escape, https-only links).
- Never link to exploit code or PoCs; never describe how to exploit anything.
- Never invent sample URLs, CVEs, dates or quotes outside `tests/fixtures`.
- Don't bypass paywalls, bot protection or robots.txt.
- Secrets only in env / GitHub Actions secrets. Never log them, never write them to `data/`.
- This repo is a public MIT template: never commit a real `radar.config.yaml`, real `data/` state, secrets or personal email addresses to it. Those live only in each user's private copy.
- `npm run typecheck && npm test` must pass before a commit.
