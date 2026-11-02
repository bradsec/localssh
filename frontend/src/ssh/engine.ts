export interface SshHandle {
  write(chunk: Uint8Array): string | null;
  resize(cols: number, rows: number): void;
  close(): void;
  detach?(): void;
  resume?(): void;
  openFiles?(): Promise<SftpHandle>;
}

/** What a listing entry is, after following a symbolic link. "broken" is a link whose target cannot be read. */
export type RemoteFileKind = "file" | "folder" | "other" | "broken";

export interface RemoteFile {
  name: string;
  kind: RemoteFileKind;
  isLink: boolean;
  /** Size of the file, or of a link's target. */
  size: number;
  /** Unix milliseconds and rwx permissions from the remote file. */
  mtime: number;
  mode: string;
}

export interface RemoteListing {
  /** The server's absolute form of the requested path. */
  path: string;
  entries: RemoteFile[];
  /** True when the folder held more entries than the engine returns. */
  truncated?: boolean;
}

export interface DownloadResult {
  /** True when the server had more data than the size reported at the start. */
  grew: boolean;
  /** The size reported at the start; the download stops there. */
  size: number;
}

/** The text the engine rejects with when an upload without overwrite finds its target. */
export const REMOTE_FILE_EXISTS = "remote file exists";

/** The text the engine rejects with when a resumed download finds the remote file changed. */
export const REMOTE_FILE_CHANGED = "remote file changed";

/**
 * Resumes a download. Above offset 0 the engine requires the remote size and
 * mtime (Unix ms, as listings report) to match and the remote bytes just
 * before offset to equal tail, else it rejects with REMOTE_FILE_CHANGED.
 */
export interface DownloadOptions {
  offset?: number;
  expectSize?: number;
  expectMtime?: number;
  tail?: Uint8Array;
  /** Called with the remote size and mtime before the first chunk. */
  onStart?: (info: { size: number; mtime: number }) => void;
}

export interface SftpHandle {
  list(path: string): Promise<RemoteListing>;
  upload(
    path: string,
    file: File,
    overwrite: boolean,
    onProgress: (percent: number) => void,
  ): Promise<void>;
  download(
    path: string,
    onChunk: (chunk: Uint8Array) => Promise<void>,
    onProgress: (percent: number) => void,
    opts?: DownloadOptions,
  ): Promise<DownloadResult | undefined>;
  cancel(): void;
  close(): void;
}

export class FilesClosedError extends Error {
  constructor() {
    super("The file connection is closed. Open Files again.");
    this.name = "FilesClosedError";
  }
}

function settled<T>(result: Promise<T> | undefined): Promise<T> {
  // The engine releases its functions when Files or the session closes. A
  // call through a released function returns undefined instead of a Promise,
  // which would otherwise read as success.
  if (typeof (result as { then?: unknown } | undefined)?.then !== "function") {
    return Promise.reject(new FilesClosedError());
  }
  return result as Promise<T>;
}

/** Wraps an engine file handle so calls made after it closed reject. */
export function guardSftp(raw: SftpHandle): SftpHandle {
  return {
    list: async (path) => {
      const listing = await settled(raw.list(path));
      if (!listing || typeof listing.path !== "string" || !Array.isArray(listing.entries)) {
        throw new FilesClosedError();
      }
      return listing;
    },
    upload: (path, file, overwrite, onProgress) =>
      settled(raw.upload(path, file, overwrite, onProgress)),
    // Without opts the engine call keeps its original three arguments.
    download: (path, onChunk, onProgress, opts) =>
      settled(
        opts === undefined
          ? raw.download(path, onChunk, onProgress)
          : raw.download(path, onChunk, onProgress, opts),
      ),
    cancel: () => raw.cancel(),
    close: () => raw.close(),
  };
}

/** Opens the engine's file handle for a session, rejecting if the session has closed. */
export async function openFiles(handle: SshHandle): Promise<SftpHandle> {
  if (!handle.openFiles) throw new Error("SFTP is unavailable in this SSH engine");
  return guardSftp(await settled(handle.openFiles()));
}

declare global {
  interface Window {
    Go: new () => {
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): Promise<void>;
    };
    sshConnect: (
      relayWsUrl: string,
      host: string,
      port: string,
      username: string,
      password: string | { fromVault: string } | { privateKey: Uint8Array; passphrase: string },
      callbacks: {
        onHostKey: (fingerprint: string) => boolean;
        onData: (chunk: Uint8Array) => void;
        /** Gets "" for a clean end, or why the connection was lost. */
        onClose: (reason?: string) => void;
        keepAliveMs?: number | null;
        onTransportStatus?: (
          status: "connected" | "reconnecting" | "expired",
          info?: { grantedGraceMs: number | null; capGraceMs: number | null },
        ) => void;
      },
    ) => Promise<SshHandle>;
  }
}

