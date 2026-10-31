// The in-app Help content. It ships in the bundle so Help works with no
// network beyond the app itself. Text follows docs/repo-health/05-uxwriter.md.

export type HelpTopicId =
  | "connect"
  | "host-key"
  | "saved-hosts"
  | "terminal"
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
      "On a touch screen, the key bar supplies Esc, Tab, arrows, and other shell keys. Tap Ctrl or Alt once for the next key, twice to lock it, and a third time to turn it off.",
      "Swipe right for Tab or left for Esc. Flick up or down near the prompt for command history. Drag with two fingers to scroll output. Long press and drag to select text.",
      "Use Appearance to change the terminal font, size, or color scheme.",
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    heading: "Keyboard shortcuts",
    paragraphs: [
      "With a hardware keyboard, use Esc, Tab, arrow keys, and shell shortcuts as usual. Ctrl+C interrupts a command, Ctrl+D sends end of input, and Ctrl+Z suspends a job. Ctrl+R searches command history when the remote shell supports it.",
    ],
  },
  {
    id: "clipboard",
    label: "Copy and paste",
    heading: "Copy and paste",
    paragraphs: [
      "On iPhone, iPad, or Android, long press and drag to select terminal text. Open Clipboard and select Copy selection. If the browser blocks copying, select the text shown in the menu and use the device Copy action.",
      "To paste, open Clipboard and use Paste from clipboard. If browser access is blocked, paste into the box and select Paste text. On desktop, you can also select terminal text and use your browser's copy and paste shortcuts.",
    ],
  },
  {
    id: "troubleshooting",
    label: "Connection problems",
    heading: "Fix a connection problem",
    paragraphs: [
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
