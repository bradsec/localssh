// Applying a new font size to the terminal.
//
// The terminal measures one character to size the cell grid every row is drawn
// against. Safari re-measures when the font family changes but not when only the
// size does, so a size change alone leaves the grid built for the previous size
// and the glyphs no longer line up with it: on a phone the row spacing visibly
// goes wrong, and picking the font again is what puts it right.
//
// Setting the family to something else and straight back to the real one is that
// same correction, applied for the user. Both writes happen in one turn, so
// nothing is painted with the intermediate family.

/**
 * The part of the terminal this needs, so a test can supply a fake. Both options
 * are optional on the real terminal, which reports them as unset until written.
 */
export interface FontConfigurableTerminal {
  options: { fontSize?: number; fontFamily?: string };
}

/** Momentary family used only to make the terminal measure again. */
const REMEASURE_FAMILY = "monospace";
/** For when the wanted family is the one above, since a no-op change measures nothing. */
const ALTERNATE_REMEASURE_FAMILY = "sans-serif";

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
