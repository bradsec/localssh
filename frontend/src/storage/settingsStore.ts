import { DEFAULT_FONT_FAMILY, TERMINAL_FONTS } from "../terminalFonts.js";
import { DEFAULT_THEME_NAME, TERMINAL_THEMES } from "../terminalThemes.js";
import { DEFAULT_KEY_ORDER, resolveKeyOrder } from "../terminalKeys.js";
import { KEEP_ALIVE_CHOICES, type KeepAliveChoice } from "../keepAlive.js";

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  themeName: string;
  lineHeight: number;
  keepAlive: KeepAliveChoice;
  /** Ids of the key bar's keys, in display order. */
  keyBarKeys: string[];
}

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const LINE_HEIGHT_MIN = 1;
export const LINE_HEIGHT_MAX = 2;
// Line heights are stored in twentieths so the picker's 0.05 steps match exactly.
const LINE_HEIGHT_STEPS_PER_UNIT = 20;

const STORAGE_KEY = "terminalSettings";

const DEFAULTS: TerminalSettings = {
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  themeName: DEFAULT_THEME_NAME,
  lineHeight: 1.15,
  keepAlive: 120,
  keyBarKeys: [...DEFAULT_KEY_ORDER],
};

function validLineHeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < LINE_HEIGHT_MIN || value > LINE_HEIGHT_MAX) return undefined;
  const steps = value * LINE_HEIGHT_STEPS_PER_UNIT;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) return undefined;
  return Math.round(steps) / LINE_HEIGHT_STEPS_PER_UNIT;
}

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
      parsed.fontSize >= FONT_SIZE_MIN &&
      parsed.fontSize <= FONT_SIZE_MAX
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
    const lineHeight = validLineHeight(parsed.lineHeight) ?? DEFAULTS.lineHeight;
    const keepAlive =
      KEEP_ALIVE_CHOICES.find((choice) => choice === parsed.keepAlive) ?? DEFAULTS.keepAlive;

    const keyBarKeys = resolveKeyOrder(parsed.keyBarKeys);

    return {
      fontSize,
      fontFamily,
      themeName,
      lineHeight,
      keepAlive,
      keyBarKeys,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveTerminalSettings(settings: TerminalSettings): { ok: boolean } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
