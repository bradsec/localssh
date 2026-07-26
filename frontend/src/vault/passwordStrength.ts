// An advisory master password meter. It never blocks a submission and imposes
// no composition rules, following NIST SP 800-63B: length is what matters,
// mandatory character classes are not, and common passwords are screened.
//
// This is a heuristic, not a real guess-count estimator. It will call some bad
// passwords good. It exists to steer a user towards length, not to certify.

export type StrengthBand = "weak" | "fair" | "good" | "strong";

export interface Strength {
  band: StrengthBand;
  score: 0 | 1 | 2 | 3;
  /** Estimated bits of entropy, after penalties. */
  bits: number;
  advice: string;
}

/**
 * The passwords a guessing attack tries first. Kept deliberately short: a real
 * blocklist belongs in a service, and shipping one here would cost more bytes
 * than it buys.
 */
const COMMON = new Set([
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "sunshine",
  "iloveyou",
  "admin",
  "administrator",
  "root",
  "toor",
  "login",
  "master",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "zxcvbn",
  "abc",
  "abcabc",
  "test",
  "guest",
  "changeme",
  "secret",
  "trustno",
  "football",
  "baseball",
  "superman",
  "batman",
  "princess",
  "shadow",
  "michael",
  "jennifer",
  "hunter",
  "freedom",
  "whatever",
  "starwars",
  "computer",
  "internet",
  "samsung",
  "google",
  "facebook",
]);

const RUNS = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

const BAND_BITS: Array<{ bits: number; band: StrengthBand; score: 0 | 1 | 2 | 3 }> = [
  { bits: 110, band: "strong", score: 3 },
  { bits: 85, band: "good", score: 2 },
  { bits: 60, band: "fair", score: 1 },
];

export function rateMasterPassword(password: string): Strength {
  if (password === "") {
    return { band: "weak", score: 0, bits: 0, advice: "Use a long passphrase you can remember." };
  }

  const bits = penalised(password, rawBits(password));

  if (isCommon(password)) {
    return {
      band: "weak",
      score: 0,
      bits: Math.min(bits, 20),
      advice: "This is one of the first passwords an attacker tries. Choose something else.",
    };
  }

  for (const { bits: floor, band, score } of BAND_BITS) {
    if (bits >= floor) return { band, score, bits, advice: adviceFor(band) };
  }
  return { band: "weak", score: 0, bits, advice: adviceFor("weak") };
}

/** Entropy if every character were drawn at random from the classes in use. */
function rawBits(password: string): number {
  const characters = [...password];
  let alphabet = 0;
  if (characters.some((c) => c >= "a" && c <= "z")) alphabet += 26;
  if (characters.some((c) => c >= "A" && c <= "Z")) alphabet += 26;
  if (characters.some((c) => c >= "0" && c <= "9")) alphabet += 10;
  if (characters.some((c) => /[^a-zA-Z0-9]/.test(c) && c.codePointAt(0)! < 128)) alphabet += 33;
  // Anything outside ASCII widens the space considerably, but guessing it is
  // rarely as hard as the code point count suggests.
  if (characters.some((c) => c.codePointAt(0)! >= 128)) alphabet += 100;

  return characters.length * Math.log2(Math.max(alphabet, 2));
}

/**
 * Discounts structure a random-character model cannot see: repetition and runs
 * along the keyboard or the digits are far cheaper to guess than their length
 * implies.
 */
function penalised(password: string, bits: number): number {
  const lowered = password.toLowerCase();
  const distinct = new Set([...lowered]).size;

  // A password built from very few distinct characters is close to a short one.
  let adjusted = bits * Math.min(1, distinct / 8);

  let runLength = 0;
  for (const run of RUNS) {
    for (let length = 4; length <= lowered.length; length += 1) {
      for (let start = 0; start + length <= lowered.length; start += 1) {
        const slice = lowered.slice(start, start + length);
        if (run.includes(slice) || [...run].reverse().join("").includes(slice)) {
          runLength = Math.max(runLength, length);
        }
      }
    }
  }
  if (runLength >= 4) adjusted *= Math.max(0.35, 1 - runLength / lowered.length);

  return Math.round(adjusted);
}

function isCommon(password: string): boolean {
  const normalised = password
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "l")
    .replace(/[3]/g, "e")
    .replace(/[$5]/g, "s")
    .replace(/[^a-z]/g, "");

  if (COMMON.has(normalised)) return true;
  // "password2026", "qwerty123": a common stem with trailing padding stripped.
  return [...COMMON].some(
    (common) => normalised.startsWith(common) && normalised.length - common.length <= 4,
  );
}

function adviceFor(band: StrengthBand): string {
  switch (band) {
    case "weak":
      return "Make it longer. Length protects you far more than adding symbols does.";
    case "fair":
      return "Longer still. Several unrelated words beat one word with substitutions.";
    case "good":
      return "Reasonable. A few more words would make it materially harder to guess.";
    case "strong":
      return "Good length and variety.";
  }
}
