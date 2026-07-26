import { rateMasterPassword } from "../vault/passwordStrength.js";

const BAND_LABEL = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
} as const;

const SEGMENT_BANDS = ["weak", "fair", "good", "strong"] as const;

/** Advisory only: this renders a rating and never gates a form. */
export function PasswordStrength({ password }: { password: string }) {
  if (password === "") return null;

  const { band, score, advice } = rateMasterPassword(password);

  return (
    <div className={`strength strength--${band}`}>
      <div className="strength__bar" aria-hidden="true">
        {SEGMENT_BANDS.map((segmentBand, segment) => (
          <span
            className={
              segment <= score
                ? `strength__segment strength__segment--${segmentBand} strength__segment--on`
                : `strength__segment strength__segment--${segmentBand}`
            }
            key={segmentBand}
          />
        ))}
      </div>
      <p className="strength__reading" role="status">
        <strong>{BAND_LABEL[band]}</strong> {advice}
      </p>
    </div>
  );
}
