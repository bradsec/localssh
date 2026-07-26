import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Icon, type IconName } from "./Icon.js";

const NAMES: IconName[] = [
  "logout",
  "palette",
  "info",
  "keyboard",
  "warning",
  "key",
  "more_horiz",
  "edit",
  "delete",
  "add",
  "lock",
];

describe("Icon", () => {
  it("renders a path for every name", () => {
    for (const name of NAMES) {
      const { container } = render(<Icon name={name} />);
      const path = container.querySelector("path");

      expect(path, `${name} should render a path`).not.toBeNull();
      expect(path?.getAttribute("d") ?? "").not.toBe("");
    }
  });

  it("uses the Material Symbols viewBox", () => {
    const { container } = render(<Icon name="logout" />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 -960 960 960");
  });

  // The icon sits beside text that already names the control, so it must not
  // add a second name to the accessibility tree.
  it("is hidden from assistive technology", () => {
    const { container } = render(<Icon name="info" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("inherits the surrounding colour", () => {
    const { container } = render(<Icon name="palette" />);
    expect(container.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });

  it("takes a size", () => {
    const { container } = render(<Icon name="add" size={32} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("defaults to 20", () => {
    const { container } = render(<Icon name="add" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });
});
