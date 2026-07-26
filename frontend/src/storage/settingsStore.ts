import { DEFAULT_FONT_FAMILY, TERMINAL_FONTS } from "../terminalFonts.js";
import { DEFAULT_THEME_NAME, TERMINAL_THEMES } from "../terminalThemes.js";

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  themeName: string;
}

const STORAGE_KEY = "terminalSettings";

const DEFAULTS: TerminalSettings = {
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  themeName: DEFAULT_THEME_NAME,
};

export function loadTerminalSettings(): TerminalSettings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULTS;
  }
  if (!raw) return DEFAULTS;

  try {
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
    const fontSize =
      typeof parsed.fontSize === "number" &&
      Number.isFinite(parsed.fontSize) &&
      parsed.fontSize >= 8 &&
      parsed.fontSize <= 32
        ? parsed.fontSize
        : DEFAULTS.fontSize;
    const fontFamily =
      typeof parsed.fontFamily === "string" &&
      TERMINAL_FONTS.some((font) => font.value === parsed.fontFamily)
        ? parsed.fontFamily
        : DEFAULTS.fontFamily;
    const themeName =
      typeof parsed.themeName === "string" && parsed.themeName in TERMINAL_THEMES
        ? parsed.themeName
        : DEFAULTS.themeName;

    return {
      fontSize,
      fontFamily,
      themeName,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are non-critical; the caller keeps the new value in memory.
  }
}
