# Security policy

AI News Radar watches for vulnerabilities, so it must not become one. Thanks for helping keep it safe.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repo.

Include what you found, how to reproduce it, and the impact you expect. You'll get an answer within 7 days. Once a fix is out, you'll be credited in the release notes unless you'd rather not be.

## In scope

- Ways to make the tool fetch something it shouldn't (non-allowlisted hosts, private networks, `file:` or `http:` URLs).
- Article or feed content that injects HTML, scripts or links into the emails, or that changes what the model is asked to do.
- Leaks of secrets (`ANTHROPIC_API_KEY`, `SMTP_*`, `NVD_API_KEY`) into logs, emails or `data/`.
- Weaknesses in the GitHub Actions workflows (permissions, untrusted input, unpinned actions).
- Any path that would make an alert link to exploit code or describe how to exploit something.

## Out of scope

- Vulnerabilities in the news the tool reports on: report those to the affected vendor.
- Issues in your own copy's configuration (for example, making your copy public with a real watchlist).

## Supported versions

Only the latest version on `main` gets fixes. Copies made from the template don't update themselves: watch this repo's releases and bring the changes into your copy.
