# 22 · iPad access

Depends on: 01 to 21 (read 00-index first), and on specs 14 and 17 as built. It bends index contract 1 (loopback only) and widens contract 8 (what may live in the data folder), and it changes the parts of specs 01, 02, 09, 10, 14 and 17 named under "Specs this amends". Those passages are edited in the build PRs, not here, so each spec describes the app as it is until the build lands.

## Problem Statement

The person draws best with a pen. Their Mac runs Unframed all day, but the canvas lives in a desktop window, and a mouse or trackpad is a poor tool for sketching. They own an iPad with an Apple Pencil and want to draw on the same canvas from it, on the sofa or at the desk, while the Mac stays on with the app open.

Sidecar is not the answer: it turns the iPad into a second monitor for the Mac, so the Pencil is a pointer, fingers barely work, and nothing about the canvas feels native to the tablet. Tailscale is not wanted either. And today the engine refuses every request that does not come from the Mac itself (index contract 1), so there is no way in.

Two hard limits shape the answer. Safari on the iPad turns off `crypto.randomUUID` and the clipboard on a plain `http://` page reached by a network name, and the web client needs both, so the iPad has to reach the engine over HTTPS. And the tldraw license key checks the host name of any HTTPS page that is not loopback: the person's hobby key lists `unframed.design` and `mbp-aliano.local`, and tldraw refused `*.local`, so a production canvas served at any other name goes blank after five seconds. The feature therefore works on the person's own Mac and nowhere else, and the app has to know that.

## Solution

A new section in Settings, **iPad access**, shown only on a Mac running the desktop app whose tldraw key lists this Mac's local name. It has a switch, off by default. Turned on, the engine opens a second listener, the **iPad listener**: HTTPS on a fixed port (18790 unless the person changes it), reachable only from the home network and only by this Mac's local name, `https://<name>.local:18790`.

Setting up an iPad takes three steps, once:

1. **Trust the certificate.** "Export iPad profile" saves a small profile file and shows it in Finder. The person AirDrops it to the iPad, installs it, and turns on full trust for it in the iPad's Settings. The engine made that certificate authority itself, on this Mac, and its private key never leaves the data folder.
2. **Pair.** "Pair an iPad" shows a QR code and a six-digit code that lasts five minutes. The iPad opens the link (or types the code on the pairing page) and is remembered from then on. Settings lists every paired device with Revoke.
3. **Add to Home Screen** (optional). Unframed then opens full screen, without Safari's bars.

