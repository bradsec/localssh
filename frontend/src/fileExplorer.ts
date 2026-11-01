import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileKey,
  FileText,
  Folder,
  Link,
} from "lucide-react";
import { displayName } from "./remoteFiles.js";
import type { RemoteFile } from "./ssh/engine.js";

export type SortColumn = "name" | "size" | "mtime" | "mode";
export type SortDirection = "asc" | "desc";

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const unit = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}

export function fileIcon(entry: RemoteFile) {
  if (entry.isLink) return Link;
  if (entry.kind === "folder") return Folder;
  if (entry.kind !== "file") return File;
  const name = entry.name.toLowerCase();
  if (/^(id_[^.]*)$/.test(name) || /\.(pem|key|pub)$/.test(name)) return FileKey;
  if (/\.(txt|md|log|conf|ini|yaml|json|csv)$/.test(name)) return FileText;
  if (/\.(sh|py|js|ts|go|rs|c|h|html|css)$/.test(name)) return FileCode;
  if (/\.(zip|tar|gz|tgz|xz|bz2|7z)$/.test(name)) return FileArchive;
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(name)) return FileImage;
  return File;
}

export function sortEntries(entries: RemoteFile[], column: SortColumn, direction: SortDirection) {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    const value =
      column === "name"
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        : column === "mode"
          ? a.mode.localeCompare(b.mode)
          : a[column] - b[column];
    return (direction === "asc" ? value : -value) || a.name.localeCompare(b.name);
  });
}

/** Keeps entries whose shown name contains the query, ignoring case. */
export function filterEntries(entries: RemoteFile[], query: string): RemoteFile[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => displayName(entry.name).toLocaleLowerCase().includes(needle));
}

export function breadcrumbs(path: string) {
  if (path === ".") return [{ label: "Home", path: "." }];
  const parts = path.split("/").filter(Boolean);
  const all = [
    { label: "/", path: "/" },
    ...parts.map((label, index) => ({
      label,
      path: `/${parts.slice(0, index + 1).join("/")}`,
    })),
  ];
  return all.length > 4 ? [all[0]!, all[1]!, { label: "…", path: "" }, all.at(-1)!] : all;
}
