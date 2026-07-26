import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { About } from "./About.js";
import { TerminalSettings } from "./TerminalSettings.js";
import { DEFAULT_FONT_FAMILY } from "../terminalFonts.js";
import { DEFAULT_THEME_NAME } from "../terminalThemes.js";

const settings = {
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  themeName: DEFAULT_THEME_NAME,
};

describe("toolbar labels", () => {
  // The name must come from real text, not an aria-label, so that the visual
  // label and the accessible name can never drift apart.
  it("keeps Appearance as its accessible name", () => {
    render(<TerminalSettings value={settings} onChange={() => {}} />);

    const summary = screen.getByRole("button", { name: "Appearance" });
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toHaveClass("toolbar-label");
  });

  it("keeps About as its accessible name", () => {
    render(<About />);

    const summary = screen.getByRole("button", { name: "About" });
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("About")).toHaveClass("toolbar-label");
  });

  it("renders exactly one icon per toolbar control", () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll("summary svg")).toHaveLength(1);
  });
});
