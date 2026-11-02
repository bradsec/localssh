import { describe, expect, it } from "vitest";
import { filterHelpTopics, HELP_TOPICS } from "./helpTopics.js";

describe("help topics", () => {
  it("ships every topic from the copy deck", () => {
    expect(HELP_TOPICS.map((topic) => topic.label)).toEqual([
      "Connect",
      "Host keys",
      "Saved hosts",
      "Terminal",
      "Background sessions",
      "Files",
      "Keyboard shortcuts",
      "Copy and paste",
      "Connection problems",
      "Privacy",
      "Self-hosting",
    ]);
  });

  it("returns every topic for an empty search", () => {
    expect(filterHelpTopics("  ")).toHaveLength(HELP_TOPICS.length);
  });

  it("matches headings and body text without regard to case", () => {
    expect(filterHelpTopics("FINGERPRINT").map((topic) => topic.id)).toEqual([
      "host-key",
      "troubleshooting",
    ]);
    expect(filterHelpTopics("paste").map((topic) => topic.id)).toContain("clipboard");
  });

  it("requires every word to match", () => {
    expect(filterHelpTopics("master password recovery").map((topic) => topic.id)).toEqual([
      "saved-hosts",
    ]);
  });

  it("explains terminal tabs and the session limit in offline Help", () => {
    const terminal = HELP_TOPICS.find((topic) => topic.id === "terminal");
    const shortcuts = HELP_TOPICS.find((topic) => topic.id === "shortcuts");
    const troubleshooting = HELP_TOPICS.find((topic) => topic.id === "troubleshooting");
    expect(terminal?.paragraphs.join(" ")).toContain("New terminal");
    expect(shortcuts?.paragraphs.join(" ")).toContain("Ctrl+Alt+Shift+Left");
    expect(troubleshooting?.paragraphs.join(" ")).toContain("MAX_SESSIONS");
  });

  it("names the operator keep-alive limit in self-hosting Help", () => {
    const hosting = HELP_TOPICS.find((topic) => topic.id === "hosting");
    expect(hosting?.paragraphs.join(" ")).toContain("KEEPALIVE_MAX_SECONDS");
  });

  it("explains mobile session recovery and current controls without stale guidance", () => {
    const topic = (id: string) =>
      HELP_TOPICS.find((entry) => entry.id === id)?.paragraphs.join(" ") ?? "";
    expect(topic("terminal")).toContain("Select text");
    expect(topic("terminal")).toContain("More keys");
    expect(topic("terminal")).toContain("Text larger");
    expect(topic("terminal")).toContain("This host");
    expect(topic("background")).toContain("Until I disconnect");
    expect(topic("background")).toContain("unlocked vault");
    expect(topic("background")).toContain("prefilled");
    expect(topic("files")).toContain("Resume download");
    expect(topic("files")).toContain("iOS closes the page");
    expect(topic("clipboard")).toContain("read-only");
    expect(topic("troubleshooting")).toContain("Resuming");
    expect(HELP_TOPICS.flatMap((entry) => entry.paragraphs).join(" ")).not.toMatch(
      /Appearance|Swipe right|Closing the page disconnects/,
    );
  });

  it("warns when a replacement fails without atomic rename", () => {
    const files = HELP_TOPICS.find((topic) => topic.id === "files");
    expect(files?.paragraphs.join(" ")).toContain("If the server supports atomic rename");
    expect(files?.paragraphs.join(" ")).toContain("previous remote file");
  });

  it("returns nothing for a search that matches no topic", () => {
    expect(filterHelpTopics("kubernetes")).toEqual([]);
  });
});
