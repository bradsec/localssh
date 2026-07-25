import { useEffect, useRef, type KeyboardEvent } from "react";

export interface HostKeyPromptProps {
  hostPort: string;
  fingerprint: string;
  changed?: boolean;
  previousFingerprint?: string;
  onTrust: () => void;
  onCancel: () => void;
}

export function HostKeyPrompt({
  hostPort,
  fingerprint,
  changed,
  previousFingerprint,
  onTrust,
  onCancel,
}: HostKeyPromptProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
  }, []);

  // aria-modal alone does not stop Tab from reaching the connect form behind
  // this prompt, which would let someone act on the form while a host-key
  // warning is unanswered. Keep focus inside the dialog until it is dismissed.
  useEffect(() => {
    function trapFocus(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus, true);
    return () => document.removeEventListener("keydown", trapFocus, true);
  }, []);

  function cancel() {
    const returnFocus = returnFocusRef.current;
    onCancel();
    requestAnimationFrame(() => returnFocus?.focus());
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") cancel();
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className={`host-key-dialog${changed ? " host-key-dialog--danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="host-key-title"
        aria-describedby="host-key-description"
        onKeyDown={handleKeyDown}
      >
        {changed ? (
          <>
            <p className="dialog-label dialog-label--danger">Security warning</p>
            <h2 id="host-key-title">Host key changed</h2>
            <p id="host-key-description">
              The key for <strong>{hostPort}</strong> differs from the key you trusted before. This
              may mean the server was reinstalled or the connection is being intercepted.
            </p>
            <dl className="fingerprint-list">
              <div>
                <dt>Previously trusted</dt>
                <dd><code>{previousFingerprint}</code></dd>
              </div>
              <div>
                <dt>Now offered</dt>
                <dd><code>{fingerprint}</code></dd>
              </div>
            </dl>
            <p>Do not continue unless you know why the key changed.</p>
            <div className="dialog-actions">
              <button
                ref={cancelRef}
                className="button button--secondary"
                type="button"
                onClick={cancel}
              >
                Cancel (recommended)
              </button>
              <button className="button button--danger" type="button" onClick={onTrust}>
                Replace key and connect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-label">First connection</p>
            <h2 id="host-key-title">Verify host key</h2>
            <p id="host-key-description">
              <strong>{hostPort}</strong> is not in your known hosts. Compare this fingerprint with
              one obtained from the server administrator or console.
            </p>
            <div className="fingerprint">
              <span>SHA256 fingerprint</span>
              <code>{fingerprint}</code>
            </div>
            <div className="dialog-actions">
              <button
                ref={cancelRef}
                className="button button--secondary"
                type="button"
                onClick={cancel}
              >
                Cancel
              </button>
              <button className="button button--primary" type="button" onClick={onTrust}>
                Trust and connect
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
