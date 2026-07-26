import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordStrength } from "./PasswordStrength.js";

describe("PasswordStrength", () => {
  it("renders nothing until something is typed", () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the band and its advice", () => {
    render(<PasswordStrength password="short" />);

    expect(screen.getByText(/^weak$/i)).toBeInTheDocument();
    expect(screen.getByText(/longer/i)).toBeInTheDocument();
  });

  it("announces changes politely", () => {
    render(<PasswordStrength password="short" />);

    expect(screen.getByRole("status")).toHaveTextContent(/weak/i);
  });

  it("uses progressive stage colours for the filled bar", () => {
    const { container } = render(<PasswordStrength password="bramble thicket lantern quarry" />);
    const segments = [...container.querySelectorAll(".strength__segment--on")];

    expect(segments).toHaveLength(4);
    expect(segments[0]).toHaveClass("strength__segment--weak");
    expect(segments[1]).toHaveClass("strength__segment--fair");
    expect(segments[2]).toHaveClass("strength__segment--good");
    expect(segments[3]).toHaveClass("strength__segment--strong");
  });
});
