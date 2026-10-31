import { describeConnectionFailure } from "../connectionErrors.js";
import { LearnMore } from "./Help.js";

/**
 * A failed or dropped connection as a recovery step, with the engine's own
 * text kept under Technical details for a bug report or the relay log.
 */
export function ConnectionError({ raw }: { raw: string }) {
  const failure = describeConnectionFailure(raw);
  return (
    <div className="connection-error" role="alert">
      <p>
        <strong>{failure.message}</strong> {failure.recovery}
      </p>
      {failure.causes && (
        <ul className="connection-error__causes">
          {failure.causes.map(({ cause, fix }) => (
            <li key={cause}>
              {cause} {fix}
            </li>
          ))}
        </ul>
      )}
      <div className="connection-error__footer">
        <LearnMore topic={failure.topic} />
        <details className="connection-error__detail">
          <summary>Technical details</summary>
          <code>{raw}</code>
        </details>
      </div>
    </div>
  );
}
