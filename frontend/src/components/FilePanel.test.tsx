import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Help, HelpProvider } from "./Help.js";
import { FilePanel, type FilePanelProps } from "./FilePanel.js";
import { ToastProvider } from "./Toasts.js";
import { displayName, sweepDownloads } from "../remoteFiles.js";
import {
  type DownloadRecord,
  SEGMENT_BYTES,
  TAIL_BYTES,
  deleteRecord,
  listRecords,
  openSegmentedDownload,
  segmentName,
} from "../downloadStore.js";
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

function renderPanel(
  files: SftpHandle,
  onClose = vi.fn(),
  openFiles = vi.fn().mockResolvedValue(files),
  extra: Partial<FilePanelProps> = {},
) {
  const handle: SshHandle = {
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    openFiles,
  };
  const tree = (more: Partial<FilePanelProps>) => (
    <ToastProvider>
      <HelpProvider>
        <FilePanel
          handle={handle}
          onClose={onClose}
          expanded={false}
          onExpand={() => {}}
          transport="connected"
          identity={{ host: "example.test", port: 22, username: "tester" }}
          {...extra}
          {...more}
        />
        <Help />
      </HelpProvider>
    </ToastProvider>
  );
  const view = render(tree({}));
  return {
    ...view,
    onClose,
    user: userEvent.setup(),
    setProps: (more: Partial<FilePanelProps>) => view.rerender(tree(more)),
  };
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

beforeEach(async () => {
  // Resumable download records live in IndexedDB across tests; start clean.
  const noFiles = {
    async *keys() {},
    removeEntry: async () => {},
  } as unknown as FileSystemDirectoryHandle;
  for (const record of await listRecords()) await deleteRecord(noFiles, record.id);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(
        async (
          name: string,
          _options: unknown,
          callback: (lock: Lock | null) => Promise<unknown>,
        ) => {
          if (held.has(name)) return callback(null);
          held.add(name);
          try {
            return await callback({ name, mode: "exclusive" } as Lock);
          } finally {
            held.delete(name);
          }
        },
      ),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "storage");
  Reflect.deleteProperty(navigator, "locks");
});

