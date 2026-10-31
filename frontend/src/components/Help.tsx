import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.js";

export function Help() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: Event) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      detailsRef.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <details
      className="help"
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary role="button">
        <Icon name="info" />
        <span className="toolbar-label">Help</span>
      </summary>
      <div className="help__panel">
        <h2>Help with localssh</h2>
        <nav aria-label="Help topics">
          <a href="#help-connect">Connect</a>
          <a href="#help-host-key">Host keys</a>
          <a href="#help-saved-hosts">Saved hosts</a>
          <a href="#help-terminal">Terminal</a>
          <a href="#help-shortcuts">Keyboard shortcuts</a>
          <a href="#help-clipboard">Copy and paste</a>
          <a href="#help-troubleshooting">Connection problems</a>
          <a href="#help-privacy">Privacy</a>
          <a href="#help-hosting">Self-hosting</a>
        </nav>

        <section id="help-connect">
          <h3>Connect to a server</h3>
          <p>
            Enter the server hostname or IP address, SSH port, username, and password. Select
            Connect to server. Port 22 is the usual SSH port.
          </p>
          <p>
            You can connect without setting up saved hosts. A password you type is kept for this
            connection only.
          </p>
        </section>
        <section id="help-host-key">
          <h3>Check the host key</h3>
          <p>
            On your first connection, compare the SHA-256 fingerprint with one from the server
            administrator or server console. Select Trust and connect only if they match.
          </p>
          <p>
            If the key changes later, stop and check why. A server reinstall can change a key, but
            an intercepted connection can too. Compare the new fingerprint through a trusted route
            before selecting Replace key and connect.
          </p>
        </section>
        <section id="help-saved-hosts">
          <h3>Save a host</h3>
          <p>
            Create an address book with a master password, then select Save current host. Choose
            whether to save the host, username, or password. Saved entries are encrypted in this
            browser.
          </p>
          <p>
            Unlock saved hosts once per page load. There is no master password recovery. If you
            forget it, you must delete the address book and start again.
          </p>
        </section>
        <section id="help-terminal">
          <h3>Use the terminal</h3>
          <p>
            On a touch screen, the key bar supplies Esc, Tab, arrows, and other shell keys. Tap Ctrl
            or Alt once for the next key, twice to lock it, and a third time to turn it off.
          </p>
          <p>
            Swipe right for Tab or left for Esc. Flick up or down near the prompt for command
            history. Drag with two fingers to scroll output. Long press and drag to select text.
          </p>
          <p>Use Appearance to change the terminal font, size, or color scheme.</p>
        </section>
        <section id="help-shortcuts">
          <h3>Keyboard shortcuts</h3>
          <p>
            With a hardware keyboard, use Esc, Tab, arrow keys, and shell shortcuts as usual. Ctrl+C
            interrupts a command, Ctrl+D sends end of input, and Ctrl+Z suspends a job. Ctrl+R
            searches command history when the remote shell supports it.
          </p>
        </section>
        <section id="help-clipboard">
          <h3>Copy and paste</h3>
          <p>
            On iPhone, iPad, or Android, long press and drag to select terminal text. Open Clipboard
            and select Copy selection. If the browser blocks copying, select the text shown in the
            menu and use the device Copy action.
          </p>
          <p>
            To paste, open Clipboard and use Paste from clipboard. If browser access is blocked,
            paste into the box and select Paste text. On desktop, you can also select terminal text
            and use your browser's copy and paste shortcuts.
          </p>
        </section>
        <section id="help-troubleshooting">
          <h3>Fix a connection problem</h3>
          <p>
            If the relay cannot be reached, check that localssh is running and that you opened the
            right address. If you run the relay, check its logs for a refused origin, host, or port.
          </p>
          <p>
            If the SSH login fails, check the host, port, username, and password. Ask the server
            administrator whether the server accepts password login. If a host key changed, verify
            the new fingerprint before continuing.
          </p>
        </section>
        <section id="help-privacy">
          <h3>How your connection is protected</h3>
          <p>
            The SSH engine runs in your browser. The relay connects your browser to the server
            because browsers cannot open raw TCP connections. It carries encrypted SSH traffic and
            cannot read your password or terminal output.
          </p>
          <p>
            Saved hosts and optional saved passwords are encrypted under your master password in
            this browser. The SSH server receives your login credentials through the encrypted SSH
            connection. localssh has no application account or credential server. This design has
            not been independently audited.
          </p>
        </section>
        <section id="help-hosting">
          <h3>Run localssh yourself</h3>
          <p>
            Docker Compose serves the app and relay through one web port. The default address is
            localhost:9080. For LAN access, set a LAN bind address and restrict the target hosts and
            ports in the relay configuration.
          </p>
          <p>
            Do not expose the HTTP service directly to the internet. For internet access, use an
            authenticated HTTPS reverse proxy and a restrictive target allowlist.
          </p>
          <a
            href="https://github.com/bradsec/localssh#install-with-docker"
            target="_blank"
            rel="noreferrer noopener"
          >
            Read setup and update instructions
          </a>
        </section>
      </div>
    </details>
  );
}
