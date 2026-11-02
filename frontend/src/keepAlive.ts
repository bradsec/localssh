export type KeepAliveChoice = "off" | 120 | 300 | 600 | 900 | 3600 | "until-disconnect";

export const KEEP_ALIVE_CHOICES: readonly KeepAliveChoice[] = [
  "off",
  120,
  300,
  600,
  900,
  3600,
  "until-disconnect",
];

export function requestedGraceMs(choice: KeepAliveChoice): number | null | "v1" {
  if (choice === "off") return "v1";
  if (choice === "until-disconnect") return null;
  return choice * 1000;
}

export function formatGrace(ms: number | null): string {
  if (ms === null) return "no limit";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder) return `${hours} hr ${remainder} min`;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
