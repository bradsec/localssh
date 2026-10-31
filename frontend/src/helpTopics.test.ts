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

  it("returns nothing for a search that matches no topic", () => {
    expect(filterHelpTopics("kubernetes")).toEqual([]);
  });
});
