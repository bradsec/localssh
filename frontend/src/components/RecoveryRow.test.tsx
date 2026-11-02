import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecoveryRow } from "./RecoveryRow.js";

describe("RecoveryRow", () => {
  it("names a download the closed session cut short", () => {
    render(
      <RecoveryRow
        cause="network"
        onReconnect={vi.fn()}
        onClose={vi.fn()}
        stoppedDownload={{ name: "backup.tar.gz", percent: 42 }}
      />,
    );
    expect(screen.getByText("Download of backup.tar.gz stopped at 42%.")).toBeVisible();
  });

  it("shows no download line without one", () => {
    render(<RecoveryRow cause="server" onReconnect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/Download of/)).toBeNull();
  });
});
