import type { ReactNode } from "react";

export interface RecoveryRowProps {
  cause: "background" | "network" | "server" | "user";
  onReconnect: () => void;
  onClose: () => void;
  /** Host of a reconnect in progress (S-16); the row then offers only Cancel. */
  connectingTo?: string;
  /** A download the closed session cut short. */
  stoppedDownload?: { name: string; percent: number };
  onCancel?: () => void;
  /** Why the last reconnect failed (S-19), shown in place of the cause. */
  error?: ReactNode;
}

const CAUSE_TEXT = {
  background: "The connection closed while localssh was in the background.",
  network: "The connection to the server was lost.",
  server: "The server closed the connection.",
  user: "You disconnected this terminal.",
};

export function RecoveryRow({
  cause,
  onReconnect,
  onClose,
  connectingTo,
  stoppedDownload,
  onCancel,
  error,
}: RecoveryRowProps) {
  if (connectingTo !== undefined) {
    return (
      <div className="recovery-row" data-testid="recovery-row">
        <p role="status">Connecting to {connectingTo}...</p>
        <div className="recovery-row__actions">
          <button className="button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="recovery-row" data-testid="recovery-row">
      {error ?? <p>{CAUSE_TEXT[cause]}</p>}
      {stoppedDownload && (
        <p>
          Download of {stoppedDownload.name} stopped at {stoppedDownload.percent}%.
        </p>
      )}
      {!error && cause === "background" && (
        <p className="recovery-row__hint">
          To keep commands running while you are away, start them in tmux or screen.
        </p>
      )}
      <div className="recovery-row__actions">
        <button className="button" type="button" onClick={onClose}>
          Close terminal
        </button>
        <button className="button button--primary" type="button" onClick={onReconnect}>
          Reconnect
        </button>
      </div>
    </div>
  );
}
