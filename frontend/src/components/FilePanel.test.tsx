import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Help, HelpProvider } from "./Help.js";
import { FilePanel } from "./FilePanel.js";
import { displayName, sweepDownloads } from "../remoteFiles.js";
import type { RemoteFile, RemoteListing, SftpHandle, SshHandle } from "../ssh/engine.js";

function listing(path: string, entries: RemoteFile[] = []): RemoteListing {
  return { path, entries };
}

function makeFiles(overrides: Partial<SftpHandle> = {}): SftpHandle {
  return {
    list: vi.fn().mockResolvedValue(listing("/home/tester")),
    upload: vi.fn().mockResolvedValue(null),
    download: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function renderPanel(files: SftpHandle, onClose = vi.fn()) {
  const handle: SshHandle = {
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    openFiles: vi.fn().mockResolvedValue(files),
  };
  const view = render(
    <HelpProvider>
      <FilePanel handle={handle} onClose={onClose} />
      <Help />
    </HelpProvider>,
  );
  return { ...view, onClose, user: userEvent.setup() };
}

/** An in-memory stand-in for the origin private file system root. */
function fakeDirectory(options: { writable: boolean; files?: Record<string, number> }) {
  const stored = new Map<string, number>(Object.entries(options.files ?? {}));
  const written: ArrayBuffer[] = [];
  const directory = {
    getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      if (!stored.has(name)) {
        if (!opts?.create) throw new DOMException("missing", "NotFoundError");
        stored.set(name, Date.now());
      }
      return {
        ...(options.writable && {
          createWritable: async () => ({
            write: async (data: ArrayBuffer) => {
              written.push(data);
            },
            close: async () => {},
            abort: async () => {},
          }),
        }),
        getFile: async () =>
          Object.assign(new Blob(written), {
            lastModified: stored.get(name) ?? 0,
          }),
      };
    }),
    removeEntry: vi.fn(async (name: string) => {
      stored.delete(name);
    }),
    keys: async function* () {
      yield* [...stored.keys()];
    },
  };
  Object.defineProperty(navigator, "storage", {
    value: { getDirectory: async () => directory },
    configurable: true,
  });
  return { directory, stored };
}

const downloadOneChunk = vi.fn(
  async (
    _path: string,
    onChunk: (chunk: Uint8Array) => Promise<void>,
    onProgress: (n: number) => void,
  ) => {
    await onChunk(new Uint8Array([1, 2, 3]));
    onProgress(100);
    return undefined;
  },
);

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "storage");
});

it("cancels an upload and offers file recovery help", async () => {
  let rejectUpload!: (reason: string) => void;
  const files = makeFiles({
    upload: vi.fn().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectUpload = reject;
        }),
    ),
  });
  const { user } = renderPanel(files);
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

describe("browsing", () => {
  it("labels links and opens folders through them", async () => {
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValueOnce(
          listing("/home/tester", [
            { name: "logs", kind: "folder", isLink: true, size: 4096 },
            { name: "notes", kind: "file", isLink: true, size: 12 },
            { name: "gone", kind: "broken", isLink: true, size: 0 },
            { name: "fifo", kind: "other", isLink: false, size: 0 },
          ]),
        )
        .mockResolvedValueOnce(listing("/data/logs")),
    });
    const { user } = renderPanel(files);
    expect(await screen.findByText("Link to folder")).toBeVisible();
    expect(screen.getByText("Link to file, 12 bytes")).toBeVisible();
    expect(screen.getByText("Broken link")).toBeVisible();
    expect(screen.getByText("Special file")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download file notes" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download file gone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download file fifo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download file logs" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "logs/" }));
    expect(files.list).toHaveBeenLastCalledWith("/home/tester/logs");
    expect(await screen.findByText("/data/logs")).toBeVisible();
    expect(screen.getByLabelText("Remote path")).toHaveValue("/data/logs");
  });

  it("goes up to the parent folder and stops at the root", async () => {
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValueOnce(listing("/home/tester"))
        .mockResolvedValueOnce(listing("/home"))
        .mockResolvedValueOnce(listing("/")),
    });
    const { user } = renderPanel(files);
    expect(await screen.findByText("/home/tester")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Up to parent folder" }));
    expect(files.list).toHaveBeenLastCalledWith("/home");
    await screen.findByText("/home");
    await user.click(screen.getByRole("button", { name: "Up to parent folder" }));
    expect(files.list).toHaveBeenLastCalledWith("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Up to parent folder" })).toBeDisabled(),
    );
  });

  it("shows hostile names with bidi and control characters escaped", async () => {
    const name = "report\u202egpj.exe\u0007";
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValue(listing("/srv", [{ name, kind: "file", isLink: false, size: 1 }])),
      download: downloadOneChunk,
    });
    const { user } = renderPanel(files);
    expect(await screen.findByText("report<U+202E>gpj.exe<U+0007>")).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Download file report<U+202E>gpj.exe<U+0007>",
      }),
    );
    expect(files.download).toHaveBeenCalledWith(
      `/srv/${name}`,
      expect.any(Function),
      expect.any(Function),
    );
    const saved = await screen.findByRole("link", { name: "Save download" });
    expect(saved).toHaveAttribute("download", "report<U+202E>gpj.exe<U+0007>");
  });
});

it("keeps names without unsafe characters unchanged", () => {
  expect(displayName("résumé 2026.pdf")).toBe("résumé 2026.pdf");
  expect(displayName("a\u2066b\u200fc")).toBe("a<U+2066>b<U+200F>c");
});

