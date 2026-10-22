import { describe, expect, it } from "vitest";
import { BlockedUrlError, hostAllowed, isPrivateIp, parseRobots, safeFetch } from "../src/net/fetch.js";

describe("safe fetch guards", () => {
  it("allows a domain and its subdomains only", () => {
    expect(hostAllowed("www.bleepingcomputer.com", ["bleepingcomputer.com"])).toBe(true);
    expect(hostAllowed("bleepingcomputer.com.evil.io", ["bleepingcomputer.com"])).toBe(false);
    expect(hostAllowed("notbleepingcomputer.com", ["bleepingcomputer.com"])).toBe(false);
  });

  it("flags private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("refuses http, non-allowlisted hosts and private IPs before any request", async () => {
    await expect(safeFetch("http://example.com", { allow: [] })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("https://example.com", { allow: ["other.org"] })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("https://169.254.169.254/latest", { allow: [] })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("https://user:pw@example.com", { allow: [] })).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("reads Disallow rules for all user agents", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /private\nDisallow:\n");
    expect(rules).toEqual(["/private"]);
  });
});
