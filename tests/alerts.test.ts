import { describe, expect, it } from "vitest";
import type { KevEntry } from "../src/collect/kev.js";
import type { NvdCve } from "../src/collect/nvd.js";
import type { FeedItem } from "../src/collect/rss.js";
import type { WatchItem } from "../src/config/schema.js";
import {
  inQuietHours, isOffensiveLink, matchKev, matchNews, matchNvd, mergeRed, newAlerts, productDayKey, termRegex,
} from "../src/alerts/match.js";
import { renderAlerts } from "../src/alerts/render.js";

const now = new Date("2026-10-21T12:00:00Z");
const watch: WatchItem[] = [
  { name: "PHP", match: ["php"], cpe: ["php:php"], nvd: true },
  { name: "nginx", match: ["nginx"], cpe: [], nvd: true },
];
const rules = { severityKeywords: ["critical", "RCE", "actively exploited"], minSources: 2, hours: 24 };

const kev = (o: Partial<KevEntry>): KevEntry => ({
  cveID: "CVE-2026-0001", vendorProject: "PHP Group", product: "PHP", vulnerabilityName: "PHP RCE",
  dateAdded: "2026-10-21", shortDescription: "desc", requiredAction: "Apply updates.", dueDate: "",
  knownRansomwareCampaignUse: "Unknown", ...o,
});
const cve = (o: Partial<NvdCve>): NvdCve => ({
  id: "CVE-2026-0002", published: "2026-10-21T10:00:00.000Z", description: "A flaw in PHP", cvss: 9.8,
  cpes: ["php:php"], references: [], ...o,
});
const item = (o: Partial<FeedItem>): FeedItem => ({
  url: "https://a.example/1", title: "Critical PHP RCE fixed", excerpt: "", published: "2026-10-21T09:00:00.000Z",
  source: "Outlet A", tier: 2, topic: "security", ...o,
});

describe("term matching", () => {
  it("matches on word boundaries only", () => {
    expect(termRegex("php").test("PHP-FPM bug")).toBe(true);
    expect(termRegex("php").test("phpMyAdmin bug")).toBe(false);
  });
});

