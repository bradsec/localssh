import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  assertOriginAllowed,
  assertTargetAllowed,
  parseAccessConfig,
} from "./access.js";

describe("parseAccessConfig", () => {
  it("defaults to no origins, no hosts, and port 22 only", () => {
    expect(parseAccessConfig({})).toEqual({
      allowedOrigins: [],
      allowedHosts: [],
      allowedPorts: [22],
    });
  });

  it("splits and trims comma separated lists", () => {
    const config = parseAccessConfig({
      ALLOWED_ORIGINS: "https://a.example , https://b.example",
      ALLOWED_HOSTS: " SSH.Example.COM ,*.internal.example",
      ALLOWED_PORTS: "22, 2222",
    });
    expect(config.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(config.allowedHosts).toEqual(["ssh.example.com", "*.internal.example"]);
    expect(config.allowedPorts).toEqual([22, 2222]);
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseAccessConfig({ ALLOWED_PORTS: "0" })).toThrow(AccessDeniedError);
    expect(() => parseAccessConfig({ ALLOWED_PORTS: "70000" })).toThrow(AccessDeniedError);
    expect(() => parseAccessConfig({ ALLOWED_PORTS: "http" })).toThrow(AccessDeniedError);
  });
});

describe("assertOriginAllowed", () => {
  it("denies everything when ALLOWED_ORIGINS is unset", () => {
    const config = parseAccessConfig({});
    expect(() => assertOriginAllowed("https://a.example", config)).toThrow(
      /relay is not configured/,
    );
  });

  it("denies an origin that is not on the list", () => {
    const config = parseAccessConfig({ ALLOWED_ORIGINS: "https://a.example" });
    expect(() => assertOriginAllowed("https://evil.example", config)).toThrow(/origin not allowed/);
  });

  it("denies a missing Origin header", () => {
    const config = parseAccessConfig({ ALLOWED_ORIGINS: "https://a.example" });
    expect(() => assertOriginAllowed(null, config)).toThrow(/origin not allowed/);
  });

  it("allows an exact match", () => {
    const config = parseAccessConfig({ ALLOWED_ORIGINS: "https://a.example" });
    expect(() => assertOriginAllowed("https://a.example", config)).not.toThrow();
  });

  it("allows any origin only when explicitly set to *", () => {
    const config = parseAccessConfig({ ALLOWED_ORIGINS: "*" });
    expect(() => assertOriginAllowed("https://anything.example", config)).not.toThrow();
  });
});

describe("assertTargetAllowed", () => {
  it("denies everything when ALLOWED_HOSTS is unset", () => {
    const config = parseAccessConfig({ ALLOWED_ORIGINS: "https://a.example" });
    expect(() => assertTargetAllowed("ssh.example.com", 22, config)).toThrow(
      /relay is not configured/,
    );
  });

  it("denies a host that is not on the list", () => {
    const config = parseAccessConfig({ ALLOWED_HOSTS: "ssh.example.com" });
    expect(() => assertTargetAllowed("169.254.169.254", 22, config)).toThrow(/host not allowed/);
  });

  it("denies a port that is not on the list", () => {
    const config = parseAccessConfig({ ALLOWED_HOSTS: "ssh.example.com" });
    expect(() => assertTargetAllowed("ssh.example.com", 6379, config)).toThrow(/port not allowed/);
  });

  it("matches hosts case insensitively", () => {
    const config = parseAccessConfig({ ALLOWED_HOSTS: "ssh.example.com" });
    expect(() => assertTargetAllowed("SSH.Example.COM", 22, config)).not.toThrow();
  });

  it("matches subdomains for a *. entry but not the bare domain", () => {
    const config = parseAccessConfig({ ALLOWED_HOSTS: "*.example.com" });
    expect(() => assertTargetAllowed("a.example.com", 22, config)).not.toThrow();
    expect(() => assertTargetAllowed("example.com", 22, config)).toThrow(/host not allowed/);
  });

  it("does not let a lookalike domain pass the suffix check", () => {
    const config = parseAccessConfig({ ALLOWED_HOSTS: "*.example.com" });
    expect(() => assertTargetAllowed("evil-example.com", 22, config)).toThrow(/host not allowed/);
    expect(() => assertTargetAllowed("example.com.evil.net", 22, config)).toThrow(
      /host not allowed/,
    );
  });
});
