import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";

const STARTUP_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

function captureStderr(child: ChildProcessWithoutNullStreams): string[] {
  const stderr: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });
  return stderr;
}

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  stderr: string[],
  description: string,
  isReady: (line: string) => boolean,
): Promise<string> {
  const lines = createInterface({ input: child.stdout });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `${description} did not become ready within ${STARTUP_TIMEOUT_MS}ms: ${stderr.join("")}`,
        ),
      );
    }, STARTUP_TIMEOUT_MS);

    const onLine = (line: string) => {
      if (!isReady(line)) return;
      cleanup();
      resolve(line);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(`${description} failed to start: ${error.message}`));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `${description} exited before becoming ready (code=${code}, signal=${signal}): ${stderr.join("")}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      lines.off("line", onLine);
      child.off("error", onError);
      child.off("exit", onExit);
      lines.close();
    };

    lines.on("line", onLine);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

async function stopChild(
  child: ChildProcessWithoutNullStreams | undefined,
  closeStdin: boolean,
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (closeStdin) {
    child.stdin.end();
  } else {
    child.kill("SIGTERM");
  }

  if (await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) return;

  child.kill("SIGKILL");
  if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(`child process ${child.pid ?? "unknown"} did not exit`);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const frontendDir = path.resolve(import.meta.dirname, "..");
  const engineDir = path.resolve(frontendDir, "../engine");
  const relayDir = path.resolve(frontendDir, "../relay");
  const previousSshdAddress = process.env.E2E_SSHD_ADDR;

  let sshd: ChildProcessWithoutNullStreams | undefined;
  let relay: ChildProcessWithoutNullStreams | undefined;

  const cleanup = async () => {
    try {
      await stopChild(relay, false);
    } finally {
      await stopChild(sshd, true);
      if (previousSshdAddress === undefined) {
        delete process.env.E2E_SSHD_ADDR;
      } else {
        process.env.E2E_SSHD_ADDR = previousSshdAddress;
      }
    }
  };

  try {
    execFileSync(path.join(engineDir, "build.sh"), { cwd: engineDir });

    sshd = spawn(path.join(engineDir, "dist/testsshd"), ["tester", "s3cret"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sshdStderr = captureStderr(sshd);
    process.env.E2E_SSHD_ADDR = await waitForOutput(
      sshd,
      sshdStderr,
      "test SSH server",
      (line) => line.length > 0,
    );

    const requireFromRelay = createRequire(path.join(relayDir, "package.json"));
    const tsxCli = requireFromRelay.resolve("tsx/cli");
    relay = spawn(process.execPath, [tsxCli, "scripts/run-local-relay.ts", "8787"], {
      cwd: relayDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const relayStderr = captureStderr(relay);
    await waitForOutput(
      relay,
      relayStderr,
      "local relay",
      (line) => line === "local relay listening on 8787",
    );

    return cleanup;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("E2E cleanup failed after setup error:", cleanupError);
    }
    throw error;
  }
}
