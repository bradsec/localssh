import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_FAMILY } from "../terminalFonts.js";
import { DEFAULT_KEY_ORDER } from "../terminalKeys.js";
import { DEFAULT_THEME_NAME } from "../terminalThemes.js";
import { loadTerminalSettings, saveTerminalSettings } from "./settingsStore.js";

describe("settingsStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("returns defaults when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(loadTerminalSettings()).toEqual({
      fontSize: 14,
      fontFamily: DEFAULT_FONT_FAMILY,
      themeName: DEFAULT_THEME_NAME,
      lineHeight: 1.15,
      keepAlive: 120,
      keyBarKeys: DEFAULT_KEY_ORDER,
    });
  });

  it("defaults the key bar order and keeps a saved one, resolved", () => {
    localStorage.setItem("terminalSettings", JSON.stringify({ fontSize: 16 }));
    expect(loadTerminalSettings().keyBarKeys).toEqual(DEFAULT_KEY_ORDER);
    localStorage.setItem(
      "terminalSettings",
      JSON.stringify({ keyBarKeys: ["tab", "bogus", "esc", "tab"] }),
    );
    expect(loadTerminalSettings().keyBarKeys).toEqual(["tab", "esc"]);
    localStorage.setItem("terminalSettings", JSON.stringify({ keyBarKeys: [] }));
    expect(loadTerminalSettings().keyBarKeys).toEqual([]);
  });

  it("defaults line height to 1.15 for settings saved before it existed", () => {
    localStorage.setItem(
      "terminalSettings",
      JSON.stringify({
        fontSize: 16,
        fontFamily: DEFAULT_FONT_FAMILY,
        themeName: DEFAULT_THEME_NAME,
      }),
    );

    expect(loadTerminalSettings()).toMatchObject({ fontSize: 16, lineHeight: 1.15 });
  });

  it("defaults old and invalid keep-alive values to 2 min", () => {
    localStorage.setItem("terminalSettings", JSON.stringify({ fontSize: 16 }));
    expect(loadTerminalSettings().keepAlive).toBe(120);
    localStorage.setItem("terminalSettings", JSON.stringify({ keepAlive: 42 }));
    expect(loadTerminalSettings().keepAlive).toBe(120);
  });

  it("persists the selected keep-alive choice", () => {
    const settings = { ...loadTerminalSettings(), keepAlive: 900 as const };
    expect(saveTerminalSettings(settings)).toEqual({ ok: true });
    expect(loadTerminalSettings().keepAlive).toBe(900);
  });

  // JSON cannot carry NaN; JSON.stringify writes it as null, covered here.
  it.each([null, 0.9, 2.5, "1.2", 1.33])("rejects line height %s", (lineHeight) => {
    localStorage.setItem("terminalSettings", JSON.stringify({ fontSize: 16, lineHeight }));

    expect(loadTerminalSettings()).toMatchObject({ fontSize: 16, lineHeight: 1.15 });
  });

  it("round-trips a stepped line height", () => {
    expect(
      saveTerminalSettings({
        fontSize: 14,
        fontFamily: DEFAULT_FONT_FAMILY,
        themeName: DEFAULT_THEME_NAME,
        lineHeight: 1.35,
        keepAlive: 120,
        keyBarKeys: [...DEFAULT_KEY_ORDER],
      }),
    ).toEqual({ ok: true });

    expect(loadTerminalSettings().lineHeight).toBe(1.35);
  });

  it.each([1, 2])("accepts the line height bound %s", (lineHeight) => {
    localStorage.setItem("terminalSettings", JSON.stringify({ lineHeight }));

    expect(loadTerminalSettings().lineHeight).toBe(lineHeight);
  });

  it("reports when a preference cannot be persisted", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(
      saveTerminalSettings({
        fontSize: 16,
        fontFamily: DEFAULT_FONT_FAMILY,
        themeName: DEFAULT_THEME_NAME,
        lineHeight: 1.15,
        keepAlive: 120,
        keyBarKeys: [],
      }),
    ).toEqual({ ok: false });
  });
});
