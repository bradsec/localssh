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

export const DEFAULT_FONT_FAMILY = '"Fira Code", monospace';
