// Helpers for the file panel that do not render anything.

export const DOWNLOAD_PREFIX = "localssh-download-";
/** How long a finished download's browser copy stays available to save. */
export const DOWNLOAD_KEEP_MS = 10 * 60_000;

// Bidi embedding, override, isolate, and mark code points, plus C0 and C1
// controls. Shown as <U+XXXX> so a name such as "report<U+202E>gpj.exe"
// cannot display as "reportexe.jpg".
// oxlint-disable-next-line no-control-regex -- matching controls is the point.
const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A remote name made safe to show and to use as a saved file name. */
export function displayName(name: string): string {
  return name.replace(
    UNSAFE_DISPLAY,
    (char) => `<U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`,
  );
}

export async function originDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await navigator.storage?.getDirectory?.()) ?? null;
  } catch {
    // Safari private browsing can deny origin storage; use the bounded fallback.
    return null;
  }
}

/**
 * Removes this app's download copies older than DOWNLOAD_KEEP_MS, left behind
 * by a reload or closed tab. Newer ones may belong to another open window.
 */
export async function sweepDownloads(now = Date.now()): Promise<void> {
  const directory = await originDirectory();
  if (!directory) return;
  const names: string[] = [];
  for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.startsWith(DOWNLOAD_PREFIX)) names.push(name);
  }
  for (const name of names) {
    try {
      const file = await (await directory.getFileHandle(name)).getFile();
      if (now - file.lastModified > DOWNLOAD_KEEP_MS) await directory.removeEntry(name);
    } catch (error) {
      console.error(error);
    }
  }
}
