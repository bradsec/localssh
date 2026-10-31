import { useEffect, useId, useState } from "react";
import { describeSftpFailure } from "../connectionErrors.js";
import type { RemoteFile, SftpHandle, SshHandle } from "../ssh/engine.js";
import { LearnMore } from "./Help.js";

const FALLBACK_LIMIT = 16 * 1024 * 1024;

function remoteJoin(directory: string, name: string): string {
  return directory === "." ? name : `${directory.replace(/\/$/, "")}/${name}`;
}

async function receiveFile(
  files: SftpHandle,
  remotePath: string,
  filename: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  let directory: FileSystemDirectoryHandle | null = null;
  try {
    directory = (await navigator.storage?.getDirectory?.()) ?? null;
  } catch {
    // Safari private browsing can deny origin storage; use the bounded fallback.
  }
  if (directory) {
    const tempName = `localssh-download-${crypto.randomUUID()}`;
    const handle = await directory.getFileHandle(tempName, { create: true });
    const writable = await handle.createWritable();
    try {
      await files.download(
        remotePath,
        async (chunk) => {
          await writable.write(chunk.slice().buffer);
        },
        onProgress,
      );
      await writable.close();
      const url = URL.createObjectURL(await handle.getFile());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        void directory.removeEntry(tempName).catch(console.error);
      }, 10 * 60_000);
      return url;
    } catch (error) {
      await writable.abort().catch(console.error);
      await directory.removeEntry(tempName).catch(console.error);
      throw error;
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
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return url;
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
  const [notice, setNotice] = useState("");
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);
  const [failure, setFailure] = useState<{ raw: string; path: string; name: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let client: SftpHandle | null = null;
    const opening =
      handle.openFiles?.() ?? Promise.reject(new Error("SFTP is unavailable in this SSH engine"));
    void opening
      .then(async (opened) => {
        if (disposed) {
          opened.close();
          return;
        }
        client = opened;
        setFiles(opened);
        try {
          setEntries(await opened.list("."));
        } catch (error) {
          setFailure({ raw: String(error), path: ".", name: "files" });
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
      const result = await files.list(next.trim());
      setEntries(result);
      setPath(next.trim());
      setPathInput(next.trim());
      setNotice("");
    } catch (error) {
      setFailure({ raw: String(error), path: next.trim(), name: "files" });
    } finally {
      setLoading(false);
    }
  };

  const upload = async (file: File, overwrite: boolean) => {
    if (!files) return;
    const remotePath = remoteJoin(path, file.name);
    setPendingReplace(null);
    setFailure(null);
    setNotice("");
    setDownloadLink(null);
    setBusy({ kind: "upload", name: file.name, percent: 0 });
    try {
      await files.upload(remotePath, file, overwrite, (percent) =>
        setBusy({ kind: "upload", name: file.name, percent }),
      );
      setEntries(await files.list(path));
      setNotice(`Uploaded ${file.name}.`);
    } catch (error) {
      if (!overwrite && /file exists|SSH_FX_FILE_ALREADY_EXISTS/i.test(String(error)))
        setPendingReplace(file);
      else setFailure({ raw: String(error), path: remotePath, name: file.name });
    } finally {
      setBusy(null);
    }
  };

  const download = async (entry: RemoteFile) => {
    if (!files) return;
    const remotePath = remoteJoin(path, entry.name);
    setFailure(null);
    setNotice("");
    setDownloadLink(null);
    setBusy({ kind: "download", name: entry.name, percent: 0 });
    try {
      const url = await receiveFile(files, remotePath, entry.name, (percent) =>
        setBusy({ kind: "download", name: entry.name, percent }),
      );
      setDownloadLink({ url, name: entry.name });
      setNotice(`Downloaded ${entry.name}.`);
    } catch (error) {
      setFailure({ raw: String(error), path: remotePath, name: entry.name });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="file-panel" aria-label="Files">
      <header className="file-panel__header">
        <h2>Files</h2>
        <button type="button" onClick={onClose} aria-label="Close files">
          Close files
        </button>
      </header>
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
      <label className="file-panel__upload">
        Upload file
        <input
          type="file"
          aria-label="Upload file"
          disabled={!files || !!busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              if (entries.some((entry) => entry.name === file.name)) setPendingReplace(file);
              else void upload(file, false);
            }
          }}
        />
      </label>
      {pendingReplace && (
        <div className="file-panel__confirm" role="alertdialog" aria-label="Replace file">
          <p>Replace {pendingReplace.name} on the server? The existing file will be overwritten.</p>
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
              {entry.isDir ? (
                <button type="button" onClick={() => void browse(remoteJoin(path, entry.name))}>
                  {entry.name}/
                </button>
              ) : (
                <span>{entry.name}</span>
              )}
              <span>{entry.isDir ? "Folder" : `${entry.size.toLocaleString()} bytes`}</span>
              {!entry.isDir && (
                <button
                  type="button"
                  disabled={!!busy}
                  aria-label={`Download file ${entry.name}`}
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