describe("replace", () => {
  it("asks before replacing when the engine finds the file, then overwrites", async () => {
    const files = makeFiles({
      upload: vi.fn().mockRejectedValueOnce("remote file exists").mockResolvedValueOnce(null),
    });
    const { user } = renderPanel(files);
    await screen.findByText("No files in this directory. Choose another path or upload a file.");
    const file = new File(["new"], "deploy.sh");
    await user.upload(screen.getByLabelText("Upload file"), file);
    const prompt = await screen.findByRole("alertdialog", {
      name: "Replace file",
    });
    expect(prompt).toHaveTextContent("keeps the old file's permissions, but not its owner");
    expect(prompt).toHaveTextContent("the link itself is replaced and its target is not changed");
    expect(files.upload).toHaveBeenLastCalledWith(
      "/home/tester/deploy.sh",
      file,
      false,
      expect.any(Function),
    );
    await user.click(screen.getByRole("button", { name: "Replace file" }));
    expect(files.upload).toHaveBeenLastCalledWith(
      "/home/tester/deploy.sh",
      file,
      true,
      expect.any(Function),
    );
    expect(await screen.findByText("Uploaded deploy.sh.")).toBeVisible();
  });
});

describe("closing", () => {
  it("asks before closing during a transfer", async () => {
    const files = makeFiles({
      upload: vi.fn(() => new Promise<void>(() => {})),
    });
    const { user, onClose } = renderPanel(files);
    await screen.findByText("No files in this directory. Choose another path or upload a file.");
    await user.upload(screen.getByLabelText("Upload file"), new File(["data"], "big.iso"));
    await user.click(screen.getByRole("button", { name: "Close files" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Stop transfer" })).toHaveTextContent(
      "Uploading big.iso is not finished",
    );
    await user.click(screen.getByRole("button", { name: "Keep transferring" }));
    expect(screen.queryByRole("alertdialog", { name: "Stop transfer" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close files" }));
    await user.click(screen.getByRole("button", { name: "Stop and close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes at once when no transfer runs", async () => {
    const { user, onClose } = renderPanel(makeFiles());
    await screen.findByText("No files in this directory. Choose another path or upload a file.");
    await user.click(screen.getByRole("button", { name: "Close files" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a closed file connection instead of an empty folder", async () => {
    // A released engine function returns undefined rather than a Promise.
    const files = makeFiles({ list: vi.fn().mockReturnValue(undefined) });
    renderPanel(files);
    expect(await screen.findByRole("alert")).toHaveTextContent("Files is no longer connected");
  });
});

describe("listing cap", () => {
  it("says when the folder listing was truncated", async () => {
    const files = makeFiles({
      list: vi.fn().mockResolvedValue({
        path: "/srv",
        entries: [{ name: "a.txt", kind: "file", isLink: false, size: 3 }],
        truncated: true,
      }),
    });
    renderPanel(files);
    expect(await screen.findByText("Showing the first 10,000 items in this folder.")).toBeVisible();
  });
});

describe("downloads", () => {
  it("falls back to memory when browser storage has no createWritable", async () => {
    const { directory, stored } = fakeDirectory({ writable: false });
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValue(
          listing("/srv", [{ name: "a.txt", kind: "file", isLink: false, size: 3 }]),
        ),
      download: downloadOneChunk,
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file a.txt" }));
    expect(await screen.findByText("Downloaded a.txt.")).toBeVisible();
    expect(directory.removeEntry).toHaveBeenCalledOnce();
    expect(stored.size).toBe(0);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("reports a file that grew while downloading on both storage paths", async () => {
    for (const writable of [true, false]) {
      fakeDirectory({ writable });
      const files = makeFiles({
        list: vi
          .fn()
          .mockResolvedValue(
            listing("/srv", [{ name: "a.log", kind: "file", isLink: false, size: 1234 }]),
          ),
        download: vi.fn(async (_p: string, onChunk: (c: Uint8Array) => Promise<void>) => {
          await onChunk(new Uint8Array([1, 2, 3]));
          return { grew: true, size: 1234 };
        }),
      });
      const { user, unmount } = renderPanel(files);
      await user.click(await screen.findByRole("button", { name: "Download file a.log" }));
      expect(
        await screen.findByText("The file grew while downloading. Saved the first 1,234 bytes."),
      ).toBeVisible();
      unmount();
    }
  });

  it("keeps the stored copy until the next transfer and removes it on close", async () => {
    const { directory, stored } = fakeDirectory({ writable: true });
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValue(
          listing("/srv", [{ name: "a.txt", kind: "file", isLink: false, size: 3 }]),
        ),
      download: downloadOneChunk,
    });
    const { user, unmount } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file a.txt" }));
    expect(await screen.findByRole("link", { name: "Save download" })).toBeVisible();
    expect(stored.size).toBe(1);
    expect(directory.removeEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Download file a.txt" }));
    await screen.findByRole("link", { name: "Save download" });
    expect(directory.removeEntry).toHaveBeenCalledOnce();
    expect(stored.size).toBe(1);
    unmount();
    await waitFor(() => expect(stored.size).toBe(0));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("removes the stored copy when the page is hidden", async () => {
    const { stored } = fakeDirectory({ writable: true });
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValue(
          listing("/srv", [{ name: "a.txt", kind: "file", isLink: false, size: 3 }]),
        ),
      download: downloadOneChunk,
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file a.txt" }));
    await screen.findByRole("link", { name: "Save download" });
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(stored.size).toBe(0));
  });

  it("sweeps only download copies older than ten minutes", async () => {
    const now = Date.now();
    const { stored } = fakeDirectory({
      writable: true,
      files: {
        "localssh-download-old": now - 11 * 60_000,
        "localssh-download-live": now - 60_000,
        "other-app-file": now - 60 * 60_000,
      },
    });
    await sweepDownloads(now);
    expect([...stored.keys()].sort()).toEqual(["localssh-download-live", "other-app-file"]);
  });
});