describe("red alerts", () => {
  it("a KEV entry for a watchlist product triggers red", () => {
    const [a] = matchKev([kev({})], watch, now, 3);
    expect(a?.level).toBe("red");
    expect(a?.reason).toBe("kev");
  });

  it("ignores KEV entries older than the lookback", () => {
    expect(matchKev([kev({ dateAdded: "2026-10-01" })], watch, now, 3)).toHaveLength(0);
  });

  it("a non-watchlist CVE with CVSS 10 does not alert", () => {
    expect(matchNvd([cve({ cvss: 10, cpes: ["acme:widget"], description: "Acme widget" })], watch, 9, now)).toHaveLength(0);
  });

  it("with a CPE set, a description mention alone is not enough", () => {
    expect(matchNvd([cve({ cpes: ["wordpress:plugin"], description: "PHP object injection in a plugin" })], watch, 9, now)).toHaveLength(0);
  });

  it("a vendor wildcard CPE matches any product of that vendor", () => {
    const w: WatchItem[] = [{ name: "Fortinet", match: ["fortinet"], cpe: ["fortinet:*"], nvd: true }];
    expect(matchNvd([cve({ cpes: ["fortinet:fortios"] })], w, 9, now)).toHaveLength(1);
    expect(matchNvd([cve({ cpes: ["fortinetx:other"] })], w, 9, now)).toHaveLength(0);
  });

  it("with nvd: false, critical NVD scores don't alert but KEV still does", () => {
    const w: WatchItem[] = [{ name: "Microsoft", match: ["microsoft"], cpe: [], nvd: false }];
    expect(matchNvd([cve({ cpes: ["microsoft:windows"], description: "Microsoft Windows flaw" })], w, 9, now)).toHaveLength(0);
    expect(matchKev([kev({ vendorProject: "Microsoft", product: "Windows" })], w, now, 3)).toHaveLength(1);
  });

  it("below the CVSS threshold does not alert", () => {
    expect(matchNvd([cve({ cvss: 7.5 })], watch, 9, now)).toHaveLength(0);
  });

  it("KEV and NVD hits for one CVE merge into one alert", () => {
    const merged = mergeRed([...matchKev([kev({ cveID: "CVE-2026-0002" })], watch, now, 3), ...matchNvd([cve({})], watch, 9, now)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reason).toBe("kev");
    expect(merged[0]?.cvss).toBe(9.8);
  });

  it("never links to exploit code", () => {
    const [a] = matchNvd([cve({ references: ["https://github.com/x/CVE-2026-0002-poc", "https://www.exploit-db.com/1", "https://php.net/advisory"] })], watch, 9, now);
    expect(a?.links.map((l) => l.url)).toEqual(["https://nvd.nist.gov/vuln/detail/CVE-2026-0002", "https://php.net/advisory"]);
    expect(isOffensiveLink("https://example.com/proof-of-concept")).toBe(true);
  });
});

describe("early signals", () => {
  it("one tier-2 headline alone does not trigger", () => {
    expect(matchNews([item({})], watch, rules, now)).toHaveLength(0);
  });

  it("two sources trigger orange", () => {
    const out = matchNews([item({}), item({ url: "https://b.example/1", source: "Outlet B" })], watch, rules, now);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe("multi_source");
  });

  it("one tier-1 source triggers orange", () => {
    expect(matchNews([item({ tier: 1, source: "PHP (vendor)" })], watch, rules, now)[0]?.reason).toBe("tier1_source");
  });

  it("needs a severity keyword", () => {
    expect(matchNews([item({ tier: 1, title: "PHP 8.5 released with new features" })], watch, rules, now)).toHaveLength(0);
  });

  it("groups by CVE when the text names one", () => {
    const out = matchNews([item({ title: "Critical CVE-2026-0002 in PHP", tier: 1 })], watch, rules, now);
    expect(out[0]?.key).toBe("orange:CVE-2026-0002");
  });
});

describe("dedupe", () => {
  it("the same CVE twice sends one email", () => {
    const seen = new Set<string>();
    const first = newAlerts(matchNvd([cve({})], watch, 9, now), seen);
    first.forEach((a) => seen.add(a.key));
    expect(first).toHaveLength(1);
    expect(newAlerts(matchNvd([cve({})], watch, 9, now), seen)).toHaveLength(0);
  });

  it("a red that confirms an early signal points back to it", () => {
    const [a] = newAlerts(matchNvd([cve({})], watch, 9, now), new Set(["orange:CVE-2026-0002"]));
    expect(a?.supersedes).toBe("orange:CVE-2026-0002");
  });

  it("an early signal after the red is dropped", () => {
    const out = newAlerts(matchNews([item({ title: "Critical CVE-2026-0002 in PHP", tier: 1 })], watch, rules, now), new Set(["red:CVE-2026-0002"]));
    expect(out).toHaveLength(0);
  });

  it("CVE-less coverage of an already-alerted product is dropped that day", () => {
    const seen = new Set([productDayKey("PHP", now)]);
    expect(newAlerts(matchNews([item({ tier: 1 })], watch, rules, now), seen)).toHaveLength(0);
  });
});

describe("quiet hours", () => {
  it("handles ranges across midnight in the configured timezone", () => {
    expect(inQuietHours("23:00-07:00", "Europe/Madrid", new Date("2026-10-21T03:00:00Z"))).toBe(true);
    expect(inQuietHours("23:00-07:00", "Europe/Madrid", new Date("2026-10-21T10:00:00Z"))).toBe(false);
    expect(inQuietHours(null, "UTC", now)).toBe(false);
  });
});

describe("alert email", () => {
  it("escapes hostile text and drops non-https links", () => {
    const [a] = matchNews(
      [item({ tier: 1, title: `Critical PHP RCE <script>alert(1)</script>`, url: "https://a.example/<x>" }),
       item({ tier: 1, title: "Critical PHP flaw", url: "javascript:alert(1)" as string, source: "B" })],
      watch, rules, now,
    );
    const email = renderAlerts([a!]);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain('href="javascript:');
    expect(email.text).toContain("not yet confirmed");
  });

  it("labels early signals as unconfirmed in the subject", () => {
    const [a] = matchNews([item({ tier: 1 })], watch, rules, now);
    expect(renderAlerts([a!]).subject).toMatch(/^🟠 \[Radar\] Early signal/);
  });
});

describe("NVD parsing", () => {
  it("ignores platform CPEs that aren't vulnerable", async () => {
    const { toCve } = await import("../src/collect/nvd.js");
    const c = toCve({
      id: "CVE-2026-0003",
      published: "2026-10-21T10:00:00.000",
      configurations: [{ nodes: [{ cpeMatch: [
        { criteria: "cpe:2.3:a:acme:extension:1.0:*:*:*:*:*:*:*", vulnerable: true },
        { criteria: "cpe:2.3:a:google:chrome:-:*:*:*:*:*:*:*", vulnerable: false },
      ] }] }],
    });
    expect(c.cpes).toEqual(["acme:extension"]);
    expect(c.published).toBe("2026-10-21T10:00:00.000Z");
  });
});
