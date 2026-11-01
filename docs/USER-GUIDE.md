# User guide

The app's **Help** button opens these topics in a searchable dialog. Help also
works before connecting.

## Connect and verify

1. Enter a server hostname or IP address, SSH port, and username.
2. Choose **Password** or **Private key**. For a key, select a file or paste it;
   enter its passphrase if needed. The key input limit is 64 KiB.
3. Select **Connect to server**. On first use, compare the SHA-256 host-key
   fingerprint with one obtained from the administrator or server console.
   Select **Trust and connect** only when it matches.
4. If the host key later changes, verify the new fingerprint through a trusted
   route before selecting **Replace key and connect**.

OpenSSH Ed25519, ECDSA, and RSA keys, unencrypted PKCS#8 PEM, and legacy RSA
or EC PEM keys are supported. OpenSSH and legacy PEM keys may use a passphrase.
Encrypted PKCS#8 PEM is unsupported. A selected key and passphrase are used for
that connection only and are not saved in the address book.

## Saved hosts

1. Create an address book with a master password.
2. Select **Save current host** and choose whether to save the host, username,
   or password.
3. Unlock the address book once per page load to reuse saved entries.

The address book is encrypted in this browser profile. There is no master
password recovery. If you forget it, delete the address book and start again.

## Terminals and files

Select **New terminal** to connect without closing open shells. Select a tab
to switch shells; closing a tab disconnects only that shell. A tab whose
connection dropped shows an unplugged icon and **Disconnected**. Closing the page
disconnects all sessions. Ctrl+Alt+Shift+Left and Ctrl+Alt+Shift+Right switch
tabs with a hardware keyboard.

Select **Files** in a connected tab to browse that server over SFTP. Below 1024px
wide, Files, Disconnect, and Clipboard are under **Actions** in the toolbar.
Use a breadcrumb to open an earlier folder, **Up** to open its parent, or
**Go to path** to enter a **Remote path**. Use **Refresh** to reload the folder.
Select a column heading to sort by name, size, modified time, or permissions;
folders stay first. Select a row with one click or Enter, and open a folder
with a double-click or Enter. Arrow keys move the selection; Home and End jump
to the first and last item, and Page Up and Page Down move a screen at a time.
Backspace or Alt+Up opens the parent. Below 720px, the list shows name and size only.

Type in **Filter files** to show only names that contain the text, ignoring
case. The count beside the filter, for example `12 of 2,000 items`, updates as
you type. Clear the filter to see the whole folder again with the same item
selected. Filtering resets when you open another folder. The breadcrumbs,
toolbar, filter, and column headings stay put; only the list scrolls. Rows are
32px with a mouse or trackpad and 44px on touch screens, so a long folder
shows more items at once on desktop.

Choose **Upload** or drop a local file onto Files. localssh asks before
replacing an existing name. Choose the download action on a remote file to save
it. **Cancel** stops the current transfer; **Close files** leaves the terminal
connected and asks first when a transfer is running. On desktop, **Expand**
gives Files the full session area without ending the terminal session. Each
tab keeps its own expanded state until that tab closes.

Transfer results and other short outcomes appear near the top of the screen.
Hover or focus a notification to pause its timer, or choose **Dismiss** to
close it. A folder with more than 10,000 entries keeps a notice above the
list; Files shows the first 10,000.

Downloads use browser file storage when available. The fallback without that
storage has a 16 MiB limit. On iPhone or iPad, use the browser's download,
Share, or Save to Files action. **Save download** remains available for 10
minutes, or until the next transfer, closing Files, or leaving the page.

## Touch and clipboard

The touch key bar supplies Esc, Tab, arrows, and shell keys. Tap Ctrl or Alt
once for the next key, twice to lock it, and a third time to turn it off.
Swipe right for Tab, left for Esc, flick vertically near the prompt for command
history, and drag with two fingers to scroll output. Long press and drag to
select terminal text. Use **Appearance** to change font, size, or color scheme.

Open **Clipboard** to copy the selection or paste into the terminal. If the
browser blocks clipboard access, use the text field and the device's Copy or
Paste action. Browsers restrict the Clipboard API on LAN HTTP. Use trusted
HTTPS for LAN access; [README setup](../README.md#access-from-a-local-network)
explains why.

## Connection problems and privacy

If a connection fails, check the host, port, username, and authentication
method. Check the relay log for a refused origin, target host, port, or session
limit. If a connected terminal stops after a network loss, reconnect when the
network returns. Use **Help** in the app for the error's matching topic and
technical details.

For the combined image under your own domain, set `PUBLIC_HOSTS` to the page
hostname. The default same-origin check limits accepted page hosts because
matching Origin and Host alone permits DNS rebinding.

The SSH engine runs in the browser. The relay forwards encrypted SSH bytes;
the target host and port are visible to it. The SSH server receives credentials
through SSH. localssh has no application account or credential server. The
service has not been independently audited. See the [security model](../README.md#security-model)
and [self-hosting setup](../README.md#install-with-docker).
