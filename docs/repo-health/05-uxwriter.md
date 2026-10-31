# Repository health: UX writing

Reviewed 2026-10-31 on `review/2026-10-31`. The worktree was clean at entry. The lead will commit these changes.

## Content read

Writing: in-app help and interface copy for LAN SSH users, driving a verified connection and recoverable terminal work, in a direct, calm, technical voice.

Product: localssh is a self-hosted browser SSH client. Audience: people using their own browsers to reach SSH servers on a local network. Main action: connect to the intended server after checking its host key. Source: `README.md`, `docs/repo-health/04-productdesignreviewengineer.md`, and `docs/new-feature/01-featurescout.md`.

Real | Go SSH engine runs in the page; relay carries encrypted SSH traffic; browser cannot open raw TCP; no application account or credential server; SHA-256 host-key comparison and local known hosts; encrypted optional address book; touch key bar, gestures, clipboard fallback; Docker Compose LAN deployment; K1, F1, T1 approved future specs.

Sample | None. No invented host names, rates, people, or outcomes appear in this deck.

Absent | Independent security audit, customers, testimonials, usage numbers, supported K1 key-format list, F1 download fallback limit, T1 tab limit, representative user research.

Market and language | English interface. Geography and localization plan TBD. No price, trial, guarantee, cancellation, or regulated offer supplied. No conversion traffic source supplied.

## Help argument

Connect with four known details | Existing connect form and README connection flow | Connect to a server.

Verify server identity before trust | Existing fingerprint prompt and known-host storage | Check the host key.

Save repeat connections locally | Encrypted address book in README and code | Save a host.

Control the shell across input devices | Key bar, gestures, settings in README and code | Use the terminal.

Use familiar shell keys | Key bar mapping and terminal input in code | Keyboard shortcuts.

Copy and paste have a manual route | Clipboard menu and fallback in README and code | Copy and paste.

Diagnose the failing layer | README relay refusal guidance and connection form | Fix a connection problem.

Relay privacy has limits | README security model and architecture | How your connection is protected.

LAN deployment needs boundaries | README Docker and allowlist instructions | Run localssh yourself.

## Copy deck: live Help menu

Help toolbar label | Help

Help panel heading | Help with localssh

Help topic link | Connect

Help topic link | Host keys

Help topic link | Saved hosts

Help topic link | Terminal

Help topic link | Keyboard shortcuts

Help topic link | Copy and paste

Help topic link | Connection problems

Help topic link | Privacy

Help topic link | Self-hosting

Help, connect heading | Connect to a server

Help, connect paragraph 1 | Enter the server hostname or IP address, SSH port, username, and password. Select Connect to server. Port 22 is the usual SSH port.

Help, connect paragraph 2 | You can connect without setting up saved hosts. A password you type is kept for this connection only.

Help, host-key heading | Check the host key

Help, host-key paragraph 1 | On your first connection, compare the SHA-256 fingerprint with one from the server administrator or server console. Select Trust and connect only if they match.

Help, host-key paragraph 2 | If the key changes later, stop and check why. A server reinstall can change a key, but an intercepted connection can too. Compare the new fingerprint through a trusted route before selecting Replace key and connect.

Help, saved-hosts heading | Save a host

Help, saved-hosts paragraph 1 | Create an address book with a master password, then select Save current host. Choose whether to save the host, username, or password. Saved entries are encrypted in this browser.

Help, saved-hosts paragraph 2 | Unlock saved hosts once per page load. There is no master password recovery. If you forget it, you must delete the address book and start again.

Help, terminal heading | Use the terminal

Help, terminal paragraph 1 | On a touch screen, the key bar supplies Esc, Tab, arrows, and other shell keys. Tap Ctrl or Alt once for the next key, twice to lock it, and a third time to turn it off.

Help, terminal paragraph 2 | Swipe right for Tab or left for Esc. Flick up or down near the prompt for command history. Drag with two fingers to scroll output. Long press and drag to select text.

Help, terminal paragraph 3 | Use Appearance to change the terminal font, size, or color scheme.

Help, shortcuts heading | Keyboard shortcuts

Help, shortcuts paragraph | With a hardware keyboard, use Esc, Tab, arrow keys, and shell shortcuts as usual. Ctrl+C interrupts a command, Ctrl+D sends end of input, and Ctrl+Z suspends a job. Ctrl+R searches command history when the remote shell supports it.

Help, clipboard heading | Copy and paste

Help, clipboard paragraph 1 | On iPhone, iPad, or Android, long press and drag to select terminal text. Open Clipboard and select Copy selection. If the browser blocks copying, select the text shown in the menu and use the device Copy action.

Help, clipboard paragraph 2 | To paste, open Clipboard and use Paste from clipboard. If browser access is blocked, paste into the box and select Paste text. On desktop, you can also select terminal text and use your browser's copy and paste shortcuts.

