// System-clipboard access for a page that is often served over plain HTTP on a
// LAN, where `navigator.clipboard` does not exist because the context is not
// secure. The async Clipboard API is tried first; the deprecated `execCommand`
// path is the only thing that works on plain HTTP, and it needs a real
// selection in the document, so it stages the text in an off-screen field and
// restores whatever selection the user already had.

/** Copies text to the clipboard. Resolves true only when the copy took. */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or an insecure context: fall back below.
    }
  }

  return copyViaExecCommand(text);
}

/**
 * Reads text from the clipboard, or null when the browser will not allow it
 * (no API, insecure context, or the permission was refused). Callers must have
 * a manual paste path for the null case.
 */
export async function readClipboardText(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function copyViaExecCommand(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;

  const staging = document.createElement("textarea");
  staging.value = text;
  staging.setAttribute("readonly", "");
  staging.style.position = "fixed";
  staging.style.top = "-9999px";
  staging.style.opacity = "0";
  document.body.appendChild(staging);

  const selection = document.getSelection();
  const preserved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  staging.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  staging.remove();
  if (preserved && selection) {
    selection.removeAllRanges();
    selection.addRange(preserved);
  }
  return ok;
}