On the iPad the person gets the whole app: the canvas with the Pencil (tldraw's pen mode ignores the palm), the composer and Generate, the agent rail and its approvals, Settings. Everything is live: a stroke on the iPad appears on the Mac at once, and a result generated on the Mac lands on the iPad. The iPad has its own pan and zoom. It shows the project the Mac has active and follows it when the Mac switches; choosing another tab on the iPad changes only the iPad.

A few things stay on the Mac because they cannot work anywhere else: Reveal in Finder, Copy path, the folder picker, Connect OpenRouter, outside agent connections, and the iPad section itself. Pages and motions show their snapshots on the iPad; opening one says to open it on the Mac. While an iPad is connected, the Mac does not go to sleep.

## User Stories

1. As a person, I want to draw on my Mac's canvas with the Apple Pencil on my iPad, so that I sketch with a real pen.
2. As a person, I want my strokes on the iPad to appear on the Mac as I draw, so that both screens show one canvas.
3. As a person, I want results generated on the Mac to land on the iPad without a reload, so that I can keep drawing over them.
4. As a person, I want palm and finger touches ignored while I draw with the Pencil, so that resting my hand leaves no marks.
5. As a person, I want to pan and zoom the iPad on its own, so that I can zoom in to draw without moving the Mac's view.
6. As a person, I want the iPad to show the project the Mac has open, so that I never hunt for it.
7. As a person, I want the iPad to follow when the Mac switches tabs, so that the two stay together without effort.
8. As a person, I want to open a different project on the iPad without changing the Mac, so that I can look at one board while the Mac works on another.
9. As a person, I want to Generate, chat with the agent and answer its approvals from the iPad, so that I do not have to walk to the Mac.
10. As a person, I want an approval I answered on one device to close on the other, so that nobody answers twice.
11. As a person, I want to add photos from the iPad to the canvas, so that a picture I took is one tap away.
12. As a person, I want iPad access off until I turn it on, so that nothing listens on my network by surprise.
13. As a person, I want the switch to appear only when my tldraw key covers this Mac, so that I am never offered a feature that shows a blank canvas.
14. As someone else running Unframed, I want no iPad section at all on my machine, so that my Settings show only what works for me.
15. As a person, I want to choose the port when another app holds the default, so that a clash never blocks the feature.
16. As a person, I want a plain message when the port is taken, so that I know what to change.
17. As a person, I want the iPad link to stay the same across restarts, so that a bookmark or Home Screen icon keeps working.
18. As a person, I want to set up the certificate once, so that I am not asked to trust anything again.
19. As a person, I want the certificate to renew itself without asking the iPad to trust it again, so that access never lapses quietly.
20. As a person, I want to pair an iPad by scanning a code, so that setup takes seconds.
21. As a person, I want to type the pairing code when scanning is not possible, so that the Home Screen app can pair too.
22. As a person, I want a pairing code to expire after five minutes and work once, so that a code seen over my shoulder is useless later.
23. As a person, I want wrong codes to lock the code after five tries, so that nobody can guess it.
24. As a person, I want to see every paired device and when it was last used, so that I know who has access.
25. As a person, I want to revoke a device and have it cut off at once, so that a lost iPad loses access immediately.
26. As a person, I want turning the switch off to keep my pairings, so that turning it back on needs no new setup.
27. As a person, I want nothing reachable without pairing except the pairing page, so that a guest on my Wi-Fi sees nothing of my projects.
28. As a person, I want the engine to refuse requests addressed by IP or from outside my home network, so that only this Mac's local name over my home network works.
29. As a person, I want Reveal in Finder, Copy path, the folder picker and Connect OpenRouter hidden on the iPad, so that I never press something that happens on the other device.
30. As a person, I want pages and motions to show their snapshots on the iPad, with a note to open them on the Mac, so that the board reads correctly and I know where to edit.
31. As a person, I want the Mac to stay awake while an iPad is connected, so that the canvas does not drop while I draw.
32. As a person, I want the Mac to sleep normally once no iPad is connected, so that leaving the switch on costs no battery.
33. As a person, I want the iPad to show the connection-lost notice when the Mac's app quits, and to reconnect when it is back, so that I know why the canvas froze.
34. As a person, I want Unframed added to the Home Screen to open full screen, so that it feels like an app.
35. As a person, I want every control I use on the Mac reachable by touch on the iPad, so that nothing needs a hover I cannot do.
36. As a person using an outside agent, I want "what have I selected" to answer with the iPad's selection when I last selected on the iPad, so that the agent sees what I mean.
37. As a person, I want the iPad never to reorder, close or switch the Mac's tabs, so that drawing on the iPad leaves the Mac as I set it.
38. As a maintainer, I want device tokens stored only as hashes, so that a copy of the data folder grants no access.
39. As a maintainer, I want the certificate authority's private key readable only by the person, so that another account on the Mac cannot mint certificates the iPad trusts.
40. As a maintainer, I want every engine method that only makes sense on the Mac refused for a paired device in the engine itself, so that hiding a button is never the only guard.
41. As a maintainer, I want the iPad listener testable on a CI runner with no home network, so that the guards are proven on every pull request.
42. As a maintainer, I want the keep-awake message to be one more IPC message an older shell ignores, so that the hosting contract only grows.
43. As a maintainer, I want the license host check to match tldraw 5.4.2's own rule, so that the switch shows exactly when the canvas would render.

## Implementation Decisions

### Terms this spec adds

- **iPad access**: the feature and its Settings section. The name is the person's; any browser on the home network that pairs gets the same thing, but the section and the copy say iPad.
- **iPad listener**: the engine's second API listener, HTTPS on the iPad port, serving the same routes as the API listener to paired devices only. It is not the preview origin and serves no artifact.
- **Local name**: this Mac's Bonjour name with `.local` appended, lowercased (`mbp-aliano.local`). It is read from `scutil --get LocalHostName`. It exists only on macOS.
- **Paired device**: a browser that proved a pairing code and holds a device token. It has an id, a name (from its user agent: `iPad`, `iPhone` or `Browser`, plus the pairing date), the time it paired and the time it was last seen.
- **Device token**: the secret a paired device holds in a cookie. The engine keeps only its hash.
- **Pairing code**: six digits, one at a time, valid five minutes, one use, locked after five wrong tries.
- **Local certificate authority**: the CA the engine generates for this Mac, and the **iPad profile** that carries its certificate to the iPad.
- **Mac client** and **device client**: a web client connected through the API listener, and one connected through the iPad listener. The web learns which it is from `server.health`.

### Modules

| Module | Where | Interface | Depth |
| --- | --- | --- | --- |
| iPad access rules | domain | `licenseHosts(key) -> string[]`, `hostCovered(hosts, name) -> boolean`, `availability({ platform, hosted, localName, hosts }) -> { available: true } \| { available: false, reason }`, `isPrivateAddress(ip)`, `deviceGuard({ host, origin, localName, port }) -> allow \| refuse`, `pairingAttempt(state, code, now) -> { state, outcome }`, `deviceNameFor(userAgent, date)`, `leafNeedsRenewal(leaf, localName, now)`, `allowedForDevice(method) -> boolean`, `followTabs(state, event) -> state` | deep: every rule with many cases, no I/O |
| Certificates | engine | `ensure(localName) -> { ca, leaf }`, `profile(localName) -> path` | deep: key generation, signing, renewal, file modes |
| Device store | engine | `startPairing() -> { code, expiresAt }`, `pair(code, userAgent) -> { device, token } \| refused`, `resolve(token) -> device \| undefined`, `list()`, `revoke(id)`, `touch(id)` | deep: codes, attempts, hashing, the file, revocation |
| iPad listener | engine | `start({ port, localName })`, `stop()`, `status()` | deep: TLS, the address filter, the guard, cookie auth, the pairing page, delegation to the API routes |
| Presence | engine | `connected(deviceId, socket)`, `disconnected(socket)`, `count()`, `closeDevice(id)` | small: counts device sockets, sends keep-awake, cuts a revoked device |
| iPad section | web | the Settings section, the pairing dialog, the device list | |
| Device mode | web | reads `server.health.client`; hides Mac-only controls, shows snapshots only, follows the Mac's tabs | |

The host check mirrors tldraw 5.4.2's `isDomainValid` for a hostname: both sides lowercased and the key's entry trimmed; an exact match, or the same with `www.` on either side; `*` matches everything; an entry with `*` is a glob anchored at the end only. A key with tldraw's native flag (bit 32 of field 2) covers no local name, because its entries match a protocol, not a host. `licenseHosts` reads field 1 of the key's payload: the key is `tldraw-<anything>/<base64 JSON>.<signature>`, and the JSON is an array whose second item is the host list. It reads, it never verifies; only tldraw's own check proves a key genuine. An empty or unreadable key gives no hosts.

### Settings and when the section shows

- Two new settings variables in spec 01's table, both editable in the app, both written through the `.env` funnel and applied without a restart:

| Variable | Default | Validator | Clearable |
| --- | --- | --- | --- |
| `IPAD_ACCESS` | empty (off) | `on` or empty | yes |
| `IPAD_PORT` | `18790` | whole number 1024 to 65535 | yes (back to the default) |

- `availability` is computed in the web from the key the web already embeds and the `localName` that `ipad.status` answers. The section shows only when all hold: the platform is macOS, the engine is hosted (`UNFRAMED_CLIENT_DIST` set), a local name was read, and `hostCovered` is true for it. Otherwise the section is absent, not disabled. When the engine has `IPAD_ACCESS=on` but availability is false (the Mac was renamed, the key changed), the listener does not start and the engine logs `  iPad access is on, but the tldraw key does not list <name>; the iPad listener stays off.` The engine learns availability from the web's `ipad.setAvailability(boolean)` call on each Mac client's boot, held in memory, because the key is a web build value.
- The section, after "Local agents" in spec 10's order: heading `iPad`; the line `Draw on this canvas from your iPad over your home Wi-Fi. Only devices you pair can connect.`; t3code's switch `iPad access`; under it, when on, the address `https://<name>.local:<port>` in the mono font with Copy; a number field `Port` (part of Save, like the other `.env` fields); the buttons `Export iPad profile` and `Pair an iPad`; the three setup steps as a short numbered list; the paired device list. The switch writes at once, like spec 08's preference switches, not on Save.
- A taken port: the listener stays off, the switch stays on, and the section shows the kit's warning Alert `Port <port> is in use by another app. Choose another port and save.` The boot never stops for it.

### The iPad listener

- **Bind and filter.** Listens on `0.0.0.0:<IPAD_PORT>` with TLS while `IPAD_ACCESS=on` and availability holds. Each connection is checked before the TLS handshake: its local and remote addresses must both be private IPv4 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), else the socket is destroyed. Loopback, link-local, IPv6 and public addresses are refused. Binding the wildcard and filtering each socket survives a Wi-Fi change without a rebind.
- **Guard.** `deviceGuard` runs before any handler, for HTTP and for upgrades. `Host` must equal `<localName>:<port>`, case-insensitive; an IP or any other name is refused 403 `{ "error": "Open Unframed at https://<localName>:<port>." }`. `Origin` must be absent or equal `https://<localName>:<port>`, else 403 with spec 01's same-machine message. No CORS headers, as spec 01 says.
- **Authentication.** After the guard, every request needs the `unframed_device` cookie holding a token that `resolve` accepts, except `GET /pair`, `POST /api/ipad/pair`, and the Home Screen assets (the manifest and the icons). Without it: a top-level HTML navigation is redirected 303 to `/pair`; any other request answers 401 `{ "error": "Pair this device in Unframed's Settings on your Mac." }`; an upgrade is refused 401 with no handshake.
- **Routes.** The same as the API listener (spec 01's list), served by the same handlers, with the client dist, `/ws`, `/sync`, file serving, media upload and attachment upload. Not served: the OAuth callback (it only works at loopback) and the MCP endpoint (outside agents run on the Mac). The preview origin is not exposed.
- **Sockets.** Every RPC and sync socket from the iPad listener carries its device id. Revoking a device closes its sockets with code 1008 at once. Turning the switch off, changing the port, or availability turning false stops the listener and closes its sockets with 1001.

### Certificates

- **Files**, under `<data folder>/ipad/`: `ca-key.pem` and `leaf-key.pem` (mode 0600), `ca.pem`, `leaf.pem`, and the exported profile. Generated on the first `ensure`, which runs when the listener first starts or the profile is first exported.
- **Authority**: ECDSA P-256, self-signed, common name `Unframed local CA (<localName>)`, valid ten years, basic constraints CA true with path length 0, key usage keyCertSign. Never regenerated by the engine; deleting the folder resets it, and the iPad then needs the new profile.
- **Leaf**: ECDSA P-256, signed by the authority, subject alternative name `DNS:<localName>` only, extended key usage serverAuth, valid 397 days (inside Apple's 825-day rule with room). `leafNeedsRenewal` is true when the local name differs from its SAN or fewer than 30 days remain; the check runs at listener start and every 24 hours, and a renewal swaps the TLS context without dropping open sockets. The iPad trusts the authority, so a renewed leaf needs nothing from the person.
- **Library**: `@peculiar/x509` with Node's WebCrypto, added to the engine's dependencies and `THIRD_PARTY_NOTICES`.
- **Profile**: `ipad.exportProfile` writes `Unframed-<name>.mobileconfig`, an unsigned configuration profile with one `com.apple.security.root` payload holding `ca.pem`, and reveals it through spec 01's reveal (hosted, so the shell's Finder reveal). The section's steps say: AirDrop the file to the iPad, install it in Settings > General > VPN & Device Management, then turn on full trust in Settings > General > About > Certificate Trust Settings.

### Pairing

- `ipad.pairStart` answers `{ code, url, expiresAt }`, where `url` is `https://<localName>:<port>/pair?code=<code>`. A new start replaces any pending code. The pairing dialog shows the QR code of `url` (the `qrcode` package, MIT, added to the web) and the code in large digits, counts down, and closes itself when the code is used, with the toast `<device name> is paired.`
- `GET /pair` is a small page the engine renders itself, in the kit's tokens, with no app code: a six-digit field prefilled from `?code=`, a button `Pair`, and the line `Find the code in Unframed's Settings on your Mac, under iPad.`. It posts to `POST /api/ipad/pair { code }`.
- `pairingAttempt` rules: a code is good once, within five minutes; the fifth wrong code (any digits, from anyone) locks the pending code, and the page answers `This code is locked. Start pairing again on your Mac.`; an expired code answers `This code has expired. Start pairing again on your Mac.`; a wrong code answers `That code is not right.`
- On success the engine mints a 32-byte random device token, stores its SHA-256 hash with the device record in `<data folder>/ipad-devices.json` (mode 0600, written atomically), sets `unframed_device=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=34560000`, and redirects 303 to `/`. Tokens are compared by hash in constant time, as spec 14's connection store does.
- `ipad.devices` lists `{ id, name, pairedAt, lastSeenAt }` and never a token or hash. `lastSeenAt` is touched at most once a minute. `ipad.revoke(id)` removes the record and cuts the device's sockets. The list shows each device with a ghost `Revoke` that turns into a destructive `Yes, revoke` on the first click, like spec 10's Remove key.
- Pairings survive restarts and the switch. They are global, not per project.

### What a device client may do

- `server.health` gains `client: "mac" | "device"`, from the listener the socket came through.
- `allowedForDevice` is the engine's list, enforced in the RPC layer before the handler: a device socket calling a method on the Mac-only list gets the error `{ code: "mac_only", message: "This works only in Unframed on your Mac." }`. The list: `files.reveal`, `files.path`, `settings.pickFolder`, spec 10's OAuth start and cancel, spec 14's `agentConnections.create` and `agentConnections.revoke`, every `ipad.*` method except `ipad.status`, a settings write of `IPAD_ACCESS` or `IPAD_PORT`, and a `preferences.set` of `project.tabs` or `project.active`. Everything else is allowed, including Generate, the agent and its approvals, uploads and other settings.
- The web in device mode hides what the list refuses: Reveal in Finder and Copy path in the context menu, `Browse…` beside the output folder, `Connect OpenRouter` (the paste field stays), the outside agents block's Create and Revoke, and the whole iPad section.

### Tabs on the iPad

- A device client reads `project.tabs` and subscribes to it (spec 17 reads it once at boot; a Mac client keeps doing that). It never writes it, nor `project.active`.
- `followTabs` holds the iPad's state: `following` or `detached(project)`. The strip shows the Mac's order. Following, the iPad's active tab is the Mac's. Choosing another tab, or opening a project from All projects, detaches to that project; a project not in the Mac's tabs shows as one extra tab at the end, on the iPad only. The next change of the Mac's active tab returns the iPad to following. Close, reorder, rename and delete from the tab menu are hidden on a device client; Add project stays.
- The iPad's camera, drafts and closed-tab stack are its own, in its own tab store, as spec 17 holds them.

### Artifacts on the iPad

- A device client never mounts an artifact frame. Every page and motion shape shows its snapshot (spec 09's `?snapshot=` route, which the iPad listener serves), or the hint card when there is none; selecting or pinning one does not run it.
- Double-clicking one, or choosing Open in editor, shows the kit's info toast `Open this on your Mac to edit or play it.` and opens nothing. "Open in a new tab" and the dials panel are hidden.

### Touch and the Home Screen

- The client dist gains a web app manifest (name `Unframed`, `display: standalone`, theme colours from spec 12's tokens, icons from `assets/brand/`) and the `apple-mobile-web-app-capable` and `apple-touch-icon` tags. They are harmless on the Mac.
- A touch audit lists every control that appears only on hover or needs a right-click, and gives each a tap path: a right-click menu opens on a long press (500 ms) as well; a hover-only button becomes always visible when the primary pointer is coarse (`@media (pointer: coarse)`). The audit's list goes in the build PR's body.
- The desktop layout is kept. At iPad landscape width (1180 px) nothing is redesigned.

### Keeping the Mac awake

- Presence counts open device sockets. When the count goes from 0 to 1 the hosted engine sends `{ "type": "keep-awake", "on": true }` over IPC; when it stays at 0 for 30 seconds it sends `{ "type": "keep-awake", "on": false }`. Gated on hosting like spec 01's reveal.
- The shell answers `on: true` with Electron's `powerSaveBlocker.start('prevent-app-suspension')`, keeping one blocker at most, and `on: false` and app quit with `stop`. The display may still sleep. An older shell ignores the message, because it acts only on `ready` and `reveal`.

### Specs this amends

Each is edited in the PR that builds the change.

- **00-index**: contract 1 names the iPad listener as a second bend beside the share server; contract 8 adds the iPad folder and the device store to the data folder's list; the vocabulary gains the terms above; the build order gains row 22.
- **Spec 01**: the settings variable table gains `IPAD_ACCESS` and `IPAD_PORT`; the hosting contract gains the `keep-awake` IPC message; the test-only table gains `UNFRAMED_TEST_IPAD`; `server.health` gains `client`; the loopback guard section points to the device guard for the iPad listener; "there is no option to widen the bind" gains "except the iPad listener (spec 22)".
- **Spec 02**: the context menu's Reveal and Copy path are hidden for a device client; long press opens the context menu on a coarse pointer.
- **Spec 09**: a device client shows snapshots only and never opens the editor.
- **Spec 10**: the settings dialog gains the iPad section after Local agents; Browse and Connect OpenRouter are hidden for a device client.
- **Spec 14**: Create and Revoke in the outside agents block are Mac-only; a device client's window counts for the live selection like any other.
- **Spec 17**: a device client follows `project.tabs` and never writes it.

### Rules this spec bends

1. **Index contract 1, loopback only.** The iPad listener binds the wildcard address and answers requests from the home network. Why it stays safe: it accepts only private addresses, only this Mac's local name, only HTTPS with a certificate the person installed, and only paired devices beyond the pairing page; it is off by default and absent on every machine the key does not cover. The API listener and the preview origin are unchanged and still bind loopback only.
2. **Index contract 8, project folders are self-contained.** The data folder gains the iPad folder and the device store. Neither holds project state.

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts what it exposes: rules and their answers, HTTP and RPC answers, socket closes, the files in the data folder, the IPC messages sent, the room's shapes, and what a person sees on each client. No test reaches into the device store's memory, the TLS context or React state.

- **New test-only variable**, `UNFRAMED_TEST_IPAD` (spec 01's table, used by 22): a local name, for example `ipad-test.local`. When set, the engine uses it as the local name on any platform, treats itself as available without the web's call, lets the iPad listener accept loopback connections in place of private ones, accepts `IPAD_PORT=0` (OS-assigned, reported by `ipad.status`), and answers `ipad.status` with `testHosts: [<name>]`, which the web uses in place of its key's hosts. It is the only way a CI runner, which has no home network, can reach the listener. Following the origin rule of spec 01's table, it never widens what the listener accepts beyond loopback.
- **Domain seam** for the rules with many cases: `licenseHosts` on well-formed, malformed, empty and native-flagged keys (fabricated payloads, never a real key); `hostCovered` against tldraw 5.4.2's cases (case, trim, `www.` both ways, `*`, end-anchored globs, `foo*.local` against a longer name); `availability` per missing condition; `isPrivateAddress` at each range edge and for loopback, link-local, IPv6 and public addresses; `deviceGuard` for IP hosts, other names, wrong ports, mixed case, absent and foreign origins; `pairingAttempt` for success, reuse, expiry, the fifth wrong try and a replaced code; `deviceNameFor` per user agent; `leafNeedsRenewal` at 31 and 29 days and on a renamed Mac; `allowedForDevice` for every listed method and a sample of allowed ones; `followTabs` for each event.
- **Engine seam**, with `UNFRAMED_TEST_IPAD` set and a client that trusts the test run's generated authority: the listener starts on the switch and stops off; a taken port leaves it off with the status saying so and the boot finishing; the guard's refusals over real TLS; unpaired requests get the redirect, the 401s and the refused upgrade; pairing end to end with the cookie set and accepted; reuse, expiry and lock; revoke closes the device's sockets with 1008 within one second; `ipad-devices.json` is 0600 and holds no token; the certificate files, their modes, the leaf's SAN, EKU and validity; renewal on a changed name without dropping a socket; `mac_only` for each listed method from a device socket and success from a Mac socket; `preferences.set` of `project.tabs` refused from a device; the OAuth callback and `/mcp` answer 404 on the iPad listener; the profile export writes a profile holding the authority; `keep-awake` on at the first device socket and off 30 seconds after the last, only when hosted.
- **Browser seam**, two Playwright contexts on one engine: the Mac context on the API listener as today, and the device context on the iPad listener (Chromium launched with a host resolver rule mapping the test name to 127.0.0.1, the context ignoring the test authority's certificate, touch on, a 1180 by 820 viewport and an iPad user agent). Pen input is sent through CDP's `Input.dispatchMouseEvent` with `pointerType: "pen"`. Tests: the section shows only with covered hosts; pairing from the dialog's code; a pen stroke on the device appears in the Mac's room and on the Mac's screen; a result landing on the Mac appears on the device; the device's camera moves alone; the device follows a Mac tab switch, detaches on a local choice, and returns on the Mac's next switch, while the Mac's `project.tabs` never changes; hidden controls are absent on the device; artifacts show snapshots and the editor toast; an approval answered on one context closes on the other; long press opens the context menu; revoking from the Mac sends the device to the pairing page.
- **Prior art**: spec 14's connection store tests for hashing, modes and revocation; spec 04's share server tests for a second listener with its own rules; spec 17's browser tests for tabs; spec 01's guard tests.

## Tasks

The build is one `/implement` run per PR, in this order. Each PR updates the specs it changes. Each task names its seam.

**Person's step, before PR 1**

1. On the iPad, on the home Wi-Fi, open Safari at `http://MBP-ALIANO.local:<port>` while anything on the Mac answers on that port (for example `python3 -m http.server <port>` in a folder). Record whether the page loads. If it does not, stop the build: the local name does not resolve on this network, and this spec needs a new decision before it can work. Seam: none (the person's check).

**PR 1: the rules, the certificates and the listener (no visible change)**

2. `licenseHosts` and `hostCovered`, matching tldraw 5.4.2. Seam: domain.
3. `availability`, `isPrivateAddress`, `deviceGuard`, `deviceNameFor`, `leafNeedsRenewal`, `allowedForDevice`, `followTabs`. Seam: domain.
4. `pairingAttempt`: success, reuse, expiry, lock after five, replace. Seam: domain.
5. `IPAD_ACCESS` and `IPAD_PORT` in the settings table, their validators and live apply; `UNFRAMED_TEST_IPAD` in the test-only table. Seam: engine.
6. The local name from `scutil`, and `ipad.status` with it, the port, the listener state and, under the test variable, `testHosts`. Seam: engine.
7. Certificates: the authority and the leaf generated once, their files and modes, the leaf's SAN, EKU and validity. Seam: engine.
8. The iPad listener starts with the switch and stops without it, on the fixed port; a taken port keeps it off and the boot running. Seam: engine.
9. The address filter and the device guard over TLS. Seam: engine.
10. Unpaired requests: the redirect to `/pair`, the 401s, the refused upgrade, and the assets that stay open. Seam: engine.
11. Pairing: `ipad.pairStart`, the pairing page, `POST /api/ipad/pair`, the cookie, the device store file holding only hashes. Seam: engine.
12. Paired requests reach every API route; the OAuth callback and `/mcp` do not. Seam: engine.
13. `ipad.devices`, `ipad.revoke` and the 1008 close; the switch off and the port change close with 1001 and keep pairings. Seam: engine.
14. `server.health.client` and the `mac_only` refusals, including the two preference keys. Seam: engine.
15. Leaf renewal on a changed name and near expiry, swapping the TLS context without dropping sockets. Seam: engine.
16. `ipad.exportProfile` writes the profile and reveals it. Seam: engine.
17. Presence and `keep-awake` on and off, hosted only. Seam: engine.

**PR 2: the Settings section and pairing (the feature is usable)**

18. The iPad section shows only when `availability` holds, and is absent otherwise. Seam: browser.
19. The switch, the address with Copy, the port field on Save, and the taken-port warning. Seam: browser.
20. Export iPad profile and the setup steps. Seam: browser.
21. The pairing dialog: QR code, digits, countdown, closing on success with the toast. Seam: browser.
22. The device list with last seen and the two-step Revoke, which sends the device to the pairing page. Seam: browser.
23. A device context pairs, loads the app, and its pen stroke lands in the Mac's room and on the Mac's screen; a result from the Mac lands on the device. Seam: browser.

**PR 3: device mode in the web**

24. Mac-only controls hidden on a device client: Reveal, Copy path, Browse, Connect OpenRouter, outside agent Create and Revoke, the iPad section. Seam: browser.
25. Tabs on the device: follow, detach, the extra local tab, return on the Mac's switch, and the Mac's `project.tabs` untouched. Seam: browser.
26. Artifacts on the device: snapshots only, no frames, the editor toast, no new-tab or dials. Seam: browser.
27. Two clients: an approval answered on one closes on the other; the live selection follows the last device to select. Seam: browser, with the scripted agent.
28. The connection-lost notice on the device when the engine stops, and reconnection when it returns. Seam: browser.

**PR 4: touch, the Home Screen and the shell**

29. The touch audit and its fixes: long press for context menus, coarse-pointer visibility for hover-only controls. Seam: browser.
30. The manifest, the Home Screen tags and the icons in the client dist. Seam: engine (the files are served, including unpaired).
31. The shell's keep-awake handler with `powerSaveBlocker`, one blocker at most, stopped on quit. Seam: engine (the IPC message), and the shell's smoke test for the handler.
32. The spec amendments under "Specs this amends", the index changes, `THIRD_PARTY_NOTICES` for `@peculiar/x509` and `qrcode`, and the PR body's screenshots: the section with the switch on, the pairing dialog, the device list, and the device client with a pen stroke.

**Person's step, after PR 4**

33. On the real iPad: install the profile and trust it, pair, add to the Home Screen and pair there if the Home Screen app asks again, draw with the Pencil, and confirm that pressure, palm rejection and the Mac staying awake behave. Record the result in the PR. Seam: none (the person's check).

## Out of Scope

- Serving the web client from `unframed.design` to reach the Mac over the network (route 2), and a native iPad app with a native tldraw key (route 3). A native app is a fresh effort if the person decides they want it after using this.
- Any machine but the one the tldraw key lists. No `*.local` key exists, and the feature is absent elsewhere by design.
- Plain HTTP access, and any use of tldraw's development exception for the installed app.
- Tailscale, tunnels, or access from outside the home network.
- Pages and motions running on the iPad, the editor on the iPad, and exposing the preview origin to the network (it would weaken contract 9's process isolation).
- A layout designed for the iPad. The desktop layout stays, with touch fixes only.
- Windows and Linux. The local name is a macOS Bonjour name, and the key lists a Mac.
- Following the Mac's camera, or showing the other device's cursor.
- The `pnpm dev` setup. The feature needs the hosted engine; dev keeps `pnpm dev:share`.
- Resetting the certificate authority from Settings. Deleting the iPad folder does it.

## Decisions

Every decision was made with the person before this spec was written; none is open.

1. **Route 1**: HTTPS at the Mac's local name, which the person's new tldraw key lists beside `unframed.design`. tldraw declined `*.local` as close to an unrestricted key.
2. **The installed desktop app**, not the dev server.
3. **The whole app on the iPad**, with Mac-only actions hidden and refused.
4. **The iPad follows the Mac's active tab** and can choose its own, locally.
5. **Its own pan and zoom.**
6. **A Settings switch, off by default.**
7. **Absent where the key does not cover the local name**, decided by reading the key's host list.
8. **Pairing** by a QR code and a one-time code, then a long-lived cookie; a device list with Revoke; the switch keeps pairings.
9. **A local certificate authority the engine generates**, exported as an iPad profile.
10. **A fixed port**, 18790, changeable.
11. **Private addresses and the local name only.**
12. **The Mac stays awake while an iPad is connected.**
13. **Snapshots for artifacts**, and the editor stays on the Mac.
14. **The iPad never writes the Mac's tabs**; layout preferences stay shared.
15. **The live selection keeps spec 14's rule**, so the iPad counts.
16. **The desktop layout, with a touch audit**, and Home Screen support.
17. **Approvals keep first-answer-wins**, with a test that the other device sees the close.

## Further Notes

- **Research.** `docs/research/ipad-lan-client.md` holds the sources for the secure-context limits, the iPad certificate trust steps, Apple's certificate rules, and the tldraw license behaviour. The license host check was confirmed against tldraw's source at tag `v5.4.2`.
- **Unverified, checked by the person's steps.** Whether `.local` names resolve on the person's network (task 1), and whether a Home Screen web app keeps Safari's cookie or needs its own pairing (task 33). The pairing page takes a typed code for that second case.
- **The key in public builds.** The release key now lists `mbp-aliano.local`. Keys are public by tldraw's design, and the watermark stays visible, as the license requires.
- **Renaming the Mac** changes the local name. The section then disappears until the key lists the new name, and the listener stays off with the log line above.
- **Firewall.** The first time the listener binds, macOS asks whether Unframed may accept incoming connections. The setup steps say to allow it.
- **Shell release.** The keep-awake handler ships in the desktop app. An engine without it is harmless to an older shell, and an older engine never sends the message, so the two may ship in either order.
