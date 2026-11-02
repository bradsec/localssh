import { describe, expect, it } from "vitest";
import {
  encodeConnectFrame,
  decodeConnectFrame,
  encodeV2Frame,
  decodeV2Frame,
  type V2Frame,
} from "./protocol.js";

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

const sessionId = "a".repeat(32);
const token = "b".repeat(64);

describe("v2 frames", () => {
  const frames: V2Frame[] = [
    { version: 2, type: "connect", host: "ssh.example.com", port: 22, requestedGraceMs: 120000 },
    { version: 2, type: "connect", host: "ssh.example.com", port: 22, requestedGraceMs: null },
    {
      version: 2,
      type: "connect",
      host: "ssh.example.com",
      port: 22,
      requestedGraceMs: Number.MAX_SAFE_INTEGER,
    },
    {
      version: 2,
      type: "ready",
      sessionId,
      token,
      maxUnackedBytes: 262144,
      grantedGraceMs: 120000,
      capGraceMs: 120000,
    },
    {
      version: 2,
      type: "ready",
      sessionId,
      token,
      maxUnackedBytes: 262144,
      grantedGraceMs: 300000,
      capGraceMs: 3600000,
    },
    {
      version: 2,
      type: "ready",
      sessionId,
      token,
      maxUnackedBytes: 262144,
      grantedGraceMs: null,
      capGraceMs: null,
    },
    {
      version: 2,
      type: "ready",
      sessionId,
      token,
      maxUnackedBytes: 262144,
      grantedGraceMs: 600000,
      capGraceMs: null,
    },
    { version: 2, type: "resume", sessionId, token, clientAck: 10, serverAck: 20 },
    { version: 2, type: "resumed", clientAck: 10, serverAck: 20, newToken: "c".repeat(64) },
    {
      version: 2,
      type: "data",
      direction: "client",
      offset: 10,
      payload: Uint8Array.from([0, 255, 128]),
    },
    { version: 2, type: "data", direction: "server", offset: 20, payload: Uint8Array.from([1, 2]) },
    { version: 2, type: "ack", direction: "client", offset: 13 },
    { version: 2, type: "ack", direction: "server", offset: 22 },
    { version: 2, type: "detach" },
    { version: 2, type: "close" },
    { version: 2, type: "ping" },
    { version: 2, type: "pong" },
    { version: 2, type: "error", code: "offset_mismatch" },
    { version: 2, type: "error", code: "resume_disabled" },
    { version: 2, type: "error", code: "superseded" },
  ];

  it.each(frames)("round-trips $type", (frame) => {
    expect(decodeV2Frame(encodeV2Frame(frame))).toEqual(frame);
  });

  it("keeps v1 bytes unchanged and rejects v1 as v2", () => {
    expect(encodeConnectFrame({ host: "ssh.example.com", port: 22 })).toBe(
      '{"host":"ssh.example.com","port":22}',
    );
    expect(() => decodeV2Frame('{"host":"ssh.example.com","port":22}')).toThrow();
  });

  it("specifies the v2 wire shape", () => {
    expect(encodeV2Frame(frames[0])).toBe('[2,"connect","ssh.example.com",22,120000]');
    expect(encodeV2Frame(frames[1])).toBe('[2,"connect","ssh.example.com",22,null]');
    expect(encodeV2Frame(frames[5])).toBe(`[2,"ready","${sessionId}","${token}",262144,null,null]`);
    expect(encodeV2Frame(frames[8])).toBe(`[2,"resumed",10,20,"${"c".repeat(64)}"]`);
    expect(encodeV2Frame({ version: 2, type: "close" })).toBe('[2,"close"]');
    expect(encodeV2Frame({ version: 2, type: "ping" })).toBe('[2,"ping"]');
    expect(encodeV2Frame({ version: 2, type: "pong" })).toBe('[2,"pong"]');
    expect(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 10,
        payload: Uint8Array.from([0, 255, 128]),
      }),
    ).toBe('[2,"data","client",10,"AP+A"]');
  });

  it.each([
    "not json",
    '[1,"connect","x",22]',
    '[3,"connect","x",22]',
    '[2,"unknown"]',
    '[2,"connect","x",22]',
    '[2,"connect","x",22,120000,"extra"]',
    '[2,"connect","x",22,"120000"]',
    '[2,"connect","x",22,0]',
    '[2,"connect","x",22,-1]',
    '[2,"connect","x",22,1.5]',
    '[2,"connect","x",22,9007199254740992]',
    '[2,"connect","x",0,120000]',
    `[2,"ready","${sessionId}","${token}",1700000120000,262144,120000]`,
    `[2,"ready","${sessionId}","${token}",262144,120000]`,
    `[2,"ready","${sessionId}","${token}",262144,120000,120000,"extra"]`,
    `[2,"ready","${sessionId}","${token}",262144,120001,120000]`,
    `[2,"ready","${sessionId}","${token}",262144,null,120000]`,
    `[2,"ready","${sessionId}","${token}",262144,0,120000]`,
    `[2,"ready","${sessionId}","${token}",262144,120000,0]`,
    `[2,"ready","${sessionId}","${token}",262144,1.5,null]`,
    `[2,"ready","${sessionId}","${token}",0,120000,120000]`,
    '[2,"resumed",10,20]',
    '[2,"resumed",10,20,"short"]',
    `[2,"resumed",10,20,"${"C".repeat(64)}"]`,
    `[2,"resumed",10,20,"${"c".repeat(64)}","extra"]`,
    '[2,"close","extra"]',
    '[2,"ping",1]',
    '[2,"pong",null]',
    `[2,"resume","${sessionId}","${token}",-1,0]`,
    `[2,"resume","${sessionId}","${token}",9007199254740992,0]`,
    `[2,"resume","${sessionId}","${token}",2,1,"extra"]`,
    `[2,"resume","${sessionId}","short",0,0]`,
    `[2,"resume","${sessionId}","${token}",0,0,"duplicate"]`,
    '[2,"data","client",0,""]',
    '[2,"data","client",0,"AA==","conflict"]',
    '[2,"data","wrong",0,"AA=="]',
    '[2,"data","client",9007199254740991,"AA=="]',
    '[2,"data","client",0,"A==="]',
    '[2,"ack","server",1.5]',
    '[2,"ready","short","bad",0,262144,120000]',
    '[2,"error","unknown"]',
    '[2,"error","resume_disabled","extra"]',
  ])("rejects malformed frame %s", (raw) => {
    expect(() => decodeV2Frame(raw)).toThrow();
  });

  it("bounds control and data frames", () => {
    expect(() => decodeV2Frame('[2,"detach"]' + " ".repeat(4097))).toThrow();
    expect(() =>
      decodeV2Frame(
        JSON.stringify([2, "data", "client", 0, Buffer.alloc(262145).toString("base64")]),
      ),
    ).toThrow();
    expect(() =>
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: new Uint8Array(262145),
      }),
    ).toThrow();
    expect(() =>
      encodeV2Frame({
        version: 2,
        type: "ack",
        direction: "client",
        offset: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
});
