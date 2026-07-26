import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_FAMILY } from "../terminalFonts.js";
import { DEFAULT_THEME_NAME } from "../terminalThemes.js";
import { loadTerminalSettings, saveTerminalSettings } from "./settingsStore.js";

describe("settingsStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns defaults when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(loadTerminalSettings()).toEqual({
      fontSize: 14,
      fontFamily: DEFAULT_FONT_FAMILY,
      themeName: DEFAULT_THEME_NAME,
    });
  });

  it("does not throw when a preference cannot be persisted", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() =>
      saveTerminalSettings({
        fontSize: 16,
        fontFamily: DEFAULT_FONT_FAMILY,
        themeName: DEFAULT_THEME_NAME,
      }),
    ).not.toThrow();
  });
});
