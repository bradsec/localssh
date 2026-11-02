import { describe, expect, it } from "vitest";
import { formatGrace, requestedGraceMs } from "./keepAlive.js";

describe("keep-alive choices", () => {
  it.each([
    ["off", "v1"],
    [120, 120000],
    [300, 300000],
    [600, 600000],
    [900, 900000],
    [3600, 3600000],
    ["until-disconnect", null],
  ] as const)("maps %s to %s", (choice, expected) => {
    expect(requestedGraceMs(choice)).toBe(expected);
  });

  it.each([
    [null, "no limit"],
    [30000, "30 sec"],
    [120000, "2 min"],
    [3600000, "1 hour"],
    [5400000, "1 hr 30 min"],
    [7200000, "2 hours"],
  ] as const)("formats %s as %s", (ms, expected) => {
    expect(formatGrace(ms)).toBe(expected);
  });
});
