import { useEffect, useRef, useState } from "react";
import { TERMINAL_FONTS } from "../terminalFonts.js";
import { TERMINAL_THEMES } from "../terminalThemes.js";
import type { TerminalSettings } from "../storage/settingsStore.js";

export interface TerminalSettingsProps {
  value: TerminalSettings;
  onChange: (next: TerminalSettings) => void;
}

export function TerminalSettings({ value, onChange }: TerminalSettingsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  // <details> only toggles from its own summary, so an open panel would other-
  // wise stay open when the user clicks or taps anywhere else on the page.
  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: Event) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      detailsRef.current?.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <details
      className="terminal-settings"
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Appearance</summary>
      <fieldset>
        <legend className="visually-hidden">Terminal appearance</legend>
        <label className="field">
          <span>Font size</span>
          <input
            type="number"
            min={8}
            max={32}
            value={value.fontSize}
            onChange={(event) => {
              const fontSize = event.currentTarget.valueAsNumber;
              if (Number.isFinite(fontSize)) {
                onChange({ ...value, fontSize: Math.min(32, Math.max(8, fontSize)) });
              }
            }}
          />
        </label>
        <label className="field">
          <span>Font family</span>
          <select
            value={value.fontFamily}
            onChange={(event) => onChange({ ...value, fontFamily: event.target.value })}
          >
            {TERMINAL_FONTS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Color scheme</span>
          <select
            value={value.themeName}
            onChange={(event) => onChange({ ...value, themeName: event.target.value })}
          >
            {Object.keys(TERMINAL_THEMES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <dl className="gesture-legend">
          <dt>Touch gestures</dt>
          <dd><span>Swipe right</span> Tab</dd>
          <dd><span>Swipe left</span> Esc</dd>
          <dd><span>Flick up or down</span> Command history</dd>
          <dd><span>Pinch</span> Font size</dd>
        </dl>
      </fieldset>
    </details>
  );
}