Help, troubleshooting heading | Fix a connection problem

Help, troubleshooting paragraph 1 | If the relay cannot be reached, check that localssh is running and that you opened the right address. If you run the relay, check its logs for a refused origin, host, or port.

Help, troubleshooting paragraph 2 | If the SSH login fails, check the host, port, username, and password. Ask the server administrator whether the server accepts password login. If a host key changed, verify the new fingerprint before continuing.

Help, privacy heading | How your connection is protected

Help, privacy paragraph 1 | The SSH engine runs in your browser. The relay connects your browser to the server because browsers cannot open raw TCP connections. It carries encrypted SSH traffic and cannot read your password or terminal output.

Help, privacy paragraph 2 | Saved hosts and optional saved passwords are encrypted under your master password in this browser. The SSH server receives your login credentials through the encrypted SSH connection. localssh has no application account or credential server. This design has not been independently audited.

Help, hosting heading | Run localssh yourself

Help, hosting paragraph 1 | Docker Compose serves the app and relay through one web port. The default address is localhost:9080. For LAN access, set a LAN bind address and restrict the target hosts and ports in the relay configuration.

Help, hosting paragraph 2 | Do not expose the HTTP service directly to the internet. For internet access, use an authenticated HTTPS reverse proxy and a restrictive target allowlist.

Help, hosting link | Read setup and update instructions

## First-run onboarding and current interface

Connect intro kicker | New session

Connect intro heading | Connect to your server

Connect intro support | Open a secure SSH terminal without sending credentials to an application server.

Connect form heading | Connection details

Connect form labels | Host; Port; Username; Password

Connect form primary action | Connect to server

Connect form loading action | Connecting to server...

First connection heading | Verify host key

First connection instruction | Compare this SHA-256 fingerprint with one obtained from the server administrator or console.

First connection safe action | Cancel

First connection confirm action | Trust and connect

Changed key heading | Host key changed

Changed key warning | The key differs from the one previously trusted. Check whether the server was reinstalled or the connection is being intercepted.

Changed key safe action | Cancel (recommended)

Changed key confirm action | Replace key and connect

First-run model | No extra tour. The connect form, optional saved hosts, host-key prompt, and Help menu teach the first task in context.

## Interface states and actions

Connection status, idle | Offline

Connection status, loading | Connecting

Connection status, success | Connected

Connected toolbar action | Disconnect

Connected input error | Input was not sent: {reason}

Connect error, known-host storage | Could not load trusted host keys. Check browser storage and try connecting again.

Connect error, relay unreachable | Could not reach the relay. Check the app address and relay logs, then try again.

Connect error, SSH authentication | SSH login failed. Check the username and password, then try again.

Connect error, engine load | Could not load the SSH engine. Reload the page and try again.

Connect error, unknown | Connection failed: {reason}. Check the connection details and try again.

Saved hosts, unavailable heading | Saved hosts are unavailable

Saved hosts, unavailable instruction | Allow browser storage to save hosts, or connect without saving.

Saved hosts, locked heading | Saved hosts are locked

Saved hosts, locked instruction | Enter your master password to view them.

Saved hosts, absent status | Optional

Saved hosts, locked status | Locked

Saved hosts, empty heading | No saved hosts yet

Saved hosts, empty instruction | Save the current connection to find it here next time.

Saved hosts, empty action | Save current host

Saved hosts, create action | Create address book

Saved hosts, create loading | Creating address book...

Saved hosts, unlock action | Unlock saved hosts

Saved hosts, unlock loading | Unlocking saved hosts...

Saved hosts, save action | Save host

Saved hosts, save loading | Saving host...

Saved hosts, lock action | Lock

Saved hosts, change password action | Change master password

Saved hosts, change password loading | Changing master password...

Saved hosts, create mismatch | Master passwords do not match. Enter the same password in both fields.

Saved hosts, change mismatch | New master passwords do not match. Enter the same password in both fields.

Saved hosts, wrong password | Master password is incorrect. Try again or delete the saved hosts to start over.

Saved hosts, locked action error | Saved hosts are locked. Unlock them with your master password and try again.

Saved hosts, storage full | Browser storage is full. Free space in this browser, then unlock and try again.

Saved hosts, storage unavailable | Browser storage is unavailable. Allow storage, then unlock and try again.

Saved hosts, changed in another tab | The vault changed in another tab. Reload this page and unlock again before saving.

Saved hosts, corrupt or unsupported | The saved vault is corrupt or was created by an unsupported version. Do not delete it if you need the saved entries.

Saved hosts, destructive reset text | Saved hosts cannot be recovered without the master password. Deleting the vault removes every saved host from this browser.

Saved hosts, destructive reset label | Type DELETE to confirm

Saved hosts, destructive reset action | Delete the vault

