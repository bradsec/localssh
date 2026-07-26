import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HostKeyPrompt } from "./HostKeyPrompt.js";

const base = {
  hostPort: "10.0.0.4:22",
  fingerprint: "SHA256:abcdef",
  onTrust: vi.fn(),
  onCancel: vi.fn(),
};

describe("HostKeyPrompt", () => {
  // The icon is emphasis. The words carry the meaning, because colour and
  // shape alone must not be what tells someone the key changed.
  it("keeps the warning wording when the key changed", () => {
    render(<HostKeyPrompt {...base} changed previousFingerprint="SHA256:old" />);

    expect(screen.getByText("Security warning")).toBeInTheDocument();
    expect(screen.getByText("Host key changed")).toBeInTheDocument();
  });

  it("keeps the wording on a first connection", () => {
    render(<HostKeyPrompt {...base} changed={false} />);

    expect(screen.getByText("First connection")).toBeInTheDocument();
    expect(screen.getByText("Verify host key")).toBeInTheDocument();
  });

  it("adds no accessible name of its own for the icon", () => {
    const { container } = render(<HostKeyPrompt {...base} changed={false} />);
    const icons = container.querySelectorAll(".dialog-label svg");

    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the buttons worded", () => {
    render(<HostKeyPrompt {...base} changed={false} />);

    expect(screen.getByRole("button", { name: /trust and connect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
