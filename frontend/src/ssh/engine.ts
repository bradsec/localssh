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
      password: string | { fromVault: string },
      callbacks: {
        onHostKey: (fingerprint: string) => boolean;
        onData: (chunk: Uint8Array) => void;
        onClose: () => void;
      },
    ) => Promise<SshHandle>;
  }
}

let enginePromise: Promise<void> | null = null;

export async function instantiateEngine(
  response: Response,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
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
export type ConnectPassword = { kind: "typed"; value: string } | { kind: "vault"; entryId: string };

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
  onClose: () => void;
}

export async function connectSession(options: ConnectOptions): Promise<SshHandle> {
  await loadEngineImpl.current();
  const hostPort = `${options.host}:${options.port}`;
  let capturedFingerprint = "";

  try {
    return await window.sshConnect(
      options.relayWsUrl,
      options.host,
      String(options.port),
      options.username,
      options.password.kind === "typed"
        ? options.password.value
        : { fromVault: options.password.entryId },
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
