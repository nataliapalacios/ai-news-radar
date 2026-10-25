# AI News Radar

**A personal radar for AI and cybersecurity news: an urgent alert when something on your stack is under attack, the top 3 stories every morning, and the month's trends on the 1st.**

Most newsletters either flood you or reach you a day late. AI News Radar reads a fixed list of trusted sources, **checks that every fact it quotes exists in a real article**, and emails you only three things:

| Email | When | What |
|---|---|---|
| 🔴 **Alert** | Within ~2 h of the signal | A vulnerability that hits your watchlist (e.g. PHP, WordPress, OpenSSL) is actively exploited, critical, or being reported by several trusted sources |
| ☀️ **Daily top 3 + AI in brief** | Every morning | The 3 stories worth your time from the last 24 h (at least one AI, at least one security), then 5 more AI stories in two lines each |
| 📈 **Monthly trends** | The 1st of each month | 3–5 trends from the month, each backed by the stories that prove it |

It is unbranded and built for one person or a small team that wants to stay current without reading 40 feeds. It runs on GitHub Actions and costs **under US$0.50 a month** (see [Costs](#costs)).

> **Bring your own keys.** Open source under MIT. Each person runs their own private copy with their own Claude API key and email account: there's no shared server, and nobody pays for anyone else's usage. Start at [Get your own copy](#get-your-own-copy-about-15-minutes).

---

## Security and responsibility first

A tool that watches for vulnerabilities must not become one. These rules sit above every feature, and the build plan won't ship a phase that breaks them.

**The tool itself**

| Risk | Control |
|---|---|
| The watchlist shows exactly what you run | Lives only in your **private** copy; never in this public repo, logs, or public issues |
| Leaked secrets | API key and SMTP password only in GitHub Actions secrets; never in config, code, logs or `data/`; a scoped API key with a monthly spend limit; Gmail **App Password**, not the account password |
| Fetching untrusted URLs (SSRF) | Only allowlisted domains over HTTPS; private/loopback IPs blocked; redirect limit; timeout and response-size cap |
| Prompt injection from article text | Article text is passed as data inside delimiters; the model has **no tools**, no web access and no secrets; its output is schema-validated and quotes are checked in code |
| Malicious content in emails | All text is HTML-escaped; links are plain `https` only; no remote images, no tracking pixels, no attachments |
| Supply chain | Lockfile committed, `npm ci` with exact versions, `npm audit` in CI, Dependabot alerts on; third-party Actions pinned to a commit SHA |
| Over-privileged CI | Workflows run with `permissions: contents: write` only, no `pull_request_target`, `concurrency` to avoid overlapping runs; branch protection on `main` |
| Silent failure | If a job fails twice in a row you get a short "Radar is down" email: no news is never mistaken for good news |

**What it sends**

- **Defensive only.** Alerts link to the vendor advisory, CISA and the fix. They never link to or summarize exploit code or proof-of-concept repos, and they never include attack steps.
- **Confirmed vs reported is always labeled.** An early signal is never worded as a confirmed exploitation.
- **Summaries, not copies.** Short summaries with a link to the original; `robots.txt`, site terms and paywalls are respected.
- **Data minimization.** It stores item IDs, URLs, titles, quotes and hashes, nothing about readers. Personal data that appears in articles is not stored separately.
- **No false calm.** The tool supports patching decisions; it doesn't replace your vendor advisories, asset inventory or incident process.

---

## Why

A critical vulnerability gets disclosed, it's exploited in the wild within days, and you hear about it from a colleague, a client or a vendor email. By then the window to patch calmly is gone. The same happens in AI, just with less urgency: a model release or a regulation lands, and you learn about it a week later from LinkedIn.

The fix doesn't need a smarter feed. It needs:
1. **A separate fast lane for "act now" news** about the software you actually run.
2. **A hard cap of 3 stories a day**, so the email gets read.
3. **Zero invented facts**, because a summary that's slightly wrong about a CVE is worse than none.

---

## How it works

Three jobs, each one a GitHub Actions workflow. They share sources, the truthfulness lock and the state in `data/`.

```
                 ┌──────────────── sources (allowlist) ────────────────┐
                 │  CISA KEV · NVD · vendor security feeds · news RSS  │
                 └─────────────────────────┬───────────────────────────┘
                                           │
     ┌─────────────────────────────────────┼──────────────────────────────────────┐
     ▼                                     ▼                                      ▼
 ALERTS (every 2 h, no LLM)        DAILY (every morning)                 MONTHLY (1st, 08:00)
 match watchlist                   collect last 24 h                     read data/daily + data/alerts
   ├─ in CISA KEV        → 🔴      extract + verify (V1–V5)              Sonnet: 3–5 trends
   ├─ CVSS ≥ 9.0         → 🔴      Haiku: score titles (cheap pass)      each trend cites ≥ 2 item IDs
   └─ ≥ 2 sources or               Haiku: summarize top 6 with quotes    code checks the IDs (V6)
      1 vendor/CISA      → 🟠      verify quotes (V3)                    send email
 dedupe by CVE                     pick top 3 (mix rules)
 send email                        send email, save JSON
     │                                     │                                      │
     └──────────────► commit state to data/ (seen IDs, daily JSON, alert log) ◄───┘
```

### 1. Alerts: the fast lane (no LLM, US$0)

Runs every 2 hours. It's pure code, so it's free, deterministic and fast.

| Level | Rule | Example |
|---|---|---|
| 🔴 **Confirmed** | A watchlist product appears in a new [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) entry, **or** a new NVD CVE for that product has CVSS ≥ `cvss_min` | "PHP: CVE-XXXX-YYYY added to CISA KEV (actively exploited)" |
| 🟠 **Early signal** | A watchlist term + a severity keyword (`RCE`, `zero-day`, `actively exploited`, `critical`…) show up in **≥ 2 approved sources** within 24 h, **or** in 1 tier-1 source (vendor advisory, CISA, national CERT) | Before NVD scores it, two outlets report a PHP RCE being exploited |

- One CVE produces at most one 🔴 email and one 🟠 email. An early signal that later becomes confirmed is sent again as 🔴 and points back to the first email.
- Every alert includes: product, CVE (if known), what is confirmed vs reported, source links, and the vendor's fix/advisory link when one exists.
- Quiet hours are optional. 🔴 always goes out.

**Why not wait for NVD?** NVD scoring often lags the news by days. The 🟠 lane is what would have told you about a PHP issue before the email from your provider did. That's the hypothesis to validate (see [Validation](#validation-plan-2-weeks)).

### 2. Daily top 3

1. **Collect** RSS items published in the last 24 h (36 h on Mondays, or if there are fewer than 10 candidates).
2. **Extract** clean text, date, outlet and canonical URL.
3. **Filter and verify**: allowlist, live URL, real date, dedupe. The same story from 5 outlets becomes 1 item listed as "also covered by".
4. **Cheap pass:** Haiku scores all candidates from title + excerpt only (one call).
5. **Summarize** the top 6 with full text. Each claim comes with a verbatim quote, and the code checks the quote is in the article.
6. **Select** the top 3 with the mix rules.
7. **AI in brief:** the next 5 AI stories by score, each as *why it matters* + one verified fact + link. If a page blocks automated reading, the brief can be written from the publisher's own feed summary, and its quote is checked against that text instead; those never reach the top 3.
8. Send the email and save `data/daily/YYYY-MM-DD.json`.

#### Scoring rubric (0–20 each, configurable)

| Criterion | Question |
|---|---|
| `impact` | How many people or organizations does this affect? |
| `actionability` | Is there something to do: patch, try, decide, prepare? |
| `novelty` | Is this the first report, or a rehash of last week? |
| `authority` | Primary source (vendor, lab, regulator, researcher) or commentary? |
| `relevance` | Does it touch my watchlist or my focus keywords? |

**Mix rules:** at least `min_per_topic.ai` AI items and `min_per_topic.security` security items. If no candidate qualifies for a topic, the email says so instead of padding. A story already sent as an alert can't take a top-3 slot. It goes to a one-line "Alerts in the last 24 h" box instead.

### 3. Monthly trends

On the 1st, Sonnet reads the month's archive: every daily item (top 3 + runners-up) and every alert. It returns 3–5 trends. **Each trend has to cite at least 2 item IDs from the archive**, and the code drops any trend that cites IDs that don't exist. The numbers in the email (stories per topic, watchlist CVEs, KEV additions, top sources) are counted in code, not by the model.

---

## Truthfulness lock (non-negotiable)

Adapted from a content-curation product I'm developing. Each rule has an automated test.

| # | Rule | How | If it fails |
|---|---|---|---|
| V1 | The link exists | `GET` during the run, 200 after redirects | Dropped: `url_unreachable` |
| V2 | Date and outlet come from the source | From the feed, `article:published_time`, JSON-LD or `<time>`; never inferred | Dropped: `no_date` |
| V3 | Every claim has a verbatim quote | The model returns claim + exact sentence; the code checks the sentence appears in the downloaded text (normalized whitespace, quotes, dashes) | Claim removed; if none are left: `no_verifiable_quote` |
| V4 | Approved sources only | Domain allowlist in config | Dropped: `source_not_approved` |
| V5 | No duplicates | Canonical URL + title similarity + same CVE ID → one item with "also covered by" | Merged |
| V6 | Trends cite real items | Each monthly trend references ≥ 2 existing item IDs | Trend dropped |
| V7 | Alerts only state what sources state | Alert text is built from fields (product, CVE, KEV flag, CVSS, source titles); no LLM | — |
| V8 | Visible audit trail | Each item stores `verified_at`, HTTP status, text hash and quotes; the email shows "Verified 07:02 UTC" | — |

Paywalled articles are title-only and flagged `paywall`. Their claims can't be verified, so they can't make the top 3.

---

## Configuration

One file, `radar.config.yaml`. The example below has generic values. Your real watchlist shows what you run, so it only goes in your **private** copy (see [Privacy](#privacy-and-responsible-use)).

```yaml
recipients: [you@example.com]
timezone: Europe/Madrid
email_language: en

alerts:
  every_hours: 2
  watchlist:   # platforms almost everyone runs. nvd: false = only CISA KEV + news early signals (too many CVEs otherwise)
    - { name: Microsoft,     match: [microsoft, windows, exchange server, sharepoint], nvd: false }
    - { name: Apple,         match: [apple, iphone, macos], nvd: false }
    - { name: Android,       match: [android], nvd: false }
    - { name: Google Chrome, match: [chrome, chromium], nvd: false }   # auto-updates; ~90 CVEs at 9.6 per month
    - { name: Linux kernel,  match: [linux kernel], cpe: ["linux:linux_kernel"] }
    - { name: Cisco,         match: [cisco], cpe: ["cisco:*"] }
    - { name: Fortinet,      match: [fortinet, fortigate], cpe: ["fortinet:*"] }
    - { name: Ivanti,        match: [ivanti], cpe: ["ivanti:*"] }
    - { name: VMware,        match: [vmware, esxi], cpe: ["vmware:*"] }
    - { name: Citrix,        match: [citrix, netscaler], cpe: ["citrix:*"] }
    - { name: Palo Alto,     match: [palo alto networks, pan-os], cpe: ["paloaltonetworks:*"] }
    - { name: OpenSSL,       match: [openssl], cpe: ["openssl:openssl"] }
    - { name: PHP,           match: [php], cpe: ["php:php"], vendor_feed: "https://www.php.net/feed.atom" }
    - { name: WordPress,     match: [wordpress], cpe: ["wordpress:wordpress"] }
  cvss_min: 9.0
  severity_keywords: [RCE, remote code execution, zero-day, 0-day, actively exploited, exploited in the wild, critical, wormable]
  early_signal_min_sources: 2
  kev_lookback_days: 3
  nvd_lookback_hours: 6
  quiet_hours: null

daily:
  send_at: "07:00"
  top_n: 3
  window_hours: 24
  window_hours_if_thin: 36
  thin_threshold: 10
  summarize_n: 6
  min_per_topic: { ai: 1, security: 1 }
  runners_up: 5
  ai_briefs: 5                 # "AI in brief": 5 more AI stories, 2 lines each (0 = off)

topics:
  ai:
    keywords: [AI, artificial intelligence, machine learning, deep learning, LLM, language model, foundation model, generative AI, GenAI, GPT, Gemini, Claude, Llama, chatbot, AI agent, agentic, AI model, open-weights, AI regulation, AI Act, AI safety, AI governance]
  security:
    keywords: [vulnerability, CVE, ransomware, breach, zero-day, patch, supply chain, malware, exploit]

sources:
  # tier 1: primary / authoritative
  - { name: CISA KEV,           type: kev, url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", tier: 1, topic: security }
  - { name: NVD,                type: nvd, url: "https://services.nvd.nist.gov/rest/json/cves/2.0", tier: 1, topic: security }
  - { name: CISA Advisories,    type: rss, url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", tier: 1, topic: security }
  - { name: Hugging Face Blog,  type: rss, url: "https://huggingface.co/blog/feed.xml", tier: 1, topic: ai }
  - { name: Google DeepMind,    type: rss, url: "https://deepmind.google/blog/rss.xml", tier: 1, topic: ai }
  - { name: OpenAI News,        type: rss, url: "https://openai.com/news/rss.xml", tier: 1, topic: ai }
  # tier 2: specialist press
  - { name: BleepingComputer,   type: rss, url: "https://www.bleepingcomputer.com/feed/", tier: 2, topic: security }
  - { name: The Hacker News,    type: rss, url: "https://feeds.feedburner.com/TheHackersNews", site: thehackernews.com, tier: 2, topic: security }
  - { name: SecurityWeek,       type: rss, url: "https://www.securityweek.com/feed/", tier: 2, topic: security }
  - { name: Krebs on Security,  type: rss, url: "https://krebsonsecurity.com/feed/", tier: 2, topic: security }
  - { name: MIT Tech Review AI, type: rss, url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", tier: 2, topic: ai }
  # AI: research and business schools
  - { name: MIT News AI,              type: rss, url: "https://news.mit.edu/rss/topic/artificial-intelligence2", tier: 1, topic: ai }
  - { name: MIT Sloan Management Review, type: rss, url: "https://sloanreview.mit.edu/tag/artificial-intelligence/feed/", tier: 2, topic: ai }
  - { name: HBS Working Knowledge,    type: rss, url: "https://hbswk.hbs.edu/rss/rss.xml", site: hbs.edu, tier: 2, topic: ai, require_keywords: true }
  - { name: Harvard Gazette,          type: rss, url: "https://news.harvard.edu/gazette/section/science-technology/feed/", tier: 2, topic: ai, require_keywords: true }
  - { name: IEEE Spectrum AI,         type: rss, url: "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss", tier: 2, topic: ai }
  # AI: tech press (most daily volume)
  - { name: The Verge AI,             type: rss, url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", tier: 2, topic: ai }
  - { name: TechCrunch AI,            type: rss, url: "https://techcrunch.com/category/artificial-intelligence/feed/", tier: 2, topic: ai }
  - { name: Ars Technica AI,          type: rss, url: "https://arstechnica.com/ai/feed/", tier: 2, topic: ai }
  - { name: Wired AI,                 type: rss, url: "https://www.wired.com/feed/tag/ai/latest/rss", tier: 2, topic: ai }
  # AI: vendor blogs (only AI posts)
  - { name: Google AI blog,           type: rss, url: "https://blog.google/technology/ai/rss/", tier: 1, topic: ai }
  - { name: NVIDIA blog,              type: rss, url: "https://blogs.nvidia.com/feed/", tier: 1, topic: ai, require_keywords: true }

blocked_domains: []

models:
  daily: claude-haiku-5-5
  monthly: claude-sonnet-5-5
```

---

## Architecture

The goal is to keep the MVP as small as possible: no server, no database, no UI.

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22.22+ / 24), run with `tsx` | Same stack as my curation product, so the verify code can be shared |
| Scheduler | GitHub Actions (`alerts.yml`, `daily.yml`, `monthly.yml`) | Free, no server, logs included |
| State | JSON/JSONL files in `data/`, committed by the workflow | Gives the monthly job its history, makes alerts dedupable, and every run is diffable in git |
| LLM | Claude API (`@anthropic-ai/sdk`), structured outputs + `zod` | Haiku for daily, Sonnet once a month |
| RSS | `rss-parser` | |
| Extraction | `@mozilla/readability` + `jsdom` | |
| Email | `nodemailer` + Gmail SMTP (App Password) | US$0; swap for Resend if needed |
| Tests | `vitest` with saved HTML fixtures | |

### Repo layout

```
ai-news-radar/
├─ README.md · CLAUDE.md · SECURITY.md · LICENSE (MIT)
├─ radar.config.example.yaml     # generic; your real one is radar.config.yaml
├─ .github/
│  ├─ workflows/
│  │  ├─ alerts.yml      # cron: every 2 h
│  │  ├─ daily.yml       # cron: 05:00 UTC (07:00 Madrid in summer, 06:00 in winter)
│  │  ├─ monthly.yml     # cron: 1st of month, 06:00 UTC
│  │  └─ ci.yml          # typecheck, tests, npm audit on every push
│  └─ dependabot.yml
├─ src/
│  ├─ config/    schema.ts, load.ts, check-sources.ts
│  ├─ net/       fetch.ts            ← safeFetch: https, allowlist, no private IPs, caps, robots.txt
│  ├─ collect/   rss.ts, kev.ts, nvd.ts
│  ├─ extract/   article.ts          ← V1, V2, V8
│  ├─ verify/    quotes.ts, sources.ts, dedupe.ts   ← V3, V4, V5
│  ├─ alerts/    match.ts, render.ts, run.ts, replay.ts
│  ├─ daily/     pipeline.ts, select.ts, render.ts, run.ts
│  ├─ monthly/   trends.ts, render.ts, run.ts       ← V6
│  ├─ llm/       claude.ts, mock.ts, types.ts
│  ├─ email/     html.ts (escaping), send.ts
│  └─ state/     store.ts, health.ts
├─ data/                       # committed by the workflows
│  ├─ seen.json                # alert keys and URLs already sent
│  ├─ health.json              # consecutive failures per job
│  ├─ alerts/2026-10.jsonl
│  └─ daily/2026-10-23.json
└─ tests/                      # vitest; fixtures are synthetic HTML
```

### LLM output contract (daily summary)

```json
{
  "id": "2026-10-23-bleepingcomputer-xyz",
  "title": "string, exactly as on the page",
  "why_it_matters": "1 sentence, only facts present in claims",
  "claims": [
    { "text": "short factual claim", "quote": "sentence copied verbatim from the article" }
  ],
  "action": "patch | try | read | watch | none",
  "topic": "ai | security",
  "cves": ["CVE-XXXX-YYYY"],
  "flags": ["opinion", "vendor_marketing"]
}
```

The code decides `quote_verified`, not the model. If Haiku returns `stop_reason: "refusal"` (it can happen with offensive-security write-ups) or invalid output, the story is dropped from the top 3 with reason `invalid_output`; it can still appear as a headline in "Also on the radar".

---

## Email formats

**Daily** · subject: `[Radar] Thu 23 Oct · <top headline> + 2 more`

```
🔴 Alerts in the last 24 h: 1 (PHP CVE-XXXX-YYYY, see alert email at 03:12)

1 · SECURITY · <Title>
   <Outlet> · 22 Oct · also covered by 3 outlets
   Why it matters: <one sentence>
   Key fact: "<verbatim quote>"
   Action: patch → <vendor advisory link>
   Read: <link>

2 · AI · <Title> …
3 · …

AI in brief: 5 AI stories, each with a link and two lines (why it matters + one verified fact)

Also on the radar: 5 one-line headlines with links
Verified 05:02 UTC · 41 candidates · 6 summarized · 7 dropped (see run log)
```

**Alert** · subject: `🔴 [Radar] PHP — CVE-XXXX-YYYY actively exploited (CISA KEV)`
Has these blocks: what's confirmed · what's only reported · affected versions (if the source states them) · fix / advisory · sources.

**Monthly** · subject: `[Radar] October 2026 · 4 trends`
Has these blocks: trends (each one is 2–3 sentences plus the linked stories behind it) · counted stats (stories per topic, watchlist CVEs, KEV additions) · "watch next month" · sources that contributed most and least.

Each email has an HTML version and a plain-text version.

---

## Costs

| Piece | Volume | Cost / month |
|---|---|---|
| GitHub Actions | ~12 alert runs/day + 1 daily + 1 monthly, ~1 min each ≈ 400 min | US$0 (free tier: 2,000 min private / unlimited public) |
| Daily, Haiku 5.5 (US$0.10 in / US$0.50 out per MTok) | ~45k in + ~9k out per day (measured ~25k + 5k before AI in brief) | ≈ US$0.27 |
| Monthly, Sonnet 5.5 (US$2 in / US$10 out per MTok) | ~40k in + ~5k out, once | ≈ US$0.13 |
| Gmail SMTP | < 40 emails | US$0 |
| **Total** | | **≈ US$0.40 / month** |

The token figures are estimates. Each daily run logs its token usage and cost, and the monthly email reports the measured total. Set a US$2/month spend limit on the API key.

---

## Get your own copy (about 15 minutes)

Everything runs in **your** GitHub account, with **your** Claude API key and **your** Gmail. You need a GitHub account, a Gmail account with 2-Step Verification, and a card for Claude API credit. No coding required.

### 1. Make a private copy of this repo

On this repo's page, click **Use this template → Create a new repository**, pick your account and choose **Private**. (If you don't see the button, the repo owner needs to tick **Settings → Template repository**.)

> Don't fork it. A fork of a public repo is public, which would expose your watchlist, and GitHub turns off scheduled jobs in forks.

### 2. Get a Claude API key

1. Sign in at [console.anthropic.com](https://console.anthropic.com).
2. Add credit under **Billing**. A few dollars lasts months at ~US$0.30/month.
3. Under **Limits**, set a low monthly spend limit (e.g. US$2).
4. Under **API Keys**, create a key named `ai-news-radar` and copy it. You'll only see it once.

### 3. Get a Gmail App Password

The radar sends email through your Gmail account using an App Password, a 16-character password that only works for sending mail and that you can revoke at any time. Your real Gmail password is never used.

1. Make sure **2-Step Verification** is on in your Google Account (Security tab).
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create one named `AI News Radar` and copy it.
3. Optional but tidy: use a separate Gmail account just for sending.

Google Workspace accounts can have App Passwords disabled by their admin; a personal Gmail account always works.

### 4. Add your secrets

In **your copy**: **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | The key from step 2 |
| `SMTP_USER` | The Gmail address that sends the emails |
| `SMTP_PASS` | The App Password from step 3 |
| `NVD_API_KEY` | Optional. A free key from [NVD](https://nvd.nist.gov/developers/request-an-api-key) makes alert checks faster |

GitHub encrypts secrets, and they never appear in logs or in the repo.

### 5. Write your config

In your copy, open `radar.config.example.yaml`, copy its content, then **Add file → Create new file** named `radar.config.yaml`, paste, and edit:

- `recipients`: where the emails go (any address, not only Gmail).
- `timezone`: e.g. `America/Mexico_City`, `Europe/Madrid`.
- `alerts.watchlist`: what triggers an **urgent alert**. It doesn't filter the daily or monthly emails, which always cover all AI and security news. The default list covers platforms almost everyone runs (Microsoft, Apple, Android, Chrome, Linux, Cisco, Fortinet, Ivanti, VMware, Citrix, Palo Alto, OpenSSL, PHP, WordPress); add or remove to fit you. For each one:
  - `match`: the names to look for in KEV and in headlines.
  - `cpe` (optional): makes NVD matching exact. `vendor:product`, or `vendor:*` for every product of a vendor. Find it with [NVD's CPE search](https://nvd.nist.gov/products/cpe/search): the `vendor:product` part of `cpe:2.3:a:vendor:product:...`.
  - `nvd: false`: for vendors with hundreds of CVEs a month (Microsoft, Apple, Android, Chrome), only "actively exploited" (CISA KEV) and news early signals alert, not every critical score.

  On the last 60 days, the default list alerted on 21 of 60 days, mostly VMware, Citrix, Cisco and Ivanti. Run `npm run replay` after editing it to see how noisy your list would be.
- `sources`: keep the defaults, or add any HTTPS RSS feed.

Commit the file. Emails are never sent to `example.com` addresses, so nothing goes out until you set yours.

### 6. Turn it on

Still in **Settings → Secrets and variables → Actions**, open the **Variables** tab and add `RADAR_ENABLED` = `true`. The scheduled jobs do nothing without it, which keeps the public template (and any copy you haven't set up yet) from running.

### 7. Test it

1. Open the **Actions** tab. If GitHub asks, enable workflows.
2. Pick **alerts → Run workflow**, then **daily → Run workflow**.
3. The daily email arrives within a few minutes. Check spam the first time and mark it "Not spam". The alerts job only emails when something on your watchlist is happening, so silence is normal.

From then on it runs by itself: alerts every 2 h, the daily at 05:00 UTC, the monthly on the 1st. To change the daily time, edit the `cron` line in `.github/workflows/daily.yml` (it's in UTC).

### Troubleshooting

| Symptom | Fix |
|---|---|
| A job shows ⏭ skipped | `RADAR_ENABLED` isn't set to `true` (step 6) |
| Log says `recipients still point at example.com` | Set `recipients` in `radar.config.yaml` (step 5) |
| `Missing repository secret(s): …` | A secret is missing or misnamed; names must be exactly `SMTP_USER`, `SMTP_PASS` |
| `Gmail rejected the login (EAUTH)` / `535-5.7.8` | Use the App Password, not your Gmail password, with no spaces; `SMTP_USER` must be the exact address of the account that created it. When in doubt, delete it, create a new one and update both secrets |
| App passwords page says "not available for your account" | Turn on 2-Step Verification for that Google account first |
| `401` or `authentication_error` from Claude | Recreate the API key and update the secret |
| `credit balance is too low` | Add credit in the Claude Console |
| Email "⚠️ Radar … job is down" | A job failed twice in a row; open the Actions tab to see why |
| Nothing for days | Open the Actions tab: if GitHub paused the schedule it shows a banner with an **Enable workflow** button |

To stop it: set `RADAR_ENABLED` to `false`, or revoke the API key / App Password.

### Run it locally (optional, for developers)

```bash
npm ci
npm run check-sources        # every feed answers with valid data
npm run replay -- --from 2026-08-24 --to 2026-10-22
DRY_RUN=1 MOCK_LLM=1 npm run daily   # offline: emails go to out/emails, no API calls
DRY_RUN=1 npm run alerts
npm run typecheck && npm test
```

`DRY_RUN=1` writes emails to `out/emails/` instead of sending. `MOCK_LLM=1` replaces Claude with a deterministic heuristic. `RADAR_DATA_DIR` points the state somewhere other than `data/`.

---

## Build log

All phases below are built and tested (53 tests). Kept as the record of what each phase covers and as prompts for future changes.

**Phase 0. Repo base**
> Create a TypeScript (Node 20) project with tsx, vitest, zod, rss-parser, @mozilla/readability, jsdom, nodemailer, yaml and @anthropic-ai/sdk, following the layout in the README. Add `CLAUDE.md` with the truthfulness-lock rules. No logic yet.

**Phase 1. Config and sources**
> Implement `src/config` (zod schema for `radar.config.yaml`, clear errors). Then check every source URL in the example config: fetch it, confirm it returns a valid feed/JSON, and fix or remove any that don't. Report what changed.

**Phase 2. Alerts lane (ship this first: it's the main reason for the project)**
> Implement `collect/kev.ts`, `collect/nvd.ts`, `collect/rss.ts` and `alerts/`: watchlist matching, 🔴/🟠 rules, dedupe by CVE via `data/seen.json`, and plain-text + HTML alert email. Tests: a KEV entry for a watchlist product triggers 🔴; the same CVE twice sends one email; one tier-2 headline alone does not trigger 🟠, two do; a non-watchlist CVE with CVSS 10 does not alert.

**Phase 3. Extraction and lock**
> Implement `extract/` and `verify/` (V1–V5, V8). Tests: 404 dropped; invented quote rejected; real quote with different curly quotes accepted; blocked domain dropped; same story from 2 outlets merged with "also covered by"; no date → dropped. Save 5 real articles as fixtures.

**Phase 4. Daily top 3**
> Implement `daily/`: one Haiku call that pre-scores all candidates from title + excerpt, then summaries with quotes for the top 6 using structured outputs, validated with zod, quotes checked by `verify/quotes.ts`, and selection with the mix rules. Handle `refusal` with the title-only fallback. Save `data/daily/YYYY-MM-DD.json`. Render and send the email.

**Phase 5. Monthly trends**
> Implement `monthly/`: stats counted in code from `data/`, then one Sonnet call that returns 3–5 trends, each citing ≥ 2 item IDs. Drop trends with unknown IDs (V6). Test with a synthetic month of data.

**Phase 6. Workflows and ops**
> Add the 3 GitHub Actions workflows with `concurrency` groups, secrets (`ANTHROPIC_API_KEY`, `SMTP_USER`, `SMTP_PASS`) and a step that commits `data/`. Log token usage and cost per run. Add a failure email: if a job fails twice in a row, send a short "Radar is down" note.

**Phase 7. Replay test**
> Add `npm run replay -- --from 2026-09-01 --to 2026-10-22`, which runs the alerts lane against past KEV/NVD data and saved feeds without sending email, and prints when each watchlist alert would have fired.

Project rules for Claude Code live in [`CLAUDE.md`](CLAUDE.md).

**Notes from the build**
- All 11 sources and the PHP vendor feed answered on 2026-10-22.
- NVD is queried per watchlist CPE (`virtualMatchString`) by *last-modified* date, because NVD often adds the CVSS score days after publishing a CVE. Pages are kept at 500 results with retries, because NVD times out on large ones.
- Only CPEs marked `vulnerable` count. NVD also lists the platform an app runs on ("runs on Linux / Chrome"); counting those inflated the first broad replay from ~60 to 278 alerts.
- The Hacker News blocks automated article reads (HTTP 403). Its headlines still count for alerts and "also covered by", but its stories can't make the top 3 because their quotes can't be verified. The tool doesn't work around bot protection.
- CVE references hosted on GitHub/GitLab are dropped unless they are advisory pages, because they are mostly PoCs.

---

## Validation plan (2 weeks)

The MVP is worth keeping only if it beats how you hear about things today.

**First evidence (replay, 2026-08-24 → 2026-10-22, example watchlist).** With the current rules, the PHP vendor feed post *Upcoming Critical PHP Security Release* (20 Oct, 20:32 UTC) triggers a 🟠 early signal **about 18 hours before** the emergency PHP2Shell patches. The 🔴 alerts follow on 21 Oct (CVSS 9.8 in NVD). In the same window the replay also shows 2 critical OpenSSL CVEs (NVD) and 1 WordPress KEV entry. Whether those would have been useful to you is part of the 2-week validation. The news half of the replay is partial for older dates because feeds only keep their latest items.

| Question | How to measure | Pass |
|---|---|---|
| Does it catch urgent issues earlier? | Phase 7 replay over the last 60 days, plus a log of how you heard about each real incident during the 2 weeks | Alert fires **before** your current channel in ≥ 2 of 3 cases (e.g. the PHP issue that triggered this project) |
| Are alerts trustworthy? | Count 🟠 alerts that turned out to be irrelevant | ≤ 1 false alert per week |
| Is the daily email read? | Self-report each day: did I open it? was ≥ 1 story useful? | Opened ≥ 8 of 10 workdays, useful ≥ 7 of 10 |
| Is it accurate? | Spot-check 10 quotes against the source | 10 / 10 found verbatim |
| Is it cheap? | Measured `usage` cost | ≤ US$1 / month |

If the alert lane passes and the daily doesn't, keep the alerts and cut the daily. That result is still a win.

## MVP acceptance criteria

- [ ] The 3 workflows run unattended for 7 days with no manual fixes.
- [x] 100% of claims shown in emails have `quote_verified = true` (unverified claims are removed in code before rendering).
- [x] Lock tests (Phases 2, 3, 5) pass.
- [x] The replay test shows when each watchlist alert would have fired over the last 60 days.
- [x] No CVE produces more than one 🔴 email (tested).
- [ ] Emails read well on mobile (plain-text fallback included). To check on a real phone.
- [ ] A daily run with the real Claude API (needs `ANTHROPIC_API_KEY`).

## Out of MVP

- Web dashboard or archive page.
- Slack / Telegram / push notifications (easy to add after `email/send.ts`).
- LinkedIn post drafts (covered by a separate curation product; the two could be chained later).
- Multi-user sign-up and per-user watchlists.
- Asset inventory scanning: the watchlist is typed by hand.

## Privacy and responsible use

See [Security and responsibility first](#security-and-responsibility-first) for the full list. In short:

- **Your watchlist lists what you run, which is useful to an attacker.** This public repo holds only the generic example; your real config, state and secrets live in your **private** copy.
- Brief summaries with a link to the original only, never full articles.
- Respect `robots.txt` and each site's terms; don't bypass paywalls.
- NVD: stay under the public rate limit, or add a free API key as `NVD_API_KEY`.
- Secrets live only in GitHub Actions secrets, never in the config file.

## Credits

The truthfulness lock comes from a content-curation product I'm developing. The extract → summarize → score → top N flow is inspired by Marmelab's Curator AI (MIT).

---

Found a security problem in the tool itself? See [SECURITY.md](SECURITY.md); please don't open a public issue.

[MIT License](LICENSE) · built by **Natalia Palacios**.
