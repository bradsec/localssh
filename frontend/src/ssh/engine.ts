export interface SshHandle {
  write(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
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
      password: string,
      callbacks: {
        onHostKey: (fingerprint: string) => boolean;
        onData: (chunk: Uint8Array) => void;
        onClose: () => void;
      },
    ) => Promise<SshHandle>;
  }
}

let enginePromise: Promise<void> | null = null;

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
      const { instance } = await WebAssembly.instantiateStreaming(response, go.importObject);
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

export interface ConnectOptions {
  relayWsUrl: string;
  host: string;
  port: number;
  username: string;
  password: string;
  // The WASM host-key callback must return synchronously. Callers must load
  // trusted fingerprints before connecting and look them up in memory here.
  isTrustedFingerprint: (fingerprint: string) => boolean;
  onData: (chunk: Uint8Array) => void;
  onClose: () => void;
}

export async function connectSession(options: ConnectOptions): Promise<SshHandle> {
  await loadEngine();
  const hostPort = `${options.host}:${options.port}`;
  let capturedFingerprint = "";

  try {
    return await window.sshConnect(
      options.relayWsUrl,
      options.host,
      String(options.port),
      options.username,
      options.password,
      {
        onHostKey: (fingerprint) => {
          capturedFingerprint = fingerprint;
          return options.isTrustedFingerprint(fingerprint);
        },
        onData: options.onData,
        onClose: options.onClose,
      },
    );
  } catch (error) {
    // The Go SSH stack wraps the rejection sentinel during the handshake, so
    // the Promise rejects with a longer string containing this message.
    if (typeof error === "string" && error.includes("host key rejected")) {
      throw new HostKeyRejectedError(hostPort, capturedFingerprint);
    }
    throw error;
  }
}