it("cancels an upload and shows an informational toast", async () => {
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
  rejectUpload("connection closed");
  expect(
    await screen.findByText(
      "Files is no longer connected. Close Files and select Files again, or reconnect the tab.",
    ),
  ).toBeVisible();
  expect(document.querySelector(".toast--info")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Learn more about files" })).toBeNull();
});

describe("browsing", () => {
  it("keeps a typed path when the initial listing finishes", async () => {
    let finishInitial!: (value: RemoteListing) => void;
    const initial = new Promise<RemoteListing>((resolve) => {
      finishInitial = resolve;
    });
    const files = makeFiles({
      list: vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(listing("/huge")),
    });
    const { user } = renderPanel(files);
    await user.click(screen.getByRole("button", { name: "Go to path" }));
    fireEvent.change(screen.getByLabelText("Remote path"), { target: { value: "/huge" } });
    finishInitial(listing("/"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open$/ })).toBeEnabled());
    expect(screen.getByLabelText("Remote path")).toHaveValue("/huge");
    await user.click(screen.getByRole("button", { name: /^Open$/ }));
    expect(files.list).toHaveBeenLastCalledWith("/huge");
  });

  it("sorts by size while folders remain first", async () => {
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(
        listing("/srv", [
          { name: "large.txt", kind: "file", isLink: false, size: 20, mtime: 0, mode: "rw-r--r--" },
          { name: "folder", kind: "folder", isLink: false, size: 0, mtime: 0, mode: "rwxr-xr-x" },
          { name: "small.txt", kind: "file", isLink: false, size: 2, mtime: 0, mode: "rw-r--r--" },
        ]),
      ),
    });
    const { user } = renderPanel(files);
    await screen.findByText("large.txt");
    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("folder"),
      expect.stringContaining("small.txt"),
      expect.stringContaining("large.txt"),
    ]);
  });

  it("opens a folder from a breadcrumb", async () => {
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValueOnce(listing("/home/tester/logs"))
        .mockResolvedValueOnce(listing("/home/tester")),
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "tester" }));
    expect(files.list).toHaveBeenLastCalledWith("/home/tester");
  });

  it("moves row selection with arrows and opens a folder with Enter", async () => {
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValueOnce(
          listing("/srv", [
            { name: "alpha", kind: "folder", isLink: false, size: 0, mtime: 0, mode: "rwxr-xr-x" },
            { name: "beta", kind: "folder", isLink: false, size: 0, mtime: 0, mode: "rwxr-xr-x" },
          ]),
        )
        .mockResolvedValueOnce(listing("/srv/beta")),
    });
    const { user } = renderPanel(files);
    const first = (await screen.findByText("alpha/")).closest("td")!;
    first.focus();
    await user.keyboard("{ArrowDown}");
    const second = screen.getByText("beta/").closest("tr")!;
    expect(second).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(files.list).toHaveBeenLastCalledWith("/srv/beta");
  });

  it("labels links and opens folders through them", async () => {
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValueOnce(
          listing("/home/tester", [
            { name: "logs", kind: "folder", isLink: true, size: 4096, mtime: 0, mode: "rwxr-xr-x" },
            { name: "notes", kind: "file", isLink: true, size: 12, mtime: 0, mode: "rw-r--r--" },
            { name: "gone", kind: "broken", isLink: true, size: 0, mtime: 0, mode: "" },
            { name: "fifo", kind: "other", isLink: false, size: 0, mtime: 0, mode: "" },
          ]),
        )
        .mockResolvedValueOnce(listing("/data/logs")),
    });
    const { user } = renderPanel(files);
    expect(await screen.findByText("logs/")).toBeVisible();
    expect(screen.getByText("notes")).toBeVisible();
    expect(screen.getByText("gone")).toBeVisible();
    expect(screen.getByText("fifo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download file notes" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download file gone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download file fifo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download file logs" })).toBeNull();
    await user.dblClick(screen.getByText("logs/"));
    expect(files.list).toHaveBeenLastCalledWith("/home/tester/logs");
    expect(await screen.findByRole("navigation", { name: "Current folder" })).toHaveTextContent(
      "logs",
    );
    await user.click(screen.getByRole("button", { name: "Go to path" }));
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
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Current folder" })).toHaveTextContent(
        "tester",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Up to parent folder" }));
    expect(files.list).toHaveBeenLastCalledWith("/home");
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Current folder" })).not.toHaveTextContent(
        "tester",
      ),
    );
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
        .mockResolvedValue(
          listing("/srv", [
            { name, kind: "file", isLink: false, size: 1, mtime: 0, mode: "rw-r--r--" },
          ]),
        ),
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
  it("uses the same overwrite confirmation for a dropped file", async () => {
    const files = makeFiles({ upload: vi.fn().mockRejectedValueOnce("remote file exists") });
    renderPanel(files);
    await screen.findByText("No files in this directory. Choose another path or upload a file.");
    const file = new File(["new"], "deploy.sh");
    fireEvent.drop(screen.getByRole("region", { name: "Files" }), {
      dataTransfer: { files: [file] },
    });
    expect(await screen.findByRole("alertdialog", { name: "Replace file" })).toBeVisible();
    expect(files.upload).toHaveBeenCalledWith(
      "/home/tester/deploy.sh",
      file,
      false,
      expect.any(Function),
    );
  });

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
  it("retries opening Files after an initial connection failure", async () => {
    const files = makeFiles();
    const openFiles = vi
      .fn()
      .mockRejectedValueOnce("permission denied")
      .mockResolvedValueOnce(files);
    const { user } = renderPanel(files, vi.fn(), openFiles);
    await screen.findByText(/Cannot open/);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(openFiles).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("No files in this directory. Choose another path or upload a file."),
    ).toBeVisible();
  });
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
    expect(await screen.findByText(/Files is no longer connected/)).toBeVisible();
  });
});

