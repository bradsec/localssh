import { describe, expect, it } from "vitest";
import { filterHelpTopics, HELP_TOPICS } from "./helpTopics.js";

describe("help topics", () => {
  it("ships every topic from the copy deck", () => {
    expect(HELP_TOPICS.map((topic) => topic.label)).toEqual([
      "Connect",
      "Host keys",
      "Saved hosts",
      "Terminal",
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

  it("returns nothing for a search that matches no topic", () => {
    expect(filterHelpTopics("kubernetes")).toEqual([]);
  });
});