Saved host delete confirmation | Remove {nickname} from saved hosts?

Saved host delete action | Delete {nickname}

Saved host delete cancel | Cancel

Clipboard, no selection | No terminal text is selected. Select text, then try Copy selection.

Clipboard, copy success | Copied the selection.

Clipboard, copy blocked | The browser blocked the copy. Select the text below and use your device's Copy action.

Clipboard, direct paste blocked | The browser could not read the clipboard. Paste into the box below instead.

Clipboard, empty clipboard | The clipboard is empty.

Clipboard, paste success | Pasted into the session.

Clipboard, paste field label | Paste here

Clipboard, paste field action | Paste text

Clipboard, direct paste action | Paste from clipboard

Clipboard, copy action | Copy selection

Clipboard, manual fallback label | Selection to copy manually

Terminal settings loading | No visible loading state: font loading occurs without blocking the existing terminal.

Terminal settings labels | Appearance; Font size; Font family; Color scheme

Touch key bar labels | Show keyboard; Hide keyboard; Ctrl; Alt; Esc; Tab; Enter; Backspace; Home; End; arrows; Control C, interrupt; Control D, end of input; Control Z, suspend

## Approved future-feature strings, not live

K1, connect method label | Authentication method

K1, method choice | Password

K1, method choice | Private key

K1, key field label | Private-key file

K1, passphrase field label | Key passphrase

K1, key field hint | Select a private key from this device. localssh does not save the key or passphrase.

K1, invalid key error | This private key could not be read. Select a supported key file and try again.

K1, unsupported format error | This key format is not supported. Select a supported private key format. Supported formats: TBD.

K1, wrong passphrase error | The key passphrase did not unlock this key. Check the passphrase and try again.

K1, loading | Reading private key...

K1, connection action | Connect to server

F1, view label | Files

F1, path label | Remote path

F1, empty directory | No files in this directory. Choose another path or upload a file.

F1, directory loading | Loading files...

F1, upload action | Upload file

F1, download action | Download file

F1, upload progress | Uploading {filename}: {percent}%

F1, download progress | Downloading {filename}: {percent}%

F1, upload success | Uploaded {filename}.

F1, download success | Downloaded {filename}.

F1, permission error | Cannot open {path}: permission denied. Check access on the server.

F1, transfer error | Transfer of {filename} stopped: {reason}. Try again after checking the connection.

F1, replace confirmation | Replace {filename} on the server? The existing file will be overwritten.

F1, replace action | Replace file

F1, replace cancel | Cancel

F1, disconnect during transfer | Transfer stopped because the SSH connection closed.

T1, new action | New terminal

T1, tab accessible label | {host}, {status}

T1, close tab action | Close {host} terminal

T1, empty state | No open terminals. Connect to a server to start one.

T1, empty action | Connect to server

T1, tab connecting | Connecting to {host}...

T1, tab connected | Connected to {host}

T1, tab closed | {host} disconnected. Other terminals are still open.

T1, tab limit | Cannot open another terminal. Close one and try again. Limit: TBD.

T1, host-key prompt target | Check the host key for {host}.

## Review findings

U-01 | CRITICAL | `frontend/src/components/ConnectDialog.tsx:105` | “never sent anywhere” misstates password delivery to the SSH server | “The SSH server receives your password through the encrypted connection. The relay cannot read it.” | HIGH, README architecture and code.

U-02 | CRITICAL | `frontend/src/components/About.tsx:37` | “saved hosts ... never sent anywhere” misstates target host delivery to the relay | “Saved hosts are encrypted in this browser under a master password.” | HIGH, relay connect frame and README.

U-03 | HIGH | `frontend/src/components/ClipboardMenu.tsx:82` | Blocked clipboard read did not name the failure | “The browser could not read the clipboard. Paste into the box below instead.” | HIGH, clipboard fallback behavior.

U-04 | HIGH | `frontend/src/components/ConnectDialog.tsx:99` | Storage unavailable state gave no next step | “Allow browser storage to save hosts, or connect without saving.” | HIGH, optional address book behavior.

U-05 | HIGH | `frontend/src/App.tsx:275` | No in-app task help | Added Help toolbar menu with nine task sections | HIGH, design review D-05 and README.

U-06 | MEDIUM | `frontend/src/components/ConnectDialog.tsx:157`, `frontend/src/components/SavedHosts.tsx`, `frontend/src/components/SavedHostEditor.tsx` | Primary action labels were generic across different intents | Named connection, address-book, unlock, save, and password-change actions | HIGH, existing flows.

U-07 | MEDIUM | `frontend/src/components/SavedHosts.tsx:122,407`, `frontend/src/vault/vaultEngine.ts:33,40`, `frontend/src/vault/vaultStore.ts:16,23` | Password mismatch and storage errors lacked a next step | Added the corrective action to each message | HIGH, existing recovery paths.

