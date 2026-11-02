import type { IBuffer } from "@xterm/xterm";

export function snapshotTerminalText(buffer: IBuffer): string {
  let text = "";
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index);
    if (!line) continue;
    if (index > 0 && !line.isWrapped) text += "\n";
    text += line.translateToString(false);
  }
  return text;
}
