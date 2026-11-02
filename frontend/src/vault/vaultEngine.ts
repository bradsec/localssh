import { loadEngine } from "../ssh/engine.js";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
} from "../storage/settingsStore.js";
import { TERMINAL_FONTS } from "../terminalFonts.js";
import { TERMINAL_THEMES } from "../terminalThemes.js";

export interface TerminalPrefs {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  themeName: string;
}

/**
 * An entry as the page sees it. There is deliberately no password field: the
 * engine reports only whether one is saved, and resolves the value itself when
 * a connection references the entry.
 */
export interface SavedEntry {
  id: string;
  nickname: string;
  host: string;
  port: number;
  username?: string;
  hasPassword: boolean;
  terminal?: TerminalPrefs;
}

/**
 * An entry as the editor submits it. An absent `password` keeps whatever is
 * saved, because the editor cannot display a password it never receives. An
 * empty string clears it.
 */
export interface EntryInput {
  id: string;
  nickname: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  terminal?: TerminalPrefs | null;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Master password is incorrect. Try again or delete the saved hosts to start over.");
    this.name = "WrongPasswordError";
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super("Saved hosts are locked. Unlock them with your master password and try again.");
    this.name = "VaultLockedError";
  }
}

declare global {
  interface Window {
    vaultCreate: (masterPassword: string) => Promise<string>;
    vaultUnlock: (blob: string, masterPassword: string) => Promise<string>;
    vaultList: () => Promise<string>;
    vaultUpsert: (entryJson: string) => Promise<string>;
    vaultDelete: (id: string) => Promise<string>;
    vaultChangePassword: (current: string, next: string) => Promise<string>;
    vaultLock: () => Promise<null>;
  }
}

export async function createVault(masterPassword: string): Promise<string> {
  await loadEngine();
  return call(() => window.vaultCreate(masterPassword));
}

export async function unlockVault(
  blob: string,
  masterPassword: string,
): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const listed = await call(() => window.vaultUnlock(blob, masterPassword));
  return { blob, entries: parseEntries(listed) };
}

export async function upsertEntry(
  input: EntryInput,
): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const blob = await call(() => window.vaultUpsert(encodeInput(input)));
  return { blob, entries: parseEntries(await call(() => window.vaultList())) };
}

export async function deleteEntry(id: string): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const blob = await call(() => window.vaultDelete(id));
  return { blob, entries: parseEntries(await call(() => window.vaultList())) };
}

export async function changeMasterPassword(current: string, next: string): Promise<string> {
  await loadEngine();
  return call(() => window.vaultChangePassword(current, next));
}

export async function lockVault(): Promise<void> {
  await loadEngine();
  await call(() => window.vaultLock());
}

// JSON.stringify drops an undefined value, but only for a key that is present
// with that value. Building the object explicitly keeps "absent" and "empty"
// distinguishable, which is the whole keep-or-clear contract.
function encodeInput(input: EntryInput): string {
  if (input.terminal != null && !isTerminalPrefs(input.terminal)) {
    throw new Error("Invalid terminal preferences.");
  }
  const wire: Record<string, unknown> = {
    id: input.id,
    nickname: input.nickname,
    host: input.host,
    port: input.port,
    username: input.username,
  };
  if (input.password !== undefined) wire.password = input.password;
  if (input.terminal !== undefined) wire.terminal = input.terminal;
  return JSON.stringify(wire);
}

function parseEntries(json: string): SavedEntry[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every(isSavedEntry)) {
    throw new Error("The vault engine returned malformed entries.");
  }
  return parsed;
}

function isSavedEntry(value: unknown): value is SavedEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.nickname === "string" &&
    typeof entry.host === "string" &&
    Number.isInteger(entry.port) &&
    (entry.username === undefined || typeof entry.username === "string") &&
    typeof entry.hasPassword === "boolean" &&
    (entry.terminal === undefined || isTerminalPrefs(entry.terminal))
  );
}

function isTerminalPrefs(value: unknown): value is TerminalPrefs {
  if (typeof value !== "object" || value === null) return false;
  const prefs = value as Record<string, unknown>;
  return (
    typeof prefs.fontFamily === "string" &&
    TERMINAL_FONTS.some((font) => font.value === prefs.fontFamily) &&
    typeof prefs.fontSize === "number" &&
    Number.isInteger(prefs.fontSize) &&
    prefs.fontSize >= FONT_SIZE_MIN &&
    prefs.fontSize <= FONT_SIZE_MAX &&
    typeof prefs.lineHeight === "number" &&
    Number.isFinite(prefs.lineHeight) &&
    prefs.lineHeight >= LINE_HEIGHT_MIN &&
    prefs.lineHeight <= LINE_HEIGHT_MAX &&
    Math.abs(prefs.lineHeight * 20 - Math.round(prefs.lineHeight * 20)) <= 1e-9 &&
    typeof prefs.themeName === "string" &&
    Object.hasOwn(TERMINAL_THEMES, prefs.themeName)
  );
}

// The Go bridge rejects with a plain string, so failures arrive untyped.
async function call<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    if (message.includes("wrong master password")) throw new WrongPasswordError();
    if (message.includes("vault: locked")) throw new VaultLockedError();
    throw error instanceof Error ? error : new Error(message);
  }
}
