import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allowedDomains, parseConfig } from "../src/config/load.js";

const example = readFileSync("radar.config.example.yaml", "utf8");

describe("config", () => {
  it("accepts the example config", () => {
    const cfg = parseConfig(example);
    expect(cfg.alerts.watchlist.map((w) => w.name)).toContain("PHP");
    expect(allowedDomains(cfg)).toEqual(expect.arrayContaining(["bleepingcomputer.com", "thehackernews.com", "php.net", "cisa.gov"]));
  });

  it("rejects an http source", () => {
    expect(() => parseConfig(example.replace("https://www.bleepingcomputer.com/feed/", "http://www.bleepingcomputer.com/feed/"))).toThrow(/sources must use https/);
  });

  it("rejects an empty watchlist", () => {
    expect(() => parseConfig(example.replace(/  watchlist:.*\n(    - .*\n)+/, "  watchlist: []\n"))).toThrow(/watchlist/);
  });

  it("rejects a malformed CPE and a bad recipient", () => {
    expect(() => parseConfig(example.replace('cpe: ["php:php"]', 'cpe: ["php"]'))).toThrow(/vendor:product/);
    expect(() => parseConfig(example.replace("you@example.com", "not-an-email"))).toThrow(/recipients/);
  });
});
