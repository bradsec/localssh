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
  REMOTE_FILE_CHANGED,
  REMOTE_FILE_EXISTS,
  type RemoteFile,
  type SftpHandle,
  type SshHandle,
} from "../ssh/engine.js";
import { displayName, DOWNLOAD_KEEP_MS, originDirectory, sweepDownloads } from "../remoteFiles.js";
import type { CSSProperties } from "react";
import {
  type DownloadRecord,
  deleteRecord,
  listRecords,
  openSegmentedDownload,
  recordIsUsable,
  segmentName,
} from "../downloadStore.js";
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
  release: () => void | Promise<void>;
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

/** A closed connection keeps the partial download for a later resume. */
const CONNECTION_CLOSED = /file connection is closed|SFTP closed|connection closed/i;
const TRANSFER_CANCELLED = /transfer cancelled/i;

export interface TransferIdentity {
  host: string;
  port: number;
  username: string;
}

/**
 * Records of downloads running or held in this page. Files opened in another
 * tab for the same host must not offer them as stopped downloads.
 */
const activeDownloads = new Set<string>();

function committedPercent(record: DownloadRecord): number {
  return record.size > 0 ? Math.floor((record.committedBytes * 100) / record.size) : 0;
}

/**
 * Downloads record.remotePath into segments named by the record. With resume,
 * it continues from the record's committed bytes and the engine checks that
 * the remote file is unchanged.
 */