U-08 | LOW | `frontend/src/components/SavedHosts.tsx:253`, `frontend/src/components/ClipboardMenu.tsx:76,195` | Empty-state and paste action wording left the next action vague | “Save the current connection...” and “Paste text” | MED, existing UI behavior.

U-09 | HIGH | `frontend/src/App.tsx:200` | Raw engine or relay errors can surface without a task-specific recovery step | Proposed connection error variants in the deck; implementation needs typed failure mapping across Go and frontend | MED, source inspection. Not applied in this writing pass.

U-10 | MEDIUM | `frontend/src/components/Help.tsx` | Help entry exists in toolbar but errors and host-key prompt lack contextual links | Add links to the relevant Help topic when a shared Help navigation mechanism is available | MED, design review D-05. Not applied.

No change needed | Existing Host key changed warning names the possible server reinstall and interception, shows both fingerprints, and offers a safe cancel action | HIGH, source inspection.

## Missing proof and client inputs

1. Independent audit result, if one exists. Do not imply an audit from the design.
2. K1 supported private-key formats after parser validation.
3. F1 large-download fallback and browser limits after testing.
4. T1 simultaneous-tab cap after a device memory check.
5. User research on first-connection trust decisions and mobile copy behavior.

## Localization and verification notes

The interface is English only. `hostPort`, `nickname`, `filename`, `path`, `reason`, `percent`, and tab `status` need named variables with translator context. Existing ```${count} ${count === 1 ? "host" : "hosts"}``` needs a plural-message format before localization. Avoid concatenating the future strings. Headings were budgeted near 32 characters; “How your connection is protected” and “Fix a connection problem” need a narrow-width wrap check. Translators need room for expansion in the toolbar, key bar, and file actions.

WCAG 2.2 guidance, accessed 2026-10-31: [Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification) requires the affected item and error in text; [Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) asks for known corrective steps; [Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions) covers task cues. These support U-04 and U-07. [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/), accessed 2026-10-31, describes secure-context limits and user-triggered paste behavior; it supports the manual fallback in U-03. These are writing references, not a claim of full WCAG conformance or current physical-device testing.

SUSPECTED | New users may need a direct Help link inside the host-key prompt. Observe first-time users deciding whether to trust a key.

SUSPECTED | Mobile users may expect native selection handles. Test physical iPhone and Android devices with a live session.

PRODUCT.md | Added at repository root with audience, jobs, voice, terminology, constraints, and material inventory. Product truth only; unknown facts marked TBD.

## ID to files changed

U-01 | `frontend/src/components/ConnectDialog.tsx`.

U-02 | `frontend/src/components/About.tsx`.

U-03 | `frontend/src/components/ClipboardMenu.tsx`.

U-04 | `frontend/src/components/ConnectDialog.tsx`.

U-05 | `frontend/src/components/Help.tsx`, `frontend/src/components/Help.test.tsx`, `frontend/src/App.tsx`, `frontend/src/app.css`, `frontend/e2e/connect-flow.spec.ts`, `README.md`.

U-06 | `frontend/src/components/ConnectDialog.tsx`, `frontend/src/components/SavedHosts.tsx`, `frontend/src/components/SavedHostEditor.tsx`.

U-07 | `frontend/src/components/SavedHosts.tsx`, `frontend/src/vault/vaultEngine.ts`, `frontend/src/vault/vaultStore.ts`.

U-08 | `frontend/src/components/SavedHosts.tsx`, `frontend/src/components/ClipboardMenu.tsx`.

Copy system | `PRODUCT.md`, this report, and affected frontend unit and browser test assertions.

## Checks

Engine | `Go test: 55 passed in 4 packages`; WASM vet exit 0; `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`.

Relay | `found 0 vulnerabilities`; `Test Files  4 passed (4)`; `Tests  38 passed (38)`; lint and build exit 0; `All matched files use the correct format.`

Frontend | `found 0 vulnerabilities`; `Test Files  27 passed (27)`; `Tests  245 passed (245)`; lint exit 0; `TypeScript: No errors found`; `All matched files use the correct format.`; `✓ built in 1.66s`; `13 passed (6.6s)` in Playwright.

Rendered Help | Chromium Playwright opened Help at 320×700, 390×844, and 1440×900. At all three widths, the panel stayed inside the viewport and its content had no horizontal overflow.

Diff | `git diff --check` exit 0. No commit, branch, tag, push, or PR was created.

Docker | One `docker compose build` attempt stopped before image build: `failed to update builder last activity time: open /home/mark/.docker/buildx/activity/.tmp-default1571801046: read-only file system`. Both Docker images remain unverified for the lead.

Not checked | Physical iOS and Android copy and paste, keyboard transitions, assistive technology traversal, localized text expansion, and production relay logs. Vite still reports a JavaScript chunk above 500 kB.
