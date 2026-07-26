export interface TerminalFontOption {
  label: string;
  value: string;
}

export const TERMINAL_FONTS: TerminalFontOption[] = [
  { label: "System Monospace", value: "monospace" },
  { label: "Fira Code", value: '"Fira Code", monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { label: "Cascadia Code", value: '"Cascadia Code", monospace' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", monospace' },
];

export const DEFAULT_FONT_FAMILY = "monospace";

export async function loadTerminalFont(fontFamily: string): Promise<void> {
  switch (fontFamily) {
    case '"Fira Code", monospace':
      await import("./fonts/fira-code.css");
      break;
    case '"JetBrains Mono", monospace':
      await import("./fonts/jetbrains-mono.css");
      break;
    case '"Cascadia Code", monospace':
      await import("./fonts/cascadia-code.css");
      break;
    case '"IBM Plex Mono", monospace':
      await import("./fonts/ibm-plex-mono.css");
      break;
    case '"Source Code Pro", monospace':
      await import("./fonts/source-code-pro.css");
      break;
  }
}
