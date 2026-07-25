import { beforeEach, describe, expect, it } from "vitest";
import {
  loadLastHost,
  loadRememberHost,
  saveLastHost,
  saveRememberHost,
} from "./lastHostStore.js";

describe("lastHostStore", () => {
  beforeEach(() => localStorage.clear());

  it("is disabled by default", () => {
    expect(loadRememberHost()).toBe(false);
    expect(loadLastHost()).toBeNull();
  });

  it("does not store anything while disabled", () => {
    saveLastHost({ host: "ssh.example.com", port: 22 });
    expect(localStorage.getItem("lastHost")).toBeNull();
    expect(loadLastHost()).toBeNull();
  });

  it("round-trips the host and port once enabled", () => {
    saveRememberHost(true);
    saveLastHost({ host: "ssh.example.com", port: 2222 });
    expect(loadLastHost()).toEqual({ host: "ssh.example.com", port: 2222 });
  });

  // The whole point of the toggle: credentials must never reach storage.
  it("never persists anything beyond host and port", () => {
    saveRememberHost(true);
    saveLastHost({ host: "ssh.example.com", port: 22 });

    const stored = JSON.parse(localStorage.getItem("lastHost") ?? "{}");
    expect(Object.keys(stored).sort()).toEqual(["host", "port"]);
  });

  it("forgets the stored host when the toggle is turned off", () => {
    saveRememberHost(true);
    saveLastHost({ host: "ssh.example.com", port: 22 });
    saveRememberHost(false);

    expect(localStorage.getItem("lastHost")).toBeNull();
    expect(loadLastHost()).toBeNull();
  });

  it("rejects corrupt or out-of-range stored values", () => {
    saveRememberHost(true);

    localStorage.setItem("lastHost", "not json");
    expect(loadLastHost()).toBeNull();

    localStorage.setItem("lastHost", JSON.stringify({ host: "", port: 22 }));
    expect(loadLastHost()).toBeNull();

    localStorage.setItem("lastHost", JSON.stringify({ host: "a.example", port: 0 }));
    expect(loadLastHost()).toBeNull();

    localStorage.setItem("lastHost", JSON.stringify({ host: "a.example", port: 70000 }));
    expect(loadLastHost()).toBeNull();
  });
});
