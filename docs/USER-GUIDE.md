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
to switch shells; closing a tab disconnects only that shell. Closing the page
disconnects all sessions. Ctrl+Alt+Shift+Left and Ctrl+Alt+Shift+Right switch
tabs with a hardware keyboard.

Select **Files** in a connected tab to browse that server over SFTP. Enter a
**Remote path**, open a folder or link to a folder, or select **Up**. Choose
**Upload file** to send one file. localssh asks before replacing an existing
name. Choose **Download file** beside a remote file to save it. **Cancel** stops
the current transfer; **Close files** leaves the terminal connected and asks
first when a transfer is running.

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

The SSH engine runs in the browser. The relay forwards encrypted SSH bytes;
the target host and port are visible to it. The SSH server receives credentials
through SSH. localssh has no application account or credential server. The
service has not been independently audited. See the [security model](../README.md#security-model)
and [self-hosting setup](../README.md#install-with-docker).