function manyFiles(count: number): RemoteFile[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index).padStart(4, "0")}.txt`,
    kind: "file" as const,
    isLink: false,
    size: index,
    mtime: 0,
    mode: "rw-r--r--",
  }));
}

describe("large folders", () => {
  it("filters entries by name as you type and shows a live count", async () => {
    const entries = [
      ...manyFiles(1998),
      { name: "Report.PDF", kind: "file" as const, isLink: false, size: 1, mtime: 0, mode: "" },
      { name: "reports", kind: "folder" as const, isLink: false, size: 0, mtime: 0, mode: "" },
    ];
    const files = makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", entries)) });
    const { user } = renderPanel(files);
    await screen.findByText("reports/");
    const count = screen.getByText("2,000 items");
    expect(count).toHaveAttribute("role", "status");
    expect(count).toHaveAttribute("aria-live", "polite");
    await user.type(screen.getByRole("searchbox", { name: "Filter files" }), "REPORT");
    expect(count).toHaveTextContent("2 of 2,000 items");
    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining("reports/"), expect.stringContaining("Report.PDF")]);
    await user.type(screen.getByRole("searchbox", { name: "Filter files" }), "zzz");
    expect(count).toHaveTextContent("0 of 2,000 items");
    expect(screen.getByText("No items match this filter.")).toBeVisible();
  });

  it("restores the list and the selection when the filter is cleared", async () => {
    const files = makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", manyFiles(50))) });
    const { user } = renderPanel(files);
    await user.click(await screen.findByText("file-0003.txt"));
    const filter = screen.getByRole("searchbox", { name: "Filter files" });
    await user.type(filter, "0042");
    expect(screen.queryByText("file-0003.txt")).toBeNull();
    await user.clear(filter);
    expect(screen.getByText("50 items")).toBeVisible();
    expect(screen.getByText("file-0003.txt").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders only visible rows and keeps keyboard selection working to the last item", async () => {
    const files = makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", manyFiles(2000))) });
    const { user } = renderPanel(files);
    const firstCell = (await screen.findByText("file-0000.txt")).closest("td")!;
    const grid = screen.getByRole("grid", { name: "Files in /srv" });
    expect(grid).toHaveAttribute("aria-rowcount", "2001");
    expect(screen.getAllByRole("row").length).toBeLessThan(60);
    firstCell.focus();
    await user.keyboard("{End}");
    const last = screen.getByText("file-1999.txt").closest("tr")!;
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveAttribute("aria-rowindex", "2001");
    expect(last.querySelector("td")).toHaveFocus();
    expect(screen.getAllByRole("row").length).toBeLessThan(60);
    await user.keyboard("{ArrowUp}");
    expect(screen.getByText("file-1998.txt").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Home}");
    expect(screen.getByText("file-0000.txt").closest("tr")).toHaveAttribute("aria-rowindex", "2");
    await user.keyboard("{PageDown}");
    const paged = screen
      .getAllByRole("row")
      .find((row) => row.getAttribute("aria-selected") === "true")!;
    expect(Number(paged.getAttribute("aria-rowindex"))).toBeGreaterThan(3);
    expect(paged.querySelector("td")).toHaveFocus();
    await user.keyboard("{PageUp}");
    expect(screen.getByText("file-0000.txt").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("uses 32px rows for a fine pointer and 44px rows for a coarse pointer", async () => {
    const files = makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", manyFiles(3))) });
    const { unmount } = renderPanel(files);
    const row = (await screen.findByText("file-0000.txt")).closest("tr")!;
    expect(row.style.height).toBe("32px");
    expect(screen.getByRole("region", { name: "Files" }).style.getPropertyValue("--file-row")).toBe(
      "32px",
    );
    unmount();
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      renderPanel(files);
      expect((await screen.findByText("file-0000.txt")).closest("tr")!.style.height).toBe("44px");
    } finally {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });
});

describe("listing cap", () => {
  it("says when the folder listing was truncated", async () => {
    const files = makeFiles({
      list: vi.fn().mockResolvedValue({
        path: "/srv",
        entries: [
          { name: "a.txt", kind: "file", isLink: false, size: 3, mtime: 0, mode: "rw-r--r--" },
        ],
        truncated: true,
      }),
    });
    renderPanel(files);
    expect(
      (await screen.findAllByText("Showing the first 10,000 items in this folder.")).length,
    ).toBe(2);
  });
});

describe("downloads", () => {
  it("falls back to memory when browser storage has no createWritable", async () => {
    const { directory, stored } = fakeDirectory({ writable: false });
    const files = makeFiles({
      list: vi
        .fn()
        .mockResolvedValue(
          listing("/srv", [
            { name: "a.txt", kind: "file", isLink: false, size: 3, mtime: 0, mode: "rw-r--r--" },
          ]),
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
        list: vi.fn().mockResolvedValue(
          listing("/srv", [
            {
              name: "a.log",
              kind: "file",
              isLink: false,
              size: 1234,
              mtime: 0,
              mode: "rw-r--r--",
            },
          ]),
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
          listing("/srv", [
            { name: "a.txt", kind: "file", isLink: false, size: 3, mtime: 0, mode: "rw-r--r--" },
          ]),
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
          listing("/srv", [
            { name: "a.txt", kind: "file", isLink: false, size: 3, mtime: 0, mode: "rw-r--r--" },
          ]),
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

describe("transfer states", () => {
  const entry: RemoteFile = {
    name: "backup.tar.gz",
    kind: "file",
    isLink: false,
    size: 100,
    mtime: 5,
    mode: "rw-r--r--",
  };

  /** A download the test advances by hand. */
  function manualDownload() {
    const control = {
      progress: (_n: number) => {},
      finish: () => {},
      fail: (_reason: string) => {},
    };
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download: vi.fn(
        (_p: string, onChunk: (c: Uint8Array) => Promise<void>, onProgress: (n: number) => void) =>
          new Promise<undefined>((resolve, reject) => {
            control.progress = onProgress;
            control.finish = () => void onChunk(new Uint8Array([1])).then(() => resolve(undefined));
            control.fail = (reason) => reject(reason);
          }),
      ),
    });
    return { files, control };
  }

  async function startDownload(setup: ReturnType<typeof manualDownload>, extra = {}) {
    fakeDirectory({ writable: true });
    const panel = renderPanel(setup.files, vi.fn(), undefined, extra);
    await panel.user.click(
      await screen.findByRole("button", { name: "Download file backup.tar.gz" }),
    );
    await screen.findByText(/Downloading backup.tar.gz: 0%/);
    return panel;
  }

  it("shows the X-01 line with a live percent", async () => {
    const setup = manualDownload();
    await startDownload(setup);
    act(() => setup.control.progress(42));
    expect(screen.getByText(/Downloading backup.tar.gz: 42%/)).toBeVisible();
  });

  it("shows the X-02 text while resuming in the background", async () => {
    const setup = manualDownload();
    const { setProps } = await startDownload(setup);
    act(() => setup.control.progress(42));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    setProps({ transport: "resuming" });
    expect(screen.getByText("Paused: backup.tar.gz at 42%.")).toBeVisible();
    expect(screen.getByText("Downloads pause while localssh is in the background.")).toBeVisible();
  });

  it("shows the X-03 text while resuming in the foreground and disables other controls", async () => {
    const setup = manualDownload();
    const { setProps } = await startDownload(setup);
    act(() => setup.control.progress(42));
    setProps({ transport: "resuming" });
    expect(screen.getByText("Resuming backup.tar.gz from 42%...")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh files" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download file backup.tar.gz" })).toBeDisabled();
    expect(screen.getByLabelText("Upload file")).toBeDisabled();
  });

  it("returns to X-01 and announces X-04 when the session resumes", async () => {
    const setup = manualDownload();
    const { setProps } = await startDownload(setup);
    act(() => setup.control.progress(42));
    setProps({ transport: "resuming" });
    setProps({ transport: "connected" });
    expect(screen.getByText(/Downloading backup.tar.gz: 42%/)).toBeVisible();
    expect(screen.getByTestId("transfer-announcement")).toHaveTextContent("Download resumed.");
  });

  it("keeps the close confirmation while a download is resuming", async () => {
    const setup = manualDownload();
    const { setProps, user, onClose } = await startDownload(setup);
    setProps({ transport: "resuming" });
    await user.click(screen.getByRole("button", { name: "Close files" }));
    expect(screen.getByRole("alertdialog", { name: "Stop transfer" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("announces on state changes and every 25 percent, not on each percent", async () => {
    const setup = manualDownload();
    await startDownload(setup);
    const live = screen.getByTestId("transfer-announcement");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("Downloading backup.tar.gz, 0 percent.");
    act(() => setup.control.progress(10));
    expect(live).toHaveTextContent("Downloading backup.tar.gz, 0 percent.");
    act(() => setup.control.progress(26));
    expect(live).toHaveTextContent("Downloading backup.tar.gz, 25 percent.");
    act(() => setup.control.progress(49));
    expect(live).toHaveTextContent("Downloading backup.tar.gz, 25 percent.");
    act(() => setup.control.progress(50));
    expect(live).toHaveTextContent("Downloading backup.tar.gz, 50 percent.");
  });

  it("writes the download as a segmented record and removes it when the link is released", async () => {
    const { directory, stored } = fakeDirectory({ writable: true });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download: downloadOneChunk,
    });
    const { user, unmount } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await screen.findByRole("link", { name: "Save download" });
    expect([...stored.keys()].some((name) => name.startsWith("localssh-dl-"))).toBe(true);
    unmount();
    await waitFor(() =>
      expect([...stored.keys()].filter((name) => name.startsWith("localssh-dl-"))).toEqual([]),
    );
    expect(directory.removeEntry).toHaveBeenCalled();
  });

  it("reports the stopped percent when the connection closes mid-download", async () => {
    const setup = manualDownload();
    const onDownloadStop = vi.fn();
    await startDownload(setup, { onDownloadStop });
    act(() => setup.control.progress(42));
    expect(onDownloadStop).toHaveBeenLastCalledWith({ name: "backup.tar.gz", percent: 42 });
    await act(async () => setup.control.fail("connection closed"));
    expect(onDownloadStop).not.toHaveBeenLastCalledWith(null);
  });

  it("clears the stopped report when the user cancels", async () => {
    const setup = manualDownload();
    const onDownloadStop = vi.fn();
    const { user } = await startDownload(setup, { onDownloadStop });
    act(() => setup.control.progress(42));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => setup.control.fail("transfer cancelled"));
    await waitFor(() => expect(onDownloadStop).toHaveBeenLastCalledWith(null));
  });
});

/**
 * An origin directory that keeps each file's bytes. Like OPFS, a writable's
 * data appears only on close, and abort discards it.
 */
function segmentDirectory() {
  const files = new Map<string, Uint8Array>();
  const directory = {
    getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException("missing", "NotFoundError");
        files.set(name, new Uint8Array());
      }
      return {
        createWritable: async () => {
          const parts: Uint8Array[] = [];
          return {
            write: async (data: Uint8Array) => {
              parts.push(new Uint8Array(data));
            },
            close: async () => {
              files.set(name, new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()));
            },
            abort: async () => {},
          };
        },
        getFile: async () => {
          const data = files.get(name);
          if (!data) throw new DOMException("missing", "NotFoundError");
          return new File([data.slice()], name);
        },
      };
    }),
    removeEntry: vi.fn(async (name: string) => {
      if (!files.delete(name)) throw new DOMException("missing", "NotFoundError");
    }),
    keys: async function* () {
      yield* [...files.keys()];
    },
  };
  Object.defineProperty(navigator, "storage", {
    value: { getDirectory: async () => directory },
    configurable: true,
  });
  return { directory: directory as unknown as FileSystemDirectoryHandle, files };
}

describe("download resume", () => {
  const size = 2 * SEGMENT_BYTES;
  const entry: RemoteFile = {
    name: "backup.tar.gz",
    kind: "file",
    isLink: false,
    size,
    mtime: 5,
    mode: "rw-r--r--",
  };
  const source = new Uint8Array(size).map((_, index) => index % 251);

  /** Stores a record whose first segment is committed, as a lost session leaves it. */
  async function seedRecord(
    directory: FileSystemDirectoryHandle,
    overrides: Partial<DownloadRecord> = {},
  ): Promise<DownloadRecord> {
    const record: DownloadRecord = {
      id: crypto.randomUUID(),
      host: "example.test",
      port: 22,
      user: "tester",
      remotePath: "/srv/backup.tar.gz",
      size,
      mtime: 5,
      committedBytes: 0,
      segments: [],
      createdAt: Date.now(),
      ...overrides,
    };
    const writer = await openSegmentedDownload(directory, record);
    await writer.write(source.subarray(0, SEGMENT_BYTES + 10));
    await writer.abort();
    return (await listRecords()).find((stored) => stored.id === record.id)!;
  }

  /** A download that sends source from the requested offset. */
  function serveSource() {
    return vi.fn(
      async (
        _path: string,
        onChunk: (chunk: Uint8Array) => Promise<void>,
        onProgress: (n: number) => void,
        opts?: { offset?: number; tail?: Uint8Array },
      ) => {
        const from = opts?.offset ?? 0;
        await onChunk(source.subarray(from, SEGMENT_BYTES));
        await onChunk(source.subarray(Math.max(from, SEGMENT_BYTES)));
        onProgress(100);
        return { grew: false, size };
      },
    );
  }

  function captureBlobs() {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:test";
    });
    return blobs;
  }

  async function sameAsSource(blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bytes.byteLength === source.byteLength && bytes.every((b, i) => b === source[i]);
  }

  it("offers X-07 for this host's stopped download and resumes from the committed offset", async () => {
    const { directory } = segmentDirectory();
    const record = await seedRecord(directory);
    const blobs = captureBlobs();
    const download = serveSource();
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
    });
    const { user } = renderPanel(files);
    const block = await screen.findByRole("alert");
    expect(block).toHaveTextContent("backup.tar.gz stopped at 50% when the connection closed.");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume download" }));
    await screen.findByRole("link", { name: "Save download" });
    expect(download).toHaveBeenCalledOnce();
    const [path, , , opts] = download.mock.calls[0]!;
    expect(path).toBe("/srv/backup.tar.gz");
    expect(opts).toMatchObject({ offset: SEGMENT_BYTES, expectSize: size, expectMtime: 5 });
    expect(opts?.tail).toEqual(source.slice(SEGMENT_BYTES - TAIL_BYTES, SEGMENT_BYTES));
    expect(await sameAsSource(blobs.at(-1)!)).toBe(true);
    expect(screen.queryByText(/stopped at/)).not.toBeInTheDocument();
    expect((await listRecords()).map((stored) => stored.id)).toEqual([record.id]);
  });

  it("allows only one page to resume a stored download", async () => {
    const { directory } = segmentDirectory();
    const record = await seedRecord(directory);
    let finish!: () => void;
    const download = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    const first = renderPanel(makeFiles({ download }));
    const second = renderPanel(makeFiles({ download }));
    const firstResume = await within(first.container).findByRole("button", {
      name: "Resume download",
    });
    const secondResume = await within(second.container).findByRole("button", {
      name: "Resume download",
    });
    await first.user.click(firstResume);
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    await second.user.click(secondResume);
    await waitFor(() => expect(navigator.locks.request).toHaveBeenCalledTimes(2));
    expect(download).toHaveBeenCalledTimes(1);
    expect((await listRecords()).some((item) => item.id === record.id)).toBe(true);
    finish();
    await within(first.container).findByRole("link", { name: "Save download" });
    await second.user.click(secondResume);
    await waitFor(() => expect(navigator.locks.request).toHaveBeenCalledTimes(3));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("deletes the record when the finished download's link is released", async () => {
    const { directory, files: stored } = segmentDirectory();
    await seedRecord(directory);
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download: serveSource(),
    });
    const { user, unmount } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Resume download" }));
    await screen.findByRole("link", { name: "Save download" });
    unmount();
    await waitFor(async () => expect(await listRecords()).toEqual([]));
    expect([...stored.keys()]).toEqual([]);
  });

  it("does not offer records of another host, port or user", async () => {
    const { directory } = segmentDirectory();
    await seedRecord(directory, { host: "other.test" });
    await seedRecord(directory, { port: 2222 });
    await seedRecord(directory, { user: "someone" });
    renderPanel(makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", [entry])) }));
    await screen.findByRole("button", { name: "Download file backup.tar.gz" });
    await act(async () => {});
    expect(screen.queryByText(/stopped at/)).not.toBeInTheDocument();
    expect(await listRecords()).toHaveLength(3);
  });

  it("shows X-06 when the file changed, and Retry starts over at 0", async () => {
    const { directory } = segmentDirectory();
    await seedRecord(directory);
    const blobs = captureBlobs();
    const served = serveSource();
    const download = vi
      .fn()
      .mockRejectedValueOnce("Error: remote file changed")
      .mockImplementation(served);
    const list = vi.fn().mockResolvedValue(listing("/srv", [entry]));
    const { user } = renderPanel(makeFiles({ list, download }));
    await user.click(await screen.findByRole("button", { name: "Resume download" }));
    const block = await screen.findByRole("alert");
    expect(block).toHaveTextContent("Could not resume backup.tar.gz.");
    expect(block).toHaveTextContent("It changed on the server after the download started.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume download" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: "Save download" });
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls[1]).toHaveLength(3);
    expect(list).toHaveBeenLastCalledWith("/srv");
    expect(await sameAsSource(blobs.at(-1)!)).toBe(true);
  });

  it("shows X-05 after a lost file connection and resumes from the offset", async () => {
    segmentDirectory();
    const blobs = captureBlobs();
    const served = serveSource();
    const download = vi
      .fn()
      .mockImplementationOnce(
        async (_path: string, onChunk: (chunk: Uint8Array) => Promise<void>) => {
          await onChunk(source.subarray(0, SEGMENT_BYTES + 10));
          throw "Error: connection closed";
        },
      )
      .mockImplementation(served);
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    const block = await screen.findByRole("alert");
    expect(block).toHaveTextContent("Could not resume backup.tar.gz.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume download" }));
    await screen.findByRole("link", { name: "Save download" });
    expect(download.mock.calls[1]?.[3]).toMatchObject({ offset: SEGMENT_BYTES });
    expect(await sameAsSource(blobs.at(-1)!)).toBe(true);
  });

  it("treats a cancel the user did not ask for as a lost connection", async () => {
    segmentDirectory();
    // The engine cancels the running transfer when the session's file connection closes.
    const download = vi.fn(async (_path: string, onChunk: (c: Uint8Array) => Promise<void>) => {
      await onChunk(source.subarray(0, SEGMENT_BYTES + 10));
      throw "Error: transfer cancelled";
    });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await screen.findByText("Could not resume backup.tar.gz.");
    expect(screen.getByRole("button", { name: "Resume download" })).toBeVisible();
    expect(await listRecords()).toHaveLength(1);
  });

  it("asks before closing Files while X-05 holds an unfinished download", async () => {
    segmentDirectory();
    const download = vi.fn(async (_path: string, onChunk: (c: Uint8Array) => Promise<void>) => {
      await onChunk(source.subarray(0, 10));
      throw "Error: connection closed";
    });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
    });
    const { user, onClose } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await screen.findByText("Could not resume backup.tar.gz.");
    await user.click(screen.getByRole("button", { name: "Close files" }));
    expect(screen.getByRole("alertdialog", { name: "Stop transfer" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel deletes the record and its segments without asking", async () => {
    const { files: stored } = segmentDirectory();
    const download = vi.fn(async (_path: string, onChunk: (c: Uint8Array) => Promise<void>) => {
      await onChunk(source.subarray(0, SEGMENT_BYTES + 10));
      throw "Error: connection closed";
    });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
    });
    const { user } = renderPanel(files);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await screen.findByText("Could not resume backup.tar.gz.");
    expect(await listRecords()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Could not resume/)).not.toBeInTheDocument());
    expect(await listRecords()).toEqual([]);
    expect([...stored.keys()]).toEqual([]);
  });

  it("keeps the partial download when the session ends and Files unmounts", async () => {
    segmentDirectory();
    let fail!: (reason: string) => void;
    const download = vi.fn(async (_path: string, onChunk: (c: Uint8Array) => Promise<void>) => {
      await onChunk(source.subarray(0, SEGMENT_BYTES + 10));
      return new Promise<undefined>((_, reject) => {
        fail = reject;
      });
    });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
      // Closing the file connection cancels the running transfer, as the engine does.
      close: vi.fn(() => fail("Error: transfer cancelled")),
    });
    const onDownloadStop = vi.fn();
    const { user, unmount } = renderPanel(files, vi.fn(), undefined, { onDownloadStop });
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    await waitFor(async () => expect((await listRecords())[0]?.committedBytes).toBe(SEGMENT_BYTES));
    unmount();
    await act(async () => {});
    expect(await listRecords()).toHaveLength(1);
    expect(onDownloadStop).not.toHaveBeenLastCalledWith(null);
  });

  it("discards the partial download on Stop and close", async () => {
    segmentDirectory();
    let fail!: (reason: string) => void;
    const download = vi.fn(async (_path: string, onChunk: (c: Uint8Array) => Promise<void>) => {
      await onChunk(source.subarray(0, SEGMENT_BYTES + 10));
      return new Promise<undefined>((_, reject) => {
        fail = reject;
      });
    });
    const files = makeFiles({
      list: vi.fn().mockResolvedValue(listing("/srv", [entry])),
      download,
      close: vi.fn(() => fail("Error: transfer cancelled")),
    });
    const onClose = vi.fn();
    const { user, unmount } = renderPanel(files, onClose);
    await user.click(await screen.findByRole("button", { name: "Download file backup.tar.gz" }));
    await waitFor(async () => expect((await listRecords())[0]?.committedBytes).toBe(SEGMENT_BYTES));
    await user.click(screen.getByRole("button", { name: "Close files" }));
    await user.click(screen.getByRole("button", { name: "Stop and close" }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    await waitFor(async () => expect(await listRecords()).toEqual([]));
  });

  it("Dismiss deletes the stopped record", async () => {
    const { directory } = segmentDirectory();
    await seedRecord(directory);
    const { user } = renderPanel(
      makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", [entry])) }),
    );
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/stopped at/)).not.toBeInTheDocument());
    expect(await listRecords()).toEqual([]);
  });

  it("shows the next stopped download after dismissing the newest", async () => {
    const { directory } = segmentDirectory();
    const older = await seedRecord(directory, {
      remotePath: "/srv/older.tar.gz",
      createdAt: Date.now() - 1000,
    });
    const newer = await seedRecord(directory, {
      remotePath: "/srv/newer.tar.gz",
      createdAt: Date.now(),
    });
    const { user } = renderPanel(makeFiles());
    await screen.findByText(/newer.tar.gz stopped at/);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await screen.findByText(/older.tar.gz stopped at/);
    expect((await listRecords()).map((record) => record.id)).toEqual([older.id]);
    expect((await listRecords()).some((record) => record.id === newer.id)).toBe(false);
  });

  it("shows the next stopped download after completing the newest", async () => {
    const { directory } = segmentDirectory();
    await seedRecord(directory, {
      remotePath: "/srv/older.tar.gz",
      createdAt: Date.now() - 1000,
    });
    await seedRecord(directory, {
      remotePath: "/srv/newer.tar.gz",
      createdAt: Date.now(),
    });
    captureBlobs();
    const { user } = renderPanel(makeFiles({ download: serveSource() }));
    await screen.findByText(/newer.tar.gz stopped at/);
    await user.click(screen.getByRole("button", { name: "Resume download" }));
    await screen.findByRole("link", { name: "Save download" });
    await screen.findByText(/older.tar.gz stopped at/);
  });

  it("offers only Retry and Dismiss when a segment is already missing", async () => {
    const { directory, files: stored } = segmentDirectory();
    const record = await seedRecord(directory);
    stored.delete(record.segments[0]!);
    renderPanel(makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", [entry])) }));
    await screen.findByText("backup.tar.gz stopped at 50% when the connection closed.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume download" })).not.toBeInTheDocument();
  });

  it("restarts cleanly from 0 when a segment disappears before Resume", async () => {
    const { directory, files: stored } = segmentDirectory();
    const record = await seedRecord(directory);
    const blobs = captureBlobs();
    const download = serveSource();
    const { user } = renderPanel(
      makeFiles({ list: vi.fn().mockResolvedValue(listing("/srv", [entry])), download }),
    );
    const resume = await screen.findByRole("button", { name: "Resume download" });
    stored.delete(segmentName(record.id, 0));
    await user.click(resume);
    await screen.findByRole("link", { name: "Save download" });
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0]).toHaveLength(3);
    expect(await sameAsSource(blobs.at(-1)!)).toBe(true);
    const records = await listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.id).not.toBe(record.id);
  });
});
