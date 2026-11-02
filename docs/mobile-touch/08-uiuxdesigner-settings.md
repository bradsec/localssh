# Settings menu: design amendment

Designing: a Settings dialog for browser SSH users who adjust terminal type and background keep-alive, vibe calm and exact, on phone and desktop, design system `DESIGN.md` (locked; delta below). Mode: Operate. Redesign mode: targeted refinement.

Dials: VARIANCE 2/10 (conventional form inside the existing chrome). DENSITY 6/10 (fewer, larger rows than the session chrome; help text needs room). MOTION 1/10 (same as `02-uiuxdesigner.md` D-03).

Material, real: `TerminalSettings.tsx` (Appearance disclosure: font size 8 to 32, family, color scheme, gesture legend), `settingsStore.ts`, `ActionsMenu.tsx`, Help dialog pattern (`Help.tsx:163`), v2 `ready` frame with `graceMs` (`relay/src/protocol.ts:73-75`, currently rejects `graceMs > 120000`), architecture D2/D4/F2/F5. Absent: a way for the page to learn the relay cap before connecting, a client-requested grace in the v2 `connect` frame, user testing.

Idea: the active target, the fixed point of `DESIGN.md`, appears in the Terminal preview prompt, so type changes are judged against the session they affect.

## Decisions

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
S-01 | Replace the `Appearance` disclosure with a `Settings` button that opens a modal dialog. `TerminalSettings.tsx` is replaced, not moved: its three fields move into the dialog's Terminal section; the `<details>` popover is removed. | HIGH | The popover cannot hold two sections and risk text inside 320px; Help already uses the dialog/sheet pattern.
S-02 | Same toolbar slot as Appearance on every surface: desktop session toolbar, connect toolbar, and phone/tablet `Actions` menu. Order: Files, Disconnect, Clipboard, Settings, Help, About. Icon lucide `Settings`. | HIGH | Keep-alive must be settable before connecting, and Appearance already renders on the connect screen (`App.tsx:550`). Renaming a frozen label is authorized by the user's request for a Settings menu.
S-03 | Desktop (720px and up): centered dialog capped at 560px, max height 100dvh minus 48px, body scrolls. Phone (below 720px): full-height sheet inside the visual viewport, sticky header with title and Close, bottom safe-area padding. | HIGH | Matches Help and host-key rules in `DESIGN.md` Layout.
S-04 | Opened from `Actions`: the Actions panel closes, Settings opens; closing Settings returns focus to the `Actions` button. From the desktop toolbar, focus returns to `Settings`. | MED | `DESIGN.md`: menus and dialogs restore focus to their trigger; the Actions trigger is the visible one after it closes.
S-05 | No Save or Cancel. Each change applies and persists on change, as Appearance does today. A polite status line confirms. | HIGH | Current behavior; a commit step adds a second action to a preference form.
S-06 | Terminal changes apply live to all open terminals. Keep-alive applies to terminals opened after the change; open terminals keep the value they connected with. | MED | `ready` carries `graceMs` per session at connect. Changing it mid-session needs a protocol message nobody has designed; see Q-02.
S-07 | Keep-alive is a native `select`, like the other fields. The user's choice persists even when the server caps it; the status line states the effective value. | HIGH | `TerminalSettings.tsx:12-14`: select is a wheel on iOS. A remembered choice still matters on another relay.
S-08 | Gesture legend leaves Settings; it is help content. Move it to the Help topic at `helpTopics.ts:62`, whose text is stale (still describes swipe Tab/Esc, removed on phone by `DESIGN.md` Phone touch). | MED | Settings holds settings only. Help copy change needs the writer's pass.
S-09 | Terminal section shows a 2-line preview in the selected family, size, line height, and theme, using the active target as prompt (`user@host` when none). `aria-hidden`; it duplicates the field values. | MED | On phone the sheet covers the terminal, so a live change is otherwise invisible until close.

## Layout

Desktop dialog, and phone sheet (same order, full width, 16px side padding):

```text
+--------------------------------------------------------+
| Settings                                      [ Close ]|  sticky on phone
|--------------------------------------------------------|
| Terminal                                               |  section 18/24 600
|   Font family                                          |  label 14/20, 8px gap
|   [ IBM Plex Mono                                 v ]  |  44px, 16px text
|   Font size                                            |
|   [ 14 px                                         v ]  |
|   Line height                                          |
|   [ 1.15                                          v ]  |  1.00 to 2.00, step 0.05
|   Color scheme                                         |
|   [ <theme name>                                  v ]  |
|   +--------------------------------------------------+ |
|   | mark@pi.lan:~$ ls                                | |  preview, theme bg,
|   | notes  scripts                                   | |  radius 6, no shadow
|   +--------------------------------------------------+ |
|                                                        |  24px between sections
| Session                                                |
|   Keep session alive in background                     |
|   [ 2 min                                         v ]  |
|   <cap status line>                       13/18 muted  |  aria-describedby
|   <applies-to line, only with open terminals>          |
|   <risk help paragraph>                   13/18 muted  |
|                                                        |
|   <save status line>                  live region      |
+--------------------------------------------------------+
```

Line-height option labels show two decimals (`1.00`, `1.15`, `2.00`). Section headings are `h3` under the dialog `h2`.

## Keep-alive states

Effective value = min(choice, cap). Format: under 60 min `N min`; whole hours `1 hour`, `N hours`; otherwise `1 hr 30 min`; under 1 min `N sec`.

