import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowUp, Download, Maximize2, Minimize2, RefreshCw, Search, Upload } from "lucide-react";
import { describeSftpFailure } from "../connectionErrors.js";
import {
  openFiles,
  type DownloadResult,
  REMOTE_FILE_EXISTS,
  type RemoteFile,
  type SftpHandle,
  type SshHandle,
} from "../ssh/engine.js";
import {
  displayName,
  DOWNLOAD_KEEP_MS,
  DOWNLOAD_PREFIX,
  originDirectory,
  sweepDownloads,
} from "../remoteFiles.js";
import type { CSSProperties } from "react";
import { LearnMore } from "./Help.js";
import { useToast } from "../toast.js";
import {
  breadcrumbs,
  fileIcon,
  filterEntries,
  formatBytes,
  sortEntries,
  type SortColumn,
  type SortDirection,
} from "../fileExplorer.js";

const FALLBACK_LIMIT = 16 * 1024 * 1024;

/* The list renders only the rows in view plus this many on each side, so a
   10,000-entry folder keeps a few dozen rows in the DOM. */
const OVERSCAN = 8;
/* Used until the list has a measured height, and where layout reports none. */
const FALLBACK_VIEWPORT = 480;
const COARSE_POINTER = "(pointer: coarse)";

function subscribePointer(onChange: () => void) {
  const query = window.matchMedia?.(COARSE_POINTER);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

function coarsePointer() {
  return window.matchMedia?.(COARSE_POINTER).matches ?? false;
}

function rowId(name: string) {
  return `file-${encodeURIComponent(name)}`;
}

function itemCount(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;
}

function remoteJoin(directory: string, name: string): string {
  if (directory === ".") return name;
  if (directory === "/") return `/${name}`;
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function remoteParent(directory: string): string {
  if (!directory.startsWith("/")) return remoteJoin(directory, "..");
  return directory.replace(/\/[^/]*\/?$/, "") || "/";
}

function describeEntry(entry: RemoteFile): string {
  const bytes = `${entry.size.toLocaleString()} bytes`;
  switch (entry.kind) {
    case "folder":
      return entry.isLink ? "Link to folder" : "Folder";
    case "file":
      return entry.isLink ? `Link to file, ${bytes}` : `File, ${bytes}`;
    case "broken":
      return "Broken link";
    default:
      return entry.isLink ? "Link to special file" : "Special file";
  }
}

/** A finished download held in browser storage so the user can save it. */
interface HeldDownload {
  url: string;
  release: () => void;
  result?: DownloadResult;
}

function saveLink(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function receiveFile(
  files: SftpHandle,
  remotePath: string,
  filename: string,
  onProgress: (percent: number) => void,
): Promise<HeldDownload> {
  const directory = await originDirectory();
  if (directory) {
    const tempName = `${DOWNLOAD_PREFIX}${crypto.randomUUID()}`;
    let writable: FileSystemWritableFileStream | null = null;
    let downloading = false;
    try {
      const handle = await directory.getFileHandle(tempName, { create: true });
      // Safari before 26 has origin storage without createWritable; fall
      // through to the bounded in-memory path below.
      if (typeof handle.createWritable === "function") {
        writable = await handle.createWritable();
        const stream = writable;
        downloading = true;
        const result = await files.download(
          remotePath,
          async (chunk) => {
            await stream.write(chunk.slice().buffer);
          },
          onProgress,
        );
        await stream.close();
        const url = URL.createObjectURL(await handle.getFile());
        saveLink(url, filename);
        // The saved file and the Save download link read from this copy, so
        // it stays until the next transfer, panel close, page hide, or timer.
        return {
          url,
          result,
          release: () => {
            URL.revokeObjectURL(url);
            void directory.removeEntry(tempName).catch(console.error);
          },
        };
      }
      await directory.removeEntry(tempName);
    } catch (error) {
      if (writable) await writable.abort().catch(console.error);
      await directory.removeEntry(tempName).catch(console.error);
      if (downloading) throw error;
      // Storage failed before any data moved: try the in-memory path.
      console.error(error);
    }
  }

  const chunks: ArrayBuffer[] = [];
  let size = 0;
  const result = await files.download(
    remotePath,
    async (chunk) => {
      size += chunk.byteLength;
      if (size > FALLBACK_LIMIT)
        throw new Error("browser storage unavailable; download exceeds 16 MiB limit");
      chunks.push(chunk.slice().buffer);
    },
    onProgress,
  );
  const url = URL.createObjectURL(new Blob(chunks));
  saveLink(url, filename);
  return { url, result, release: () => URL.revokeObjectURL(url) };
}

type HeldSlot = { download: HeldDownload; timer: number } | null;

function releaseHeld(slot: { current: HeldSlot }) {
  if (!slot.current) return;
  window.clearTimeout(slot.current.timer);
  slot.current.download.release();
  slot.current = null;
}

export function FilePanel({
  handle,
  onClose,
  expanded,
  onExpand,
}: {
  handle: SshHandle;
  onClose: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const toast = useToast();
  const pathId = useId();
  const [files, setFiles] = useState<SftpHandle | null>(null);
  const [retryOpen, setRetryOpen] = useState(0);
  const [path, setPath] = useState(".");
  const [pathInput, setPathInput] = useState(".");
  const [entries, setEntries] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{
    kind: "upload" | "download";
    name: string;
    percent: number;
  } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: "name",
    direction: "asc",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const list = useRef<HTMLTableSectionElement>(null);
  const pendingFocus = useRef<string | null>(null);
  // Rows are a fixed height so the window of rendered rows follows from the
  // scroll offset alone; touch screens keep the 44px target.
  const rowHeight = useSyncExternalStore(subscribePointer, coarsePointer) ? 44 : 32;
  const cancelled = useRef(false);
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);
  const [failure, setFailure] = useState<{ raw: string; path: string; name: string } | null>(null);
  const held = useRef<HeldSlot>(null);
  const releaseDownload = () => releaseHeld(held);

  useEffect(() => {
    void sweepDownloads().catch(console.error);
    const onHide = () => releaseHeld(held);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      releaseHeld(held);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let client: SftpHandle | null = null;
    void openFiles(handle)
      .then(async (opened) => {
        if (disposed) {
          opened.close();
          return;
        }
        client = opened;
        setFiles(opened);
        try {
          const listing = await opened.list(".");
          if (disposed) return;
          setEntries(listing.entries);
          setTruncated(!!listing.truncated);
          if (listing.truncated) toast("Showing the first 10,000 items in this folder.", "warning");
          setPath(listing.path);
          setPathInput(listing.path);
        } catch (error) {
          if (!disposed) setFailure({ raw: String(error), path: ".", name: "files" });
        } finally {
          if (!disposed) setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setFailure({ raw: String(error), path: ".", name: "files" });
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      client?.close();
    };
  }, [handle, toast, retryOpen]);

  function showListing(next: RemoteFile[], wasTruncated: boolean) {
    setEntries(next);
    setTruncated(wasTruncated);
    if (wasTruncated) toast("Showing the first 10,000 items in this folder.", "warning");
  }

  function scrollListTo(top: number) {
    if (list.current) list.current.scrollTop = top;
    setScrollTop(top);
  }

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight || FALLBACK_VIEWPORT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, entries.length]);

  useLayoutEffect(() => {
    const name = pendingFocus.current;
    if (name === null) return;
    pendingFocus.current = null;
    document.getElementById(rowId(name))?.querySelector<HTMLElement>('[role="gridcell"]')?.focus();
  });

  const browse = async (next: string) => {
    if (!files || !next.trim()) return;
    setLoading(true);
    setFailure(null);
    try {
      const listing = await files.list(next.trim());
      showListing(listing.entries, !!listing.truncated);
      setFilter("");
      scrollListTo(0);
      setPath(listing.path);
      setPathInput(listing.path);
      setSelected(null);
    } catch (error) {
      setFailure({ raw: String(error), path: displayName(next.trim()), name: "files" });
    } finally {
      setLoading(false);
    }
  };

  const startTransfer = (kind: "upload" | "download", name: string) => {
    releaseDownload();
    setPendingReplace(null);
    setFailure(null);
    cancelled.current = false;
    setDownloadLink(null);
    setBusy({ kind, name, percent: 0 });
  };

  const upload = async (file: File, overwrite: boolean) => {
    if (!files) return;
    const remotePath = remoteJoin(path, file.name);
    const shown = displayName(file.name);
    startTransfer("upload", shown);
    try {
      await files.upload(remotePath, file, overwrite, (percent) =>
        setBusy({ kind: "upload", name: shown, percent }),
      );
      const refreshed = await files.list(path);
      showListing(refreshed.entries, !!refreshed.truncated);
      toast(`Uploaded ${shown}.`, "success");
    } catch (error) {
      if (!overwrite && String(error).includes(REMOTE_FILE_EXISTS)) setPendingReplace(file);
      else
        toast(
          describeSftpFailure(String(error), displayName(remotePath), shown).message,
          cancelled.current || String(error).includes("cancel") ? "info" : "error",
        );
    } finally {
      setBusy(null);
    }
  };

  const download = async (entry: RemoteFile) => {
    if (!files) return;
    const remotePath = remoteJoin(path, entry.name);
    const shown = displayName(entry.name);
    startTransfer("download", shown);
    try {
      const received = await receiveFile(files, remotePath, shown, (percent) =>
        setBusy({ kind: "download", name: shown, percent }),
      );
      held.current = {
        download: received,
        timer: window.setTimeout(() => {
          releaseDownload();
          setDownloadLink(null);
        }, DOWNLOAD_KEEP_MS),
      };
      setDownloadLink({ url: received.url, name: shown });
      toast(
        received.result?.grew
          ? `The file grew while downloading. Saved the first ${received.result.size.toLocaleString()} bytes.`
          : `Downloaded ${shown}.`,
        received.result?.grew ? "warning" : "success",
      );
    } catch (error) {
      toast(describeSftpFailure(String(error), displayName(remotePath), shown).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const atRoot = path === "/";
  const sortedEntries = useMemo(
    () => sortEntries(entries, sort.column, sort.direction),
    [entries, sort.column, sort.direction],
  );
  const shownEntries = useMemo(() => filterEntries(sortedEntries, filter), [sortedEntries, filter]);
  const selectedIndex =
    selected === null ? -1 : shownEntries.findIndex((entry) => entry.name === selected);
  // The roving tab stop: the selected row, or the first row when the
  // selection is unset or filtered out.
  const activeIndex = Math.max(0, selectedIndex);
  const pageRows = Math.max(1, Math.floor(viewport / rowHeight) - 1);
  const firstRendered = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const lastRendered = Math.min(
    shownEntries.length - 1,
    Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN,
  );
  const renderedIndexes: number[] = [];
  // The tab stop stays in the DOM when scrolled away, so Tab still reaches the list.
  if (activeIndex < firstRendered && activeIndex < shownEntries.length)
    renderedIndexes.push(activeIndex);
  for (let index = firstRendered; index <= lastRendered; index++) renderedIndexes.push(index);
  if (activeIndex > lastRendered && activeIndex < shownEntries.length)
    renderedIndexes.push(activeIndex);

  const chooseSort = (column: SortColumn) =>
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  const revealRow = (index: number) => {
    const top = index * rowHeight;
    if (top < scrollTop) scrollListTo(top);
    else if (top + rowHeight > scrollTop + viewport)
      scrollListTo(Math.max(0, top + rowHeight - viewport));
  };
  const selectRow = (index: number) => {
    if (!shownEntries.length) return;
    const clamped = Math.max(0, Math.min(shownEntries.length - 1, index));
    const next = shownEntries[clamped]!;
    setSelected(next.name);
    pendingFocus.current = next.name;
    revealRow(clamped);
  };
  const changeFilter = (value: string) => {
    setFilter(value);
    const index =
      selected === null
        ? -1
        : filterEntries(sortedEntries, value).findIndex((entry) => entry.name === selected);
    if (index < 0) scrollListTo(0);
    else {
      const top = index * rowHeight;
      if (top < scrollTop || top + rowHeight > scrollTop + viewport)
        scrollListTo(Math.max(0, top - Math.floor(viewport / 2)));
    }
  };
  const listKeys: Record<string, (current: number) => number> = {
    ArrowDown: (current) => current + 1,
    ArrowUp: (current) => current - 1,
    PageDown: (current) => current + pageRows,
    PageUp: (current) => current - pageRows,
    Home: () => 0,
    End: () => shownEntries.length - 1,
  };

  return (
    <section
      className={`file-panel${expanded ? " file-panel--expanded" : ""}`}
      aria-label="Files"
      style={{ "--file-row": `${rowHeight}px` } as CSSProperties}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) void upload(file, false);
      }}
      onKeyDown={(event) => {
        if (
          (event.key === "Backspace" || (event.altKey && event.key === "ArrowUp")) &&
          !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)
        ) {
          event.preventDefault();
          if (!atRoot) void browse(remoteParent(path));
        }
      }}
    >
      {dragging && <div className="file-panel__drop">Drop file to upload</div>}
      <header className="file-panel__header">
        <h2>Files</h2>
        <button
          type="button"
          onClick={onExpand}
          aria-label={expanded ? "Collapse files" : "Expand files"}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button
          type="button"
          onClick={() => (busy ? setConfirmClose(true) : onClose())}
          aria-label="Close files"
        >
          Close files
        </button>
      </header>
      {confirmClose && busy && (
        <div className="file-panel__confirm" role="alertdialog" aria-label="Stop transfer">
          <p>
            {busy.kind === "upload" ? "Uploading" : "Downloading"} {busy.name} is not finished.
            Closing Files stops it. An unfinished upload does not change the remote file.
          </p>
          <button type="button" onClick={onClose}>
            Stop and close
          </button>
          <button type="button" onClick={() => setConfirmClose(false)}>
            Keep transferring
          </button>
        </div>
      )}
      <nav className="file-panel__breadcrumbs" aria-label="Current folder">
        {breadcrumbs(path).map((crumb, index) =>
          crumb.path ? (
            <button
              key={crumb.path}
              type="button"
              disabled={!!busy || loading}
              onClick={() => void browse(crumb.path)}
              aria-current={index === breadcrumbs(path).length - 1 ? "page" : undefined}
            >
              {displayName(crumb.label)}
            </button>
          ) : (
            <details key="ellipsis">
              <summary aria-label="More path folders">…</summary>
              <div>
                {path
                  .split("/")
                  .filter(Boolean)
                  .slice(2, -1)
                  .map((part, partIndex) => (
                    <button
                      key={partIndex}
                      type="button"
                      onClick={() =>
                        void browse(
                          `/${path
                            .split("/")
                            .filter(Boolean)
                            .slice(0, partIndex + 3)
                            .join("/")}`,
                        )
                      }
                    >
                      {displayName(part)}
                    </button>
                  ))}
              </div>
            </details>
          ),
        )}
      </nav>
      <div className="file-panel__toolbar">
        <button
          type="button"
          aria-label="Up to parent folder"
          disabled={!files || loading || !!busy || atRoot}
          onClick={() => void browse(remoteParent(path))}
        >
          <ArrowUp /> Up
        </button>
        <button
          type="button"
          aria-label="Refresh files"
          disabled={!files || loading || !!busy}
          onClick={() => void browse(path)}
        >
          <RefreshCw /> Refresh
        </button>
        <label className="file-panel__upload">
          <Upload /> Upload
          <input
            type="file"
            aria-label="Upload file"
            disabled={!files || !!busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file, false);
            }}
          />
        </label>
        <button type="button" aria-expanded={pathOpen} onClick={() => setPathOpen(!pathOpen)}>
          Go to path
        </button>
      </div>
      {pathOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void browse(pathInput);
          }}
        >
          <label htmlFor={pathId}>Remote path</label>
          <div className="file-panel__path">
            <input
              id={pathId}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
            />
            <button type="submit" disabled={!files || loading || !!busy}>
              Open
            </button>
          </div>
        </form>
      )}
      {pendingReplace && (
        <div className="file-panel__confirm" role="alertdialog" aria-label="Replace file">
          <p>
            Replace {displayName(pendingReplace.name)} on the server? The new file keeps the old
            file's permissions, but not its owner or access lists. If the name is a link, the link
            itself is replaced and its target is not changed.
          </p>
          <button
            className="file-panel__danger"
            type="button"
            onClick={() => void upload(pendingReplace, true)}
          >
            Replace file
          </button>
          <button type="button" onClick={() => setPendingReplace(null)}>
            Cancel
          </button>
        </div>
      )}
      {busy && (
        <p role="status">
          {busy.kind === "upload" ? "Uploading" : "Downloading"} {busy.name}: {busy.percent}%{" "}
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              files?.cancel();
            }}
          >
            Cancel
          </button>
        </p>
      )}
      {loading && (
        <div className="file-panel__skeleton" role="status" aria-label="Loading files">
          <span>Loading files...</span>
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} />
          ))}
        </div>
      )}
      {!loading && entries.length === 0 && !failure && (
        <p>No files in this directory. Choose another path or upload a file.</p>
      )}
      {!loading && truncated && <p>Showing the first 10,000 items in this folder.</p>}
      {!loading && entries.length > 0 && (
        <div className="file-panel__filter">
          <label>
            <Search aria-hidden="true" />
            <span className="visually-hidden">Filter files</span>
            <input
              type="search"
              placeholder="Filter files"
              autoComplete="off"
              spellCheck={false}
              value={filter}
              onChange={(event) => changeFilter(event.target.value)}
            />
          </label>
          <p role="status" aria-live="polite">
            {filter.trim()
              ? `${shownEntries.length.toLocaleString()} of ${itemCount(entries.length)}`
              : itemCount(entries.length)}
          </p>
        </div>
      )}
      {!loading && entries.length > 0 && shownEntries.length === 0 && (
        <p>No items match this filter.</p>
      )}
      {!loading && entries.length > 0 && (
        <table
          className="file-panel__table"
          role="grid"
          aria-label={`Files in ${displayName(path)}`}
          aria-rowcount={shownEntries.length + 1}
          style={{ display: shownEntries.length ? undefined : "none" }}
        >
          <thead role="rowgroup">
            <tr role="row" aria-rowindex={1}>
              {(["name", "size", "mtime", "mode"] as const).map((column) => (
                <th
                  key={column}
                  role="columnheader"
                  scope="col"
                  aria-sort={
                    sort.column === column
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <button type="button" onClick={() => chooseSort(column)}>
                    {{ name: "Name", size: "Size", mtime: "Modified", mode: "Permissions" }[column]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            ref={list}
            role="rowgroup"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={(event) => {
              const target = event.target as HTMLElement;
              const move = listKeys[event.key];
              if (move && !event.altKey) {
                event.preventDefault();
                selectRow(move(activeIndex));
                return;
              }
              if (event.key === "Enter" && target.getAttribute("role") === "gridcell") {
                const entry = shownEntries[activeIndex];
                if (!entry) return;
                event.preventDefault();
                setSelected(entry.name);
                if (entry.kind === "folder") void browse(remoteJoin(path, entry.name));
              }
            }}
          >
            {renderedIndexes.map((index) => {
              const entry = shownEntries[index]!;
              const Icon = fileIcon(entry);
              return (
                <tr
                  key={entry.name}
                  id={rowId(entry.name)}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selected === entry.name}
                  style={{ top: index * rowHeight, height: rowHeight }}
                  onClick={() => setSelected(entry.name)}
                  onDoubleClick={() => {
                    if (entry.kind === "folder") void browse(remoteJoin(path, entry.name));
                  }}
                >
                  <td role="gridcell" tabIndex={index === activeIndex ? 0 : -1}>
                    <span className="file-panel__name">
                      <Icon aria-hidden="true" />
                      <span>
                        {displayName(entry.name)}
                        {entry.kind === "folder" ? "/" : ""}
                      </span>
                      {entry.kind === "file" && (
                        <button
                          className="file-panel__download"
                          type="button"
                          tabIndex={index === activeIndex ? 0 : -1}
                          disabled={!!busy}
                          aria-label={`Download file ${displayName(entry.name)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void download(entry);
                          }}
                        >
                          <Download aria-hidden="true" />
                        </button>
                      )}
                    </span>
                    <span className="visually-hidden">{describeEntry(entry)}</span>
                  </td>
                  <td role="gridcell">{entry.kind === "folder" ? "" : formatBytes(entry.size)}</td>
                  <td role="gridcell">
                    {entry.mtime ? new Date(entry.mtime).toLocaleString() : ""}
                  </td>
                  <td role="gridcell">{entry.mode}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {downloadLink && (
        <a href={downloadLink.url} download={downloadLink.name}>
          Save download
        </a>
      )}
      {failure && (
        <div className="connection-error" role="alert">
          <p>{describeSftpFailure(failure.raw, failure.path, failure.name).message}</p>
          <LearnMore topic="files" />
          <button
            type="button"
            onClick={() => {
              if (files) void browse(pathInput);
              else {
                setLoading(true);
                setFailure(null);
                setRetryOpen((count) => count + 1);
              }
            }}
          >
            Retry
          </button>
          <details>
            <summary>Technical details</summary>
            <code>{failure.raw}</code>
          </details>
        </div>
      )}
    </section>
  );
}
