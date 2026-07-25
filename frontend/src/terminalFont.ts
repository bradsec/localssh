// Applying a new font size to the terminal.
//
// The terminal measures one character to size the cell grid every row is drawn
// against. Safari re-measures when the font family changes but not when only the
// size does, so a size change alone leaves the grid built for the previous size
// and the glyphs no longer line up with it: on a phone the row spacing visibly
// goes wrong, and picking the font again is what puts it right.
//
// Setting the family to something else and back to the real one is that same
// correction, applied for the user. iOS Safari can coalesce both writes when
// they happen in one turn, so phones keep the other family until the next frame.

/**
 * The part of the terminal this needs, so a test can supply a fake. Both options
 * are optional on the real terminal, which reports them as unset until written.
 */
export interface FontConfigurableTerminal {
  options: { fontSize?: number; fontFamily?: string };
}

export interface IOSDevice {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
}

/** Momentary family used only to make the terminal measure again. */
const REMEASURE_FAMILY = "monospace";
/** For when the wanted family is the one above, since a no-op change measures nothing. */
const ALTERNATE_REMEASURE_FAMILY = "sans-serif";
const SMALL_SCREEN_MAX_CSS_PIXELS = 600;

export function remeasureFamilyFor(fontFamily: string): string {
  return fontFamily === REMEASURE_FAMILY ? ALTERNATE_REMEASURE_FAMILY : REMEASURE_FAMILY;
}

export function applyFontOptions(
  terminal: FontConfigurableTerminal,
  fontSize: number,
  fontFamily: string,
): void {
  terminal.options.fontSize = fontSize;
  terminal.options.fontFamily = remeasureFamilyFor(fontFamily);
  terminal.options.fontFamily = fontFamily;
}

export function applyFontOptionsAcrossFrames(
  terminal: FontConfigurableTerminal,
  fontSize: number,
  fontFamily: string,
  afterRestore: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): () => void {
  terminal.options.fontSize = fontSize;
  terminal.options.fontFamily = remeasureFamilyFor(fontFamily);

  let frame = requestFrame(() => {
    // Schedule from inside the first frame so WebKit paints and measures the
    // temporary family before the preferred family is restored.
    frame = requestFrame(() => {
      terminal.options.fontFamily = fontFamily;
      afterRestore();
    });
  });

  return () => cancelFrame(frame);
}

export function isSmallScreenIOS(device: IOSDevice): boolean {
  const reportsIOS = /iPhone|iPad|iPod/.test(device.userAgent);
  const isTouchMac = device.platform === "MacIntel" && device.maxTouchPoints > 1;
  const shortScreenEdge = Math.min(device.screenWidth, device.screenHeight);

  return (reportsIOS || isTouchMac) && shortScreenEdge <= SMALL_SCREEN_MAX_CSS_PIXELS;
}