ID | STATE | TRIGGER | CAP STATUS LINE
--- | --- | --- | ---
K-01 | Loading | Cap request in flight | `Checking this server's limit...`
K-02 | Within cap | choice <= cap | `This server allows up to <cap>.`
K-03 | No server limit | cap unlimited | `This server sets no limit.`
K-04 | Limited | choice > cap | `This server limits this to <cap>. Your terminals stay open for <cap>.` Select keeps the user's choice.
K-05 | Unsupported | relay is v1 or resume disabled | `This server does not keep sessions in the background. Terminals close when the connection drops.` Select stays enabled; the choice is kept for other servers.
K-06 | Unknown | cap request failed | `Could not check this server's limit. It applies when you connect.`
K-07 | Off chosen | choice Off, any cap | `Terminals close when the connection drops.` (replaces K-02 to K-04)

Applies-to line, shown only while one or more terminals are open: `Applies to terminals you open next. Open terminals keep the time they connected with.`

Save status, after any change, polite live region, cleared on next change: `Saved on this device.` If storage fails: `Could not save on this device. This setting lasts until you close the page.` (current `saveTerminalSettings` swallows the failure; it must return a result for this state).

## Interface strings (draft for writer review)

- Button and dialog title: `Settings`. Close: `Close`.
- Sections: `Terminal`, `Session`.
- Fields: `Font family`, `Font size`, `Line height`, `Color scheme`, `Keep session alive in background`.
- Keep-alive options: `Off`, `2 min`, `5 min`, `10 min`, `15 min`, `1 hour`, `Until I disconnect`. Default `2 min`.
- Risk help (always visible under the Session control):
  `When you switch apps or lock your phone, the server keeps your SSH login open for this long so you can return to it. While it is open, anyone who can use this browser can use that terminal without signing in. Choose a shorter time on a shared device.`
  `If your phone closes this page, the session ends whatever you choose here. For work that must keep running, use tmux or screen on the server.`
- Help topic link at the end of Session: `About background sessions` (opens Help at the relevant topic; topic text TBD by writer).

## Interaction and motion

- Dialog entrance: 160ms fade only, instant under reduced motion. Communicates a modal layer.
- Field change: terminals refit on change with no animation (`DESIGN.md` Motion). The preview updates in place.
- Escape or Close dismisses; backdrop click dismisses on desktop. On phone the sheet has no backdrop to tap.

## Responsive

- 320px: every field is full width; the risk text wraps; the sheet scrolls under the sticky header. No horizontal scroll.
- Landscape phone: same sheet; header stays sticky so Close is reachable.
- Tablet 720 to 1023px: desktop dialog, opened from `Actions`.

## Accessibility

- Dialog: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title, focus moves to the title on open (Help pattern), focus trapped, restored per S-04.
- Each select has a persistent visible label. The keep-alive select has `aria-describedby` pointing at the cap status line, applies-to line, and risk help, so a screen reader hears the effective value and the risk with the control.
- Cap status updates are not announced on their own (they change on load); the save status is a single `aria-live="polite"` region.
- K-04 and K-05 carry meaning in text, not color; no danger color in this dialog (danger is reserved for errors and changed host keys).
- Targets 44px minimum, 3px focus outline at 2px offset, 16px select text.
- Audit hand-off: VoiceOver on iOS sheet (focus order, select wheel announcement), keyboard-only dialog trap and return through `Actions`, 200 percent zoom at 320px, contrast of preview text in each terminal theme.

## Dependencies and open questions

- Q-01, architect: the page must learn `{ resumeEnabled, maxKeepAliveMs | null }` before connecting (K-01 to K-06). Mechanism TBD (HTTP capability endpoint from the same relay origin, or a pre-connect frame). Without it, only K-05/K-06 after connect are possible.
- Q-02, architect: the v2 `connect` frame needs a requested keep-alive; `protocol.ts:154` rejects `graceMs > 120000`, and D2 memory budgets were sized for 120s, not 1 hour or unlimited. Mid-session change (S-06) needs a decision; this spec assumes not supported.
- Q-03, product: does `Off` mean v1 behavior (close on `pagehide`) or v2 with zero grace? Strings assume the user-visible result is the same.
- Q-04, writer: final risk wording and the Help topic. Security review (architecture F5) may require stronger wording for public deployments.
- Validate with users: whether people find keep-alive under Settings before needing it; whether the risk text is understood; whether the preview is enough on phone.
- Doc updates when built: README lines 438 and 500-502, `USER-GUIDE.md:81`, `helpTopics.ts:63`, tests naming `Appearance` (`toolbarLabels.test.tsx`, `accessibilityFocus.test.tsx`, `App.test.tsx:924`, e2e `connect-flow.spec.ts:574`, `font-metrics.spec.ts:32`).

## DESIGN.md delta

- Tokens, Icon map: replace `Appearance Palette` with `Settings Settings`.
- Layout, add: `Settings: a dialog capped at 560px from 720px up; a full-height sheet with sticky title and Close below 720px. Sections Terminal then Session, labels above fields, 24px between sections.`
- Layout, Session phone: Actions menu contents become Files, Disconnect, Clipboard, Settings, Help, About.
- Components, Toolbar overlay panels: remove Appearance from the list (About, Clipboard remain).
- Components, add Settings: `Changes apply and save on change; no Save button. States: cap loading, within cap, no limit, limited by server (shows effective value), unsupported relay, cap unknown, Off, saved, save failed. Terminal fields apply to open terminals; keep-alive applies to terminals opened next. Terminal preview uses the active target. The keep-alive risk text is always visible, never behind a disclosure.`
- Rules, add: `A server cap is shown as text with the effective value; never silently replace the user's choice.`
- Open items, add: Q-01 to Q-04 above; `Success` token still TBD (save status uses muted text, not success color).
