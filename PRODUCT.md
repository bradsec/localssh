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

K1 private-key authentication, F1 SFTP file movement, and T1 multiple live terminal tabs are approved future features, not current capabilities. Their strings must remain marked by feature ID until shipped. Supported private-key formats, large-download fallback, and tab limit are TBD.

## Material inventory

Real: README product and deployment behavior; existing frontend interface and error paths; design review help-entry finding D-05; approved K1, F1, and T1 spec stubs.

Sample: none. Absent: customer quotes, logos, adoption numbers, security audit, representative user research, supported key-format list, measured device memory limit, and launch terms.

## Language and legal

Current interface language is English. Market and localization plan are TBD. No regulated offer, price, trial, guarantee, or cancellation terms were supplied. Keep product name and code identifiers unchanged.
