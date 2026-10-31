import { useEffect, useId, useRef, useState } from "react";
import { describeSftpFailure } from "../connectionErrors.js";
import {
  openFiles,
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
        await files.download(
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
  await files.download(
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
  return { url, release: () => URL.revokeObjectURL(url) };
}

type HeldSlot = { download: HeldDownload; timer: number } | null;

function releaseHeld(slot: { current: HeldSlot }) {
  if (!slot.current) return;
  window.clearTimeout(slot.current.timer);
  slot.current.download.release();
  slot.current = null;
}

export function FilePanel({ handle, onClose }: { handle: SshHandle; onClose: () => void }) {
  const pathId = useId();
  const [files, setFiles] = useState<SftpHandle | null>(null);
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
  const [notice, setNotice] = useState("");
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
  }, [handle]);

  const browse = async (next: string) => {
    if (!files || !next.trim()) return;
    setLoading(true);
    setFailure(null);
    try {
      const listing = await files.list(next.trim());
      setEntries(listing.entries);
      setPath(listing.path);
      setPathInput(listing.path);
      setNotice("");
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
    setNotice("");
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
      setEntries((await files.list(path)).entries);
      setNotice(`Uploaded ${shown}.`);
    } catch (error) {
      if (!overwrite && String(error).includes(REMOTE_FILE_EXISTS)) setPendingReplace(file);
      else setFailure({ raw: String(error), path: displayName(remotePath), name: shown });
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
      setNotice(`Downloaded ${shown}.`);
    } catch (error) {
      setFailure({ raw: String(error), path: displayName(remotePath), name: shown });
    } finally {
      setBusy(null);
    }
  };

  const atRoot = path === "/";

  return (
    <section className="file-panel" aria-label="Files">
      <header className="file-panel__header">
        <h2>Files</h2>
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
      <p className="file-panel__location">
        Current folder: <span>{path === "." ? "Home folder" : displayName(path)}</span>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void browse(pathInput);
        }}
      >
        <label htmlFor={pathId}>Remote path</label>
        <div className="file-panel__path">
          <button
            type="button"
            aria-label="Up to parent folder"
            disabled={!files || loading || !!busy || atRoot}
            onClick={() => void browse(remoteParent(path))}
          >
            Up
          </button>
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
      <label className="file-panel__upload">
        Upload file
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
      {pendingReplace && (
        <div className="file-panel__confirm" role="alertdialog" aria-label="Replace file">
          <p>
            Replace {displayName(pendingReplace.name)} on the server? The new file keeps the old
            file's permissions, but not its owner or access lists. If the name is a link, the link
            itself is replaced and its target is not changed.
          </p>
          <button type="button" onClick={() => void upload(pendingReplace, true)}>
            Replace file
          </button>
          <button type="button" onClick={() => setPendingReplace(null)}>
            Cancel
          </button>
        </div>
      )}
      {loading && <p role="status">Loading files...</p>}
      {!loading && entries.length === 0 && !failure && (
        <p>No files in this directory. Choose another path or upload a file.</p>
      )}
      {!loading && entries.length > 0 && (
        <ul className="file-panel__list">
          {entries.map((entry) => (
            <li key={entry.name}>
              {entry.kind === "folder" ? (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void browse(remoteJoin(path, entry.name))}
                >
                  {displayName(entry.name)}/
                </button>
              ) : (
                <span>{displayName(entry.name)}</span>
              )}
              <span>{describeEntry(entry)}</span>
              {entry.kind === "file" && (
                <button
                  type="button"
                  disabled={!!busy}
                  aria-label={`Download file ${displayName(entry.name)}`}
                  onClick={() => void download(entry)}
                >
                  Download file
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p role="status">
          {busy.kind === "upload" ? "Uploading" : "Downloading"} {busy.name}: {busy.percent}%{" "}
          <button type="button" onClick={() => files?.cancel()}>
            Cancel
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {downloadLink && (
        <a href={downloadLink.url} download={downloadLink.name}>
          Save download
        </a>
      )}
      {failure && (
        <div className="connection-error" role="alert">
          <p>{describeSftpFailure(failure.raw, failure.path, failure.name).message}</p>
          <LearnMore topic="files" />
          <details>
            <summary>Technical details</summary>
            <code>{failure.raw}</code>
          </details>
        </div>
      )}
    </section>
  );
}
