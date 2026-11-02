// The in-app Help content. It ships in the bundle so Help works with no
// network beyond the app itself. Text follows docs/repo-health/05-uxwriter.md.

export type HelpTopicId =
  | "connect"
  | "host-key"
  | "saved-hosts"
  | "terminal"
  | "background"
  | "files"
  | "shortcuts"
  | "clipboard"
  | "troubleshooting"
  | "privacy"
  | "hosting";

export interface HelpTopic {
  id: HelpTopicId;
  /** Short name for the topic list and for "Learn more" links. */
  label: string;
  heading: string;
  paragraphs: string[];
  link?: { href: string; text: string };
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "connect",
    label: "Connect",
    heading: "Connect to a server",
    paragraphs: [
      "Enter the server hostname or IP address, SSH port, username, and password. Select Connect to server. Port 22 is the usual SSH port.",
      "You can connect without setting up saved hosts. A password you type is kept for this connection only.",
      "For key-only servers, choose Private key. Select an OpenSSH Ed25519, ECDSA, or RSA key, an unencrypted PKCS#8 PEM key, or a legacy RSA or EC PEM key. You can also paste the key. OpenSSH and legacy PEM keys may use a passphrase; encrypted PKCS#8 PEM is unsupported.",
    ],
  },
  {
    id: "host-key",
    label: "Host keys",
    heading: "Check the host key",
    paragraphs: [
      "On your first connection, compare the SHA-256 fingerprint with one from the server administrator or server console. Select Trust and connect only if they match.",
      "If the key changes later, stop and check why. A server reinstall can change a key, but an intercepted connection can too. Compare the new fingerprint through a trusted route before selecting Replace key and connect.",
    ],
  },
  {
    id: "saved-hosts",
    label: "Saved hosts",
    heading: "Save a host",
    paragraphs: [
      "Create an address book with a master password, then select Save current host. Choose whether to save the host, username, or password. Saved entries are encrypted in this browser.",
      "Unlock saved hosts once per page load. There is no master password recovery. If you forget it, you must delete the address book and start again.",
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    heading: "Use the terminal",
    paragraphs: [
      "Select New terminal to connect to another server without closing your open shells. On a phone, select the target to open Open terminals and switch shells; on desktop, select a tab. Close disconnects only that shell. Each terminal keeps its own output and size. With background keep-alive enabled, leaving the page holds the session for the chosen time; Off closes it when the connection drops.",
      "If another connection needs a host-key check, select Return to open terminal to keep working. Select the connecting tab to return to the check.",
      "On a touch screen, the key bar shows the keys that fit. More keys opens the rest and replaces the on-screen keyboard until closed. Tap Ctrl or Alt once for the next key, twice to lock it, and a third time to turn it off. Use Text smaller and Text larger to change font size; use Settings, Key bar to reorder, add, remove, or reset keys.",
      "On touch screens, drag with one finger to scroll output. Long press or select Select text to open a read-only view with native text selection. Use the visible keys for Tab, Esc, and command history.",
      "Use Settings to change font, size, line height, or color scheme. Saved hosts can use This host settings while the vault is unlocked; otherwise the all-hosts settings apply. In short phone landscape with the keyboard open, the target and key bar share a row at the top.",
    ],
  },
  {
    id: "background",
    label: "Background sessions",
    heading: "Keep a session alive in the background",
    paragraphs: [
      "Choose Off, 2 min (default), 5 min, 10 min, 15 min, 1 hour, or Until I disconnect in Settings, Session. The server may set a shorter limit; Settings shows it. The choice applies to terminals you open next. Resuming keeps the same SSH session when the relay still holds it.",
      "While a session remains open, anyone who can use this browser can use its terminal without signing in. Choose a shorter time on a shared device.",
      "If the session expires or closes, Select text still opens the saved output. Reconnect uses saved credentials in one tap only from an unlocked vault. Otherwise it opens the connect form prefilled with host, port, and user. A new connection marks where its output begins. If iOS closes the page, reload and sign in again. Use tmux or screen on the server for work that must keep running.",
    ],
  },
  {
    id: "files",
    label: "Files",
    heading: "Browse and transfer files",
    paragraphs: [
      "Select Files in a connected terminal tab to browse that server. Use the path breadcrumbs, double-click a folder, select Up, or choose Go to path to enter a remote path. Select a column heading to sort; folders stay first. Type in Filter files to show only names that contain the text, ignoring case; the count beside it shows how many items match, and clearing it restores the list and selection. Arrow keys move the selected row, Home and End jump to the first and last item, Page Up and Page Down move a screen at a time, Enter opens a selected folder, and Backspace or Alt+Up goes to its parent. Only the list scrolls, so the path, toolbar, and filter stay in view. Rows are compact with a mouse and larger on touch screens. Expand gives Files the full desktop session area while the terminal stays connected. Each tab keeps its own Files view.",
      "Select Upload to choose one file from your device, or drop a file onto Files. If that name already exists on the server, localssh asks before replacing it. The new file keeps the old file's permissions, but not its owner or access lists, and a link at that name is replaced rather than followed. Select Download beside a remote file to save it on your device. Transfer results appear as notifications above the panel.",
      "Cancel stops the current transfer. Closing Files leaves the terminal connected, and asks first while a transfer runs. Disconnecting closes both. A cancelled upload before replacement keeps the previous remote file and removes its hidden .localssh-upload- copy. If the server supports atomic rename, a failed replacement also keeps the previous remote file. Without it, the previous file can be lost and the upload kept as a hidden copy. If the connection drops first, that copy is removed when its folder is listed again after 24 hours.",
      "Downloads pause while localssh is in the background and continue after the session resumes. If the session expires, sign in to the same host and choose Resume download to continue from saved bytes. If the file changed on the server or partial data is missing, choose Retry to start over. If iOS closes the page, partial download data may be lost. Keep localssh open until the download finishes.",
      "Downloads use browser file storage when available. Your browser may ask where to save the file or offer a Share or Save to Files action. Save download stays available for 10 minutes, or until the next transfer or Close files. If browser storage is unavailable, downloads are limited to 16 MiB.",
      "Names with control or text-direction characters show those characters as <U+XXXX>, so a name cannot disguise its real extension.",
      "A folder with more than 10,000 items shows a persistent note and a notification. Only the first 10,000 items appear. Modified dates use your device's local time.",
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    heading: "Keyboard shortcuts",
    paragraphs: [
      "Use Ctrl+Alt+Shift+Left or Ctrl+Alt+Shift+Right to switch between open terminal tabs. These shortcuts work outside the terminal input as well.",
      "With a hardware keyboard, use Esc, Tab, arrow keys, and shell shortcuts as usual. Ctrl+C interrupts a command, Ctrl+D sends end of input, and Ctrl+Z suspends a job. Ctrl+R searches command history when the remote shell supports it.",
    ],
  },
  {
    id: "clipboard",
    label: "Copy and paste",
    heading: "Copy and paste",
    paragraphs: [
      "On a touch screen, long press or select Select text to open a read-only view with native selection handles. Select the text and use the device Copy action. Clipboard can copy a live terminal selection; if the browser blocks copying, select the text shown in the menu and use the device Copy action.",
      "To paste, open Clipboard and use Paste from clipboard. If browser access is blocked, paste into the box and select Paste text. On desktop, you can also select terminal text and use your browser's copy and paste shortcuts.",
    ],
  },
  {
    id: "troubleshooting",
    label: "Connection problems",
    heading: "Fix a connection problem",
    paragraphs: [
      "If another terminal cannot open, the relay may have reached MAX_SESSIONS. Close a terminal you no longer need and try again. Check the relay log to distinguish this from other connection failures.",
      "If a terminal shows Resuming after a network loss or app switch, wait for the same SSH session to return. If it closes, the recovery row names the cause and offers Reconnect. A fresh connection cannot restore a process from the closed session; use tmux or screen for long-running work.",
      "If the relay cannot be reached, check that localssh is running and that you opened the right address. If you run the relay, check its logs for a refused origin, host, or port.",
      "If the SSH login fails, check the host, port, username, and password. Ask the server administrator whether the server accepts password login. If a host key changed, verify the new fingerprint before continuing.",
      "If a private key cannot be read, check its format and passphrase. If the server rejects it, check that its public key is in ~/.ssh/authorized_keys on the server, or use password login.",
    ],
  },
  {
    id: "privacy",
    label: "Privacy",
    heading: "How your connection is protected",
    paragraphs: [
      "The SSH engine runs in your browser. The relay connects your browser to the server because browsers cannot open raw TCP connections. It carries encrypted SSH traffic and cannot read your password or terminal output.",
      "Saved hosts and optional saved passwords are encrypted under your master password in this browser. The SSH server receives your login credentials through the encrypted SSH connection. localssh has no application account or credential server. This design has not been independently audited.",
      "Private keys and key passphrases are used for the current connection only. They are not saved in browser storage or sent to the relay.",
    ],
  },
  {
    id: "hosting",
    label: "Self-hosting",
    heading: "Run localssh yourself",
    paragraphs: [
      "Docker Compose serves the app and relay through one web port. The default address is localhost:9080. For LAN access, set a LAN bind address and restrict the target hosts and ports in the relay configuration.",
      "Do not expose the HTTP service directly to the internet. For internet access, use an authenticated HTTPS reverse proxy and a restrictive target allowlist.",
      "KEEPALIVE_MAX_SECONDS limits how long the relay can hold a detached session. It defaults to 3600 seconds; 0 disables resume, and unlimited keeps orphaned sessions until capacity eviction or relay restart. With ALLOWED_ORIGINS=* explicitly set, resume is off unless you set KEEPALIVE_MAX_SECONDS explicitly.",
    ],
    link: {
      href: "https://github.com/bradsec/localssh#install-with-docker",
      text: "Read setup and update instructions",
    },
  },
];

/** Topics whose label, heading, or text contains every word of the query. */
export function filterHelpTopics(query: string): HelpTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...HELP_TOPICS];
  return HELP_TOPICS.filter((topic) => {
    const text = [topic.label, topic.heading, ...topic.paragraphs].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function helpTopicLabel(id: HelpTopicId): string {
  return HELP_TOPICS.find((topic) => topic.id === id)?.label ?? "Help";
}
