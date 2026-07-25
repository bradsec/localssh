import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { About } from "./About.js";
import { HostKeyPrompt } from "./HostKeyPrompt.js";
import { TerminalSettings } from "./TerminalSettings.js";
import { loadTerminalSettings } from "../storage/settingsStore.js";

describe("accessibility focus management", () => {
  it("returns focus to Appearance when Escape closes its disclosure", async () => {
    const user = userEvent.setup();
    render(<TerminalSettings value={loadTerminalSettings()} onChange={() => {}} />);

    const summary = screen.getByText("Appearance");
    await user.click(summary);
    await user.tab();
    await user.keyboard("{Escape}");

    expect(summary).toHaveFocus();
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("returns focus to About when Escape closes its disclosure", async () => {
    const user = userEvent.setup();
    render(<About />);

    const summary = screen.getByText("About");
    await user.click(summary);
    await user.tab();
    await user.keyboard("{Escape}");

    expect(summary).toHaveFocus();
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("returns focus to the invoking control when the host-key dialog is cancelled", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Connect</button>
          {open && (
            <HostKeyPrompt
              hostPort="server.example:22"
              fingerprint="SHA256:test"
              onTrust={() => {}}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const connect = screen.getByRole("button", { name: "Connect" });
    await user.click(connect);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(connect).toHaveFocus());
  });
});
