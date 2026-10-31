import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Help, HelpProvider } from "./Help.js";
import { FilePanel } from "./FilePanel.js";
import type { SftpHandle, SshHandle } from "../ssh/engine.js";

it("cancels an upload and offers file recovery help", async () => {
  let rejectUpload!: (reason: string) => void;
  const files: SftpHandle = {
    list: vi.fn().mockResolvedValue([]),
    upload: vi.fn().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectUpload = reject;
        }),
    ),
    download: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  };
  const handle: SshHandle = {
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    openFiles: vi.fn().mockResolvedValue(files),
  };
  const user = userEvent.setup();
  render(
    <HelpProvider>
      <FilePanel handle={handle} onClose={vi.fn()} />
      <Help />
    </HelpProvider>,
  );
  await screen.findByText("No files in this directory. Choose another path or upload a file.");
  await user.upload(screen.getByLabelText("Upload file"), new File(["data"], "sample.txt"));
  await screen.findByText(/Uploading sample.txt: 0%/);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(files.cancel).toHaveBeenCalledOnce();
  rejectUpload("transfer cancelled");
  expect(
    await screen.findByText("Transfer of sample.txt stopped: transfer cancelled."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Learn more about files" }));
  expect(screen.getByRole("heading", { name: "Browse and transfer files" })).toBeVisible();
});
