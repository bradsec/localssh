import { describe, expect, it } from "vitest";
import { FileArchive, FileCode, FileImage, FileKey, FileText, Folder, Link } from "lucide-react";
import { fileIcon, sortEntries, breadcrumbs, formatBytes } from "./fileExplorer.js";
import type { RemoteFile } from "./ssh/engine.js";

const entry = (name: string, kind: RemoteFile["kind"] = "file", size = 0): RemoteFile => ({
  name,
  kind,
  size,
  isLink: false,
  mtime: 0,
  mode: "rw-r--r--",
});

describe("file explorer", () => {
  it("formats sizes without compact notation ambiguity", () => {
    expect(formatBytes(2400)).toBe("2.3 KiB");
    expect(formatBytes(19)).toBe("19 B");
  });
  it("maps file types and links to Lucide icons", () => {
    expect(fileIcon(entry("docs", "folder"))).toBe(Folder);
    expect(fileIcon({ ...entry("ref", "folder"), isLink: true })).toBe(Link);
    expect(fileIcon(entry("README.md"))).toBe(FileText);
    expect(fileIcon(entry("deploy.sh"))).toBe(FileCode);
    expect(fileIcon(entry("backup.tar.gz"))).toBe(FileArchive);
    expect(fileIcon(entry("photo.webp"))).toBe(FileImage);
    expect(fileIcon(entry("id_ed25519"))).toBe(FileKey);
  });

  it("sorts folders first for both size directions", () => {
    const items = [
      entry("large", "file", 20),
      entry("folder", "folder"),
      entry("small", "file", 2),
    ];
    expect(sortEntries(items, "size", "asc").map((item) => item.name)).toEqual([
      "folder",
      "small",
      "large",
    ]);
    expect(sortEntries(items, "size", "desc").map((item) => item.name)).toEqual([
      "folder",
      "large",
      "small",
    ]);
  });

  it("collapses long paths while keeping each destination", () => {
    expect(breadcrumbs("/a/b/c/d/e/f")).toEqual([
      { label: "/", path: "/" },
      { label: "a", path: "/a" },
      { label: "…", path: "" },
      { label: "f", path: "/a/b/c/d/e/f" },
    ]);
  });
});