let enginePromise: Promise<void> | null = null;

export async function instantiateEngine(
  response: Response,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  if (!response.ok) {
    throw new Error(`Could not load the SSH engine (HTTP ${response.status}).`);
  }
  const fallbackResponse = response.clone();
  try {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const bytes = await fallbackResponse.arrayBuffer();
    return (await WebAssembly.instantiate(bytes, imports)).instance;
  }
}

// loadEngine is idempotent: the WASM module and its Go runtime can only be
// instantiated once per page, so repeated calls share the same in-flight
// (or already-resolved) load.
export function loadEngine(): Promise<void> {
  if (!enginePromise) {
    const attempt = (async () => {
      // Resolve asset URLs against Vite's BASE_URL, not the site root, so the
      // app works when deployed under a subpath.
      const base = import.meta.env.BASE_URL;
      await import(/* @vite-ignore */ `${base}wasm_exec.js`);
      const go = new window.Go();
      const response = await fetch(`${base}engine.wasm`);
      const instance = await instantiateEngine(response, go.importObject);
      void go.run(instance); // main() blocks in select{}, so do not await it.
    })();

    // Only a successful load is cached. Caching a rejection would make one
    // transient fetch failure break every later connect until a page reload.
    enginePromise = attempt.catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

// connectSession calls loadEngine through this indirection so tests can
// substitute a no-op without touching the real WASM loader. vi.mock cannot
// intercept the call below because it is a same-module reference, not an
// import, and a plain exported `let` is read-only from outside the module.
export const loadEngineImpl: { current: () => Promise<void> } = { current: loadEngine };

export class HostKeyRejectedError extends Error {
  readonly hostPort: string;
  readonly fingerprint: string;

  constructor(hostPort: string, fingerprint: string) {
    super(`host key for ${hostPort} is not trusted (fingerprint ${fingerprint})`);
    this.name = "HostKeyRejectedError";
    this.hostPort = hostPort;
    this.fingerprint = fingerprint;
  }
}

/**
 * How a connection gets its password. A saved password is referenced rather
 * than passed: it lives in the engine and never enters JavaScript, where a
 * string could not be wiped afterwards.
 */
export type ConnectPassword =
  | { kind: "typed"; value: string }
  | { kind: "vault"; entryId: string }
  | { kind: "key"; privateKey: Uint8Array; passphrase: string };

export interface ConnectOptions {
  relayWsUrl: string;
  host: string;
  port: number;
  username: string;
  password: ConnectPassword;
  // The WASM host-key callback must return synchronously. Callers must load
  // trusted fingerprints before connecting and look them up in memory here.
  isTrustedFingerprint: (fingerprint: string) => boolean;
  onData: (chunk: Uint8Array) => void;
  /** `reason` is "" when the shell ended or the page closed the session. */
  onClose: (reason: string) => void;
  keepAliveMs?: number | null;
  onTransportStatus?: (
    status: "connected" | "reconnecting" | "expired",
    info?: { grantedGraceMs: number | null; capGraceMs: number | null },
  ) => void;
}

export async function connectSession(options: ConnectOptions): Promise<SshHandle> {
  const hostPort = `${options.host}:${options.port}`;
  let capturedFingerprint = "";

  try {
    await loadEngineImpl.current();
    const handle = await window.sshConnect(
      options.relayWsUrl,
      options.host,
      String(options.port),
      options.username,
      options.password.kind === "typed"
        ? options.password.value
        : options.password.kind === "vault"
          ? { fromVault: options.password.entryId }
          : { privateKey: options.password.privateKey, passphrase: options.password.passphrase },
      {
        onHostKey: (fingerprint) => {
          capturedFingerprint = fingerprint;
          return options.isTrustedFingerprint(fingerprint);
        },
        onData: options.onData,
        onClose: (reason) => options.onClose(reason ?? ""),
        keepAliveMs: options.keepAliveMs,
        onTransportStatus: options.onTransportStatus,
      },
    );
    if (options.password.kind === "key") options.password.privateKey.fill(0);
    return handle;
  } catch (error) {
    // The Go SSH stack wraps the rejection sentinel during the handshake, so
    // the Promise rejects with a longer string containing this message.
    if (
      capturedFingerprint !== "" &&
      typeof error === "string" &&
      error.includes("host key rejected")
    ) {
      throw new HostKeyRejectedError(hostPort, capturedFingerprint);
    }
    if (options.password.kind === "key") options.password.privateKey.fill(0);
    throw error;
  }
}
