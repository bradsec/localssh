import { describe, expect, it } from "vitest";
import { encodeConnectFrame, decodeConnectFrame } from "./protocol.js";

describe("connect frame", () => {
  it("round-trips a valid frame", () => {
    const raw = encodeConnectFrame({ host: "192.168.1.10", port: 22 });
    expect(decodeConnectFrame(raw)).toEqual({ host: "192.168.1.10", port: 22 });
  });

  it("rejects an empty host on encode", () => {
    expect(() => encodeConnectFrame({ host: "", port: 22 })).toThrow();
  });

  it("rejects an out-of-range port on encode", () => {
    expect(() => encodeConnectFrame({ host: "x", port: 70000 })).toThrow();
  });

  it("rejects malformed JSON on decode", () => {
    expect(() => decodeConnectFrame("not json")).toThrow();
  });

  it("rejects a frame missing port on decode", () => {
    expect(() => decodeConnectFrame(JSON.stringify({ host: "x" }))).toThrow();
  });

  it("rejects control characters in a host", () => {
    expect(() => decodeConnectFrame(JSON.stringify({ host: "safe\nforged", port: 22 }))).toThrow();
  });
});