async function receiveFile(
  files: SftpHandle,
  record: DownloadRecord,
  resume: boolean,
  filename: string,
  onProgress: (percent: number) => void,
): Promise<HeldDownload> {
  const directory = await originDirectory();
  if (directory) {
    const id = record.id;
    let writer: Awaited<ReturnType<typeof openSegmentedDownload>> | null = null;
    let downloading = false;
    activeDownloads.add(id);
    try {
      const segmented = await openSegmentedDownload(directory, record);
      writer = segmented;
      // Safari before 26 has origin storage without createWritable; fall
      // through to the bounded in-memory path below.
      const probe = await directory.getFileHandle(segmentName(id, 0), { create: true });
      if (typeof probe.createWritable === "function") {
        downloading = true;
        const write = (chunk: Uint8Array) => segmented.write(chunk);
        const result = resume
          ? await files.download(record.remotePath, write, onProgress, {
              offset: record.committedBytes,
              expectSize: record.size,
              expectMtime: record.mtime,
              tail: await segmented.tail(),
            })
          : await files.download(record.remotePath, write, onProgress);
        const url = URL.createObjectURL(await segmented.finish());
        saveLink(url, filename);
        // The saved file and the Save download link read from the segments, so
        // they stay until the next transfer, panel close, page hide, or timer.
        return {
          url,
          result,
          release: () => {
            URL.revokeObjectURL(url);
            activeDownloads.delete(id);
            return deleteRecord(directory, id).catch(console.error);
          },
        };
      }
      activeDownloads.delete(id);
      await deleteRecord(directory, id);
    } catch (error) {
      activeDownloads.delete(id);
      if (writer) await writer.abort().catch(console.error);
      // Once data has moved, the caller decides whether the partial bytes stay.
      if (downloading) throw error;
      // Storage failed before any data moved: try the in-memory path.
      await deleteRecord(directory, id).catch(console.error);
      console.error(error);
    }
  }

  const chunks: ArrayBuffer[] = [];
  let size = 0;
  const result = await files.download(
    record.remotePath,
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

/**
 * A download that ended with its partial bytes kept or just discarded:
 * X-05 failed (resumable), X-06 the remote file changed, X-07 the session
 * ended (found in storage when Files opens).
 */
interface StoppedDownload {
  state: "failed" | "changed" | "ended";
  id: string;
  remotePath: string;
  name: string;
  percent: number;
  detail?: string;
  canResume: boolean;
}

function newRecord(
  identity: TransferIdentity,
  remotePath: string,
  remote: { size: number; mtime: number },
): DownloadRecord {
  return {
    id: crypto.randomUUID(),
    host: identity.host,
    port: identity.port,
    user: identity.username,
    remotePath,
    size: remote.size,
    mtime: remote.mtime,
    committedBytes: 0,
    segments: [],
    createdAt: Date.now(),
  };
}

function remoteBase(remotePath: string): string {
  return remotePath.slice(remotePath.lastIndexOf("/") + 1);
}

type HeldSlot = { download: HeldDownload; timer: number } | null;

function releaseHeld(slot: { current: HeldSlot }) {
  if (!slot.current) return;
  window.clearTimeout(slot.current.timer);
  slot.current.download.release();
  slot.current = null;
}

export interface FilePanelProps {
  handle: SshHandle;
  onClose: () => void;
  expanded: boolean;
  onExpand: () => void;
  /** "resuming" while the tab's transport is reconnecting (S-13). */
  transport: "connected" | "resuming";
  /** Names the partial download record; holds no credentials. */
  identity: TransferIdentity;
  /**
   * Reports a download's progress, and null when it ends for a reason other
   * than a lost connection. A lost connection leaves the last report so the
   * recovery row can say where the download stopped.
   */
  onDownloadStop?: (info: { name: string; percent: number } | null) => void;
}

function pageHidden() {
  return document.visibilityState === "hidden";
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function FilePanel({
  handle,
  onClose,
  expanded,
  onExpand,
  transport,
  identity,
  onDownloadStop,
}: FilePanelProps) {
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
  const mounted = useRef(true);
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);
  const [failure, setFailure] = useState<{ raw: string; path: string; name: string } | null>(null);
  const held = useRef<HeldSlot>(null);
  const releaseDownload = () => releaseHeld(held);
  const hidden = useSyncExternalStore(subscribeVisibility, pageHidden);
  const resuming = transport === "resuming";
  // Controls that start or change a transfer stay off while a transfer runs
  // or the session is resuming; Cancel and Close files stay available.
  const locked = !!busy || resuming;
  const [announced, setAnnounced] = useState<{
    key: string;
    state: string | null;
    text: string;
  }>({ key: "", state: null, text: "" });
  const touch = useSyncExternalStore(subscribePointer, coarsePointer);
  const [stopped, setStopped] = useState<StoppedDownload | null>(null);
  const [stoppedVersion, setStoppedVersion] = useState(0);
  const { host, port, username } = identity;

  useEffect(() => {
    mounted.current = true;
    void sweepDownloads().catch(console.error);
    const onHide = () => releaseHeld(held);
    window.addEventListener("pagehide", onHide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onHide);
      releaseHeld(held);
    };
  }, []);

  // X-07: a download of this host, port and user that a lost session or a
  // reload left in storage.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const directory = await originDirectory();
      if (!directory) return;
      const latest = (await listRecords())
        .filter(
          (record) =>
            record.host === host &&
            record.port === port &&
            record.user === username &&
            !activeDownloads.has(record.id),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!latest) return;
      const canResume = await recordIsUsable(directory, latest);
      if (disposed) return;
      setStopped(
        (current) =>
          current ?? {
            state: "ended",
            id: latest.id,
            remotePath: latest.remotePath,
            name: displayName(remoteBase(latest.remotePath)),
            percent: committedPercent(latest),
            canResume,
          },
      );
    })().catch(console.error);
    return () => {
      disposed = true;
    };
  }, [host, port, username, stoppedVersion]);

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
          setPathInput((current) => (current === "." ? listing.path : current));
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

  const startTransfer = (kind: "upload" | "download", name: string, percent = 0) => {
    releaseDownload();
    setPendingReplace(null);
    setFailure(null);
    setStopped(null);
    cancelled.current = false;
    setDownloadLink(null);
    setBusy({ kind, name, percent });
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

  const download = async (
    remotePath: string,
    shown: string,
    remote: { size: number; mtime: number },
    resume?: DownloadRecord,
  ) => {
    if (!files) return;
    const record = resume ?? newRecord({ host, port, username }, remotePath, remote);
    const startPercent = resume ? committedPercent(resume) : 0;
    let released: Promise<void> | undefined;
    startTransfer("download", shown, startPercent);
    onDownloadStop?.({ name: shown, percent: startPercent });
    try {
      const received = await receiveFile(files, record, !!resume, shown, (percent) => {
        setBusy({ kind: "download", name: shown, percent });
        onDownloadStop?.({ name: shown, percent });
      });
      if (resume) {
        let resolveRelease!: () => void;
        released = new Promise<void>((resolve) => {
          resolveRelease = resolve;
        });
        const originalRelease = received.release;
        received.release = async () => {
          try {
            await originalRelease();
          } finally {
            resolveRelease();
          }
        };
      }
      onDownloadStop?.(null);
      held.current = {
        download: received,
        timer: window.setTimeout(() => {
          releaseDownload();
          setDownloadLink(null);
        }, DOWNLOAD_KEEP_MS),
      };
      setDownloadLink({ url: received.url, name: shown });
      setStoppedVersion((version) => version + 1);
      toast(
        received.result?.grew
          ? `The file grew while downloading. Saved the first ${received.result.size.toLocaleString()} bytes.`
          : `Downloaded ${shown}.`,
        received.result?.grew ? "warning" : "success",
      );
    } catch (error) {
      const raw = String(error);
      // When the session ends, the engine closes the file connection, which
      // cancels the transfer. A cancel the user did not ask for, a closed
      // connection, or Files unmounting keeps the partial bytes; a user cancel
      // or any other failure discards them.
      const lost =
        !cancelled.current &&
        (!mounted.current || CONNECTION_CLOSED.test(raw) || TRANSFER_CANCELLED.test(raw));
      if (!lost) {
        const directory = await originDirectory();
        if (directory) await deleteRecord(directory, record.id).catch(console.error);
        onDownloadStop?.(null);
      }
      if (!mounted.current) return;
      const stoppedAt = { id: record.id, remotePath, name: shown };
      if (raw.includes(REMOTE_FILE_CHANGED)) {
        setStopped({ ...stoppedAt, state: "changed", percent: 0, canResume: false });
        return;
      }
      // Only the segmented path keeps a record; the in-memory one cannot resume.
      const kept = lost
        ? (await listRecords().catch(() => [])).find((item) => item.id === record.id)
        : undefined;
      if (kept) {
        setStopped({
          ...stoppedAt,
          state: "failed",
          percent: committedPercent(kept),
          detail: describeSftpFailure(raw, displayName(remotePath), shown).message,
          canResume: true,
        });
        return;
      }
      toast(describeSftpFailure(raw, displayName(remotePath), shown).message, "error");
    } finally {
      setBusy(null);
    }
    await released;
  };

  const discardStopped = async (item: StoppedDownload) => {
    setStopped(null);
    onDownloadStop?.(null);
    const directory = await originDirectory();
    if (directory) await deleteRecord(directory, item.id);
    setStoppedVersion((version) => version + 1);
  };

  // Retry downloads the whole file again, so it needs the current size and mtime.
  const retryStopped = async (item: StoppedDownload) => {
    if (!files) return;
    await discardStopped(item);
    const base = remoteBase(item.remotePath);
    try {
      const listing = await files.list(remoteParent(item.remotePath));
      const entry = listing.entries.find((each) => each.name === base && each.kind === "file");
      if (!entry) throw new Error("no such file");
      await download(item.remotePath, item.name, entry);
    } catch (error) {
      toast(
        describeSftpFailure(String(error), displayName(item.remotePath), item.name).message,
        "error",
      );
    }
  };

  // Resume continues from the committed bytes; a record whose segments were
  // evicted since Files opened restarts cleanly from 0.
  const resumeStopped = async (item: StoppedDownload) => {
    const directory = await originDirectory();
    const record = (await listRecords()).find((each) => each.id === item.id);
    if (directory && record && (await recordIsUsable(directory, record))) {
      await download(record.remotePath, item.name, record, record);
    } else {
      await retryStopped(item);
    }
  };

  const runStopped = (action: (item: StoppedDownload) => Promise<void>) => {
    if (!stopped) return;
    const item = stopped;
    void (async () => {
      if (!navigator.locks) throw new Error("Download recovery requires browser locks.");
      await navigator.locks.request(
        `localssh-download-${item.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("This download is active in another tab.");
          await action(item);
        },
      );
    })().catch((error: unknown) => {
      console.error(error);
      toast(
        describeSftpFailure(String(error), displayName(item.remotePath), item.name).message,
        "error",
      );
    });
  };

  // X-05 still holds an unfinished download, so closing asks first, as during a transfer.
  const unfinished = busy
    ? { kind: busy.kind, name: busy.name }
    : stopped?.state === "failed"
      ? { kind: "download" as const, name: stopped.name }
      : null;

  const transferState =
    busy?.kind !== "download" ? null : resuming ? (hidden ? "paused" : "resuming") : "downloading";
  const bucket = busy ? Math.min(100, Math.floor(busy.percent / 25) * 25) : 0;
  // The live region changes only on a state change or each 25 percent, so
  // screen readers do not read every percent. Adjusted during render, from the
  // previous state, so that coming back from resuming reads "Download resumed."
  const announceKey = `${busy?.kind}|${busy?.name}|${transferState}|${bucket}`;
  if (announced.key !== announceKey) {
    const name = busy?.name;
    const text = !busy
      ? ""
      : busy.kind === "upload"
        ? `Uploading ${name}, ${bucket} percent.`
        : transferState === "paused"
          ? `Download of ${name} paused.`
          : transferState === "resuming"
            ? `Resuming ${name}.`
            : announced.state === "paused" || announced.state === "resuming"
              ? "Download resumed."
              : `Downloading ${name}, ${bucket} percent.`;
    setAnnounced({ key: announceKey, state: transferState, text });
  }

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
        if (file && !locked) void upload(file, false);
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
          onClick={() => (unfinished ? setConfirmClose(true) : onClose())}
          aria-label="Close files"
        >
          Close files
        </button>
      </header>
      {confirmClose && unfinished && (
        <div className="file-panel__confirm" role="alertdialog" aria-label="Stop transfer">
          <p>
            {unfinished.kind === "upload" ? "Uploading" : "Downloading"} {unfinished.name} is not
            finished. Closing Files stops it. An unfinished upload does not change the remote file.
          </p>
          <button
            type="button"
            onClick={() => {
              // Stopping on purpose discards the partial bytes.
              cancelled.current = true;
              if (stopped?.state === "failed") runStopped(discardStopped);
              onClose();
            }}
          >
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
              disabled={locked || loading}
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
          disabled={!files || loading || locked || atRoot}
          onClick={() => void browse(remoteParent(path))}
        >
          <ArrowUp /> Up
        </button>
        <button
          type="button"
          aria-label="Refresh files"
          disabled={!files || loading || locked}
          onClick={() => void browse(path)}
        >
          <RefreshCw /> Refresh
        </button>
        <label className="file-panel__upload">
          <Upload /> Upload
          <input
            type="file"
            aria-label="Upload file"
            disabled={!files || locked}
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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" disabled={!files || loading || locked}>
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
        <div className="file-panel__transfer" data-state={transferState ?? "uploading"}>
          {transferState === "paused" ? (
            <>
              <p>
                Paused: {busy.name} at {busy.percent}%.
              </p>
              <p className="file-panel__transfer-hint">
                Downloads pause while localssh is in the background.
              </p>
            </>
          ) : transferState === "resuming" ? (
            <p>
              Resuming {busy.name} from {busy.percent}%...
            </p>
          ) : (
            <>
              <p>
                {busy.kind === "upload" ? "Uploading" : "Downloading"} {busy.name}: {busy.percent}%
              </p>
              {busy.kind === "download" && touch && (
                <p className="file-panel__transfer-hint">
                  Keep localssh open until this finishes. If you switch apps, the download pauses
                  and continues when you come back.
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              files?.cancel();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {stopped && !busy && (
        <div className="file-panel__transfer" data-state={stopped.state} role="alert">
          {stopped.state === "ended" ? (
            <p>
              {stopped.name} stopped at {stopped.percent}% when the connection closed.
            </p>
          ) : (
            <>
              <p>Could not resume {stopped.name}.</p>
              <p className="file-panel__transfer-hint">
                {stopped.state === "changed"
                  ? "It changed on the server after the download started."
                  : stopped.detail}
              </p>
            </>
          )}
          <div className="file-panel__transfer-actions">
            <button type="button" onClick={() => runStopped(discardStopped)}>
              {stopped.state === "ended" ? "Dismiss" : "Cancel"}
            </button>
            {stopped.state !== "failed" && (
              <button
                type="button"
                disabled={!files || resuming}
                onClick={() => runStopped(retryStopped)}
              >
                Retry
              </button>
            )}
            {stopped.state !== "changed" && stopped.canResume && (
              <button
                type="button"
                disabled={!files || resuming}
                onClick={() => runStopped(resumeStopped)}
              >
                Resume download
              </button>
            )}
          </div>
        </div>
      )}
      <p className="visually-hidden" role="status" data-testid="transfer-announcement">
        {announced.text}
      </p>
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
              autoCapitalize="none"
              autoCorrect="off"
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
                          disabled={locked}
                          aria-label={`Download file ${displayName(entry.name)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void download(
                              remoteJoin(path, entry.name),
                              displayName(entry.name),
                              entry,
                            );
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
