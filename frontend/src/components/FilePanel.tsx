import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Download, Maximize2, Minimize2, RefreshCw, Upload } from "lucide-react";
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
import { LearnMore } from "./Help.js";
import { useToast } from "./Toasts.js";
import {
  breadcrumbs,
  fileIcon,
  formatBytes,
  sortEntries,
  type SortColumn,
  type SortDirection,
} from "../fileExplorer.js";

const FALLBACK_LIMIT = 16 * 1024 * 1024;

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

  const browse = async (next: string) => {
    if (!files || !next.trim()) return;
    setLoading(true);
    setFailure(null);
    try {
      const listing = await files.list(next.trim());
      setEntries(listing.entries);
      setTruncated(!!listing.truncated);
      if (listing.truncated) toast("Showing the first 10,000 items in this folder.", "warning");
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
      setEntries(refreshed.entries);
      setTruncated(!!refreshed.truncated);
      if (refreshed.truncated) toast("Showing the first 10,000 items in this folder.", "warning");
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
  const shownEntries = sortEntries(entries, sort.column, sort.direction);
  const chooseSort = (column: SortColumn) =>
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  const moveSelection = (step: number) => {
    if (!shownEntries.length) return;
    const index =
      selected === null ? 0 : shownEntries.findIndex((entry) => entry.name === selected);
    const next = shownEntries[Math.max(0, Math.min(shownEntries.length - 1, index + step))]!;
    setSelected(next.name);
    document.getElementById(`file-${encodeURIComponent(next.name)}`)?.focus();
  };

  return (
    <section
      className={`file-panel${expanded ? " file-panel--expanded" : ""}`}
      aria-label="Files"
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
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if ((event.target as HTMLElement).closest(".file-panel__table")) {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          }
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
        <div className="file-panel__table-wrap">
          <table className="file-panel__table">
            <thead>
              <tr>
                {(["name", "size", "mtime", "mode"] as const).map((column) => (
                  <th
                    key={column}
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
                      {
                        { name: "Name", size: "Size", mtime: "Modified", mode: "Permissions" }[
                          column
                        ]
                      }
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownEntries.map((entry) => {
                const Icon = fileIcon(entry);
                return (
                  <tr
                    key={entry.name}
                    id={`file-${encodeURIComponent(entry.name)}`}
                    tabIndex={
                      selected === entry.name || (!selected && entry === shownEntries[0]) ? 0 : -1
                    }
                    aria-selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                    onDoubleClick={() => {
                      if (entry.kind === "folder") void browse(remoteJoin(path, entry.name));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setSelected(entry.name);
                        if (entry.kind === "folder") void browse(remoteJoin(path, entry.name));
                      }
                    }}
                  >
                    <td>
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
                    <td>{entry.kind === "folder" ? "" : formatBytes(entry.size)}</td>
                    <td>{entry.mtime ? new Date(entry.mtime).toLocaleString() : ""}</td>
                    <td>{entry.mode}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
