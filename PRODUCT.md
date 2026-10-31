# localssh product content

## Product and audience

localssh is a self-hosted SSH client that runs in a browser. Its documented audience is people on a local network who need to open remote shells from their own devices. Broader audience, traffic source, and user research are TBD.

Users need to connect to the right server, verify its identity, work in a terminal, and recover from connection or storage problems. The connect screen drives a verified SSH connection. The terminal drives shell work. The address book supports repeat connections. Help supports setup, verification, terminal use, and recovery.

## Voice and terms

Use direct, calm, technical language. Name the action and its result. Explain security decisions without claiming perfect protection. Keep errors specific and give the next step when known. Use sentence case.

Use **server** for the SSH destination in general guidance, **host** for the address field and saved-host entries, **relay** for the WebSocket-to-TCP bridge, **host key** and **SHA-256 fingerprint** for server identity, **address book** for the encrypted collection, and **master password** for its local encryption key. Product name stays **localssh**.

## Constraints and truth

The browser cannot open raw TCP. The Go SSH engine runs as WebAssembly in the page. The relay carries encrypted SSH traffic and cannot read passwords or terminal contents. A connection sends the target host and port to the relay. The SSH server receives login credentials through the encrypted SSH connection. There is no application account or credential server.

Saved hosts and optional saved passwords are encrypted under a master password in the browser profile. A forgotten master password cannot be recovered. Known host keys are remembered in that browser. The service has not been independently audited. The documented deployment is a firewalled LAN; direct public HTTP exposure is not recommended.

K1 private-key authentication supports OpenSSH Ed25519, ECDSA, and RSA keys (with or without a passphrase), unencrypted PKCS#8 PEM, and legacy RSA or EC PEM (with or without a passphrase). Encrypted PKCS#8 PEM is unsupported. T1 multiple live terminal tabs keep separate SSH sessions in one page. F1 SFTP browse, upload, and download runs on each tab's existing SSH connection. Downloads use browser file storage where available, with a 16 MiB memory fallback.

## Material inventory

Real: README product and deployment behavior; frontend interface, in-app help,
and error paths; implemented K1 key auth, T1 tabs, and F1 SFTP; design review
help-entry finding D-05.

Sample: none. Absent: customer quotes, logos, adoption numbers, security audit,
representative user research, measured device memory limit, and launch terms.

## Language and legal

Current interface language is English. Market and localization plan are TBD. No regulated offer, price, trial, guarantee, or cancellation terms were supplied. Keep product name and code identifiers unchanged.
