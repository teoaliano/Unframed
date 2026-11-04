# iPad on the home network: a second live client of the Mac's canvas

Research gathered 2026-10-28 from Apple, MDN, Node.js, Let's Encrypt, mkcert, code-server, Jupyter, tldraw source and docs, and this repo. No implementation. Items marked **unverified** could not be confirmed from a primary source in this pass.

## Question

The person wants to open Unframed on an iPad over home Wi-Fi, without Tailscale, as a second live client of the canvas running on the Mac (tldraw sync already runs one room per project), and draw with the Apple Pencil. The Mac stays on with the app open. Sidecar is ruled out.

Today the engine binds `127.0.0.1` only and refuses any non-loopback `Host` or `Origin`. `pnpm dev:share` reaches the dev server over `tailscale serve`. This note gathers the facts a LAN spec would need:

1. tldraw on iPadOS Safari with the Apple Pencil
2. Which web APIs are unavailable over plain `http://` on a LAN address, and which ones this app calls
3. HTTPS on the LAN without Tailscale: options, iPad steps, certificate rules
4. Reaching the Mac by name, and the macOS firewall
5. Node and Electron listening on a LAN interface, and macOS Local Network privacy
6. Pairing and auth patterns in comparable tools
7. Prior art in whiteboard and canvas apps

## Short answer

- **Pen input works in tldraw without extra code.** A pen pointer sets `isPen` and reads `PointerEvent.pressure`. On a touch device a pen press turns on tldraw's pen mode, which drops finger and palm input on the canvas. This is what palm rejection depends on, and the app does not override it.
- **Almost every browser API the app needs is restricted on plain HTTP.** `crypto.randomUUID` and the Clipboard API are restricted to secure contexts (MDN). A LAN IP or a `.local` name is not a potentially trustworthy origin under MDN's definition. So the app's canvas module, which calls `crypto.randomUUID()` at load, would throw on import over `http://<LAN IP>`. **Plain HTTP is not an option for this app.**
- **HTTPS is required, and the cheapest path is a local CA.** mkcert creates a root CA on the Mac. The iPad installs the root as a profile and enables full trust under Settings > General > About > Certificate Trust Settings (Apple, mkcert). The server certificate must carry a DNS name in its SAN and be valid for 825 days or fewer (Apple). Tailscale-free, this is the only path with no public exposure.
- **A real public certificate for a LAN-only host is possible but awkward.** Let's Encrypt validates DNS-01 without the host being reachable from the internet, but this needs a registered domain, an API-capable DNS host, and automated renewal. It cannot issue for `.local`, and its IP certificates are six-day certificates that only HTTP-01 or TLS-ALPN-01 can prove (Let's Encrypt).
- **The engine's loopback rule must change for this to work.** A LAN client sends a non-loopback `Host` (for example `MBP-ALIANO.local:8787`) and a non-loopback `Origin`. Spec 01's guard refuses both. Any LAN spec must name this as a bend of contract 1, with the reason.
- **The license key may be the hidden blocker.** tldraw keys carry an allowed-host list. Over HTTPS on a non-loopback host in production, the SDK requires a valid key for that host, and otherwise stops rendering after five seconds (tldraw license docs). Whether the person's hobby key covers a `.local` name is **unverified**, and the key must not be printed or committed.
- **Mac name.** This Mac's local hostname is `MBP-ALIANO` (`scutil --get LocalHostName`, run here), so the candidate URL is `https://MBP-ALIANO.local:<port>`. Name clashes append a number. Whether Safari on iPadOS resolves `.local` on a given home network is **unverified** from a primary source. An IP fallback exists.
- **macOS prompts for incoming connections.** When an app not on the firewall list accepts an incoming connection, the Mac asks whether to allow it, and the connection is denied until someone answers (Apple support). Local Network privacy for a listening process is **unverified**: the TN3179 body could not be read.
- **Pairing precedent exists in the repo.** Spec 14's connection tokens are random, stored hashed, and compared with `timingSafeEqual` (`packages/engine/src/agentConnections/book.ts`). Code-server and Jupyter both use a password or token first and then a browser cookie (see Question 6).

## What the app does today

Facts from this repo at the current checkout.

- The engine binds loopback only, with no option to widen it: `packages/engine/src/listen.ts` (`LOOPBACK_HOST = "127.0.0.1"`, "There is no option to widen the bind").
- The loopback guard refuses a non-loopback `Origin` and a non-loopback `Host` before any handler runs. Spec 01 "Loopback guards" and contract 1 in `docs/specs/00-index.md`.
- The web builds its socket URLs from `location`: the RPC socket in `packages/web/src/rpc/engine.ts:53` and the sync socket in `packages/web/src/canvas/CanvasHost.tsx:54-55`. Both pick `wss:` when the page is `https:` and `ws:` otherwise. Nothing hard-codes `localhost`, so a LAN page would dial its own host. The guard is what refuses it.
- Artifact previews use `window.location.hostname` (`packages/web/src/artifacts/ArtifactFrame.tsx:23,30`), so a LAN page would build preview URLs on the LAN host. The preview origin still binds loopback (spec 09), so this is a second thing to check.
- Dev share: `scripts/dev.ts` runs `tailscale serve --bg --https=<port> http://localhost:<port>` and uses the tailnet name from `tailscale status --json`. Spec 01 "Dev share relay" is a Vite-side rewrite of `Origin` and `Host` from the share origin back to localhost. It is a dev-only feature and does not touch the engine bind.
- The machine's names, read here: `scutil --get LocalHostName` returns `MBP-ALIANO`, and `scutil --get ComputerName` returns `MBP-ALIANO`.

## Question 1: tldraw on iPadOS Safari with the Apple Pencil

**Pen detection.** tldraw treats any pointer with `pointerType === 'pen'` as a pen. `getPointerInfo` sets `isPen: e.pointerType === 'pen'` and copies `e.pressure` into the point's `z`.
- Source: [`packages/editor/src/lib/utils/getPointerInfo.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/utils/getPointerInfo.ts)

**Direct-display pen.** `isDirectDisplayPen(e)` is true only when `pointerType === 'pen'` and `tlenv.isTouchDevice`. This separates an Apple Pencil on a touch screen from a desktop graphics tablet.
- Source: [`packages/editor/src/lib/utils/pointer.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/utils/pointer.ts) (line 22)

**Pen mode.** `useCanvasEvents` computes `isPenDirect` on pointer down and sets pen mode when a direct pen touches. While `isPenMode` is on, the canvas drops pointer events whose `pointerType !== 'pen'`. This covers pointer down (line 56), pointer cancel (line 113) and pointer enter (line 137). Finger and palm touches do nothing on the canvas. Toolbars still take finger taps.
- Sources: [`packages/editor/src/lib/hooks/useCanvasEvents.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/hooks/useCanvasEvents.ts), [tldraw docs: Pen mode](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/pen-mode.mdx)
- The docs say pen mode "only turns on for direct-display pens", that it is session state, and that the default UI shows an "Exit pen mode" helper button. This app's `packages/web/src` has no reference to `isPenMode`, `ExitPenMode` or `exit-pen-mode`, so whatever tldraw UI is shown is the default (**unverified** that the default helper button is visible in the app's chrome).

**Pressure.** The pen's `PointerEvent.pressure` (0 to 1) feeds the draw tool's stroke width. The draw shape records `isPen: true` when the input reports real pressure, meaning a pen pointer with non-zero pressure or any pointer whose pressure is not a constant 0, 0.5 or 1. Mouse and finger strokes use simulated pressure.
- Source: [tldraw docs: Pen mode, "Pressure sensitivity"](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/pen-mode.mdx)

**iPad double-tap zoom.** tldraw's `useFixSafariDoubleTapZoomPencilEvents` calls `preventDefault` on `touchstart` and `touchend` for pen-originated events, except inside text editing. This stops the iOS zoom window on a pencil double tap.
- Source: [`useFixSafariDoubleTapZoomPencilEvents.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/hooks/useFixSafariDoubleTapZoomPencilEvents.ts)

**iPadOS user agent.** `tlenv.isIos` is true only when the user agent contains `iPad` or `iPhone`. `tlenv.isDarwin` checks for `mac`. A desktop-class Safari on iPadOS may send a Macintosh user agent (**unverified** from Apple; this is from general knowledge). If so, any code that branches on `tlenv.isIos` will not run on the iPad.
- Source: [`packages/editor/src/lib/globals/environment.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/globals/environment.ts)

**Known issues.**
- Safari has supported Pointer Events since version 13, so `pointerType` and `pressure` are available on iPadOS (secondary source: [dev.to article quoting Safari 13 notes](https://dev.to/pfacklam/consistent-access-to-browser-events-with-pointer-events-api-5gh4); not verified in WebKit's own release notes).
- WebKit bug 217430: with Scribble enabled, Safari dropped `pointerdown` events on iPadOS 14. Reported as resolved ([WebKit bugzilla](https://bugs.webkit.org/show_bug.cgi?id=217430)).
- An Apple Developer Forums thread reports that `pointermove` from an Apple Pencil Pro looked segmented while `touchmove` drew smooth curves, which suggests lower pointer sampling (single forum report; **unverified** on current Safari) ([forums thread 776468](https://developer.apple.com/forums/thread/776468)).
- No pen-pressure or tilt documentation from WebKit was found. Pressure behaviour is taken from tldraw's own docs and source.

## Question 2: secure contexts, and what this app calls

### What MDN says

- `crypto.randomUUID()`: "This feature is available only in secure contexts (HTTPS)" ([MDN: Crypto.randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)).
- Clipboard: "Secure context: This feature is available only in secure contexts (HTTPS)", and "Writing to the clipboard can only be done in a secure context." Writes can throw `NotAllowedError` ([MDN: Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)). The page does not say whether a user gesture is required (**unverified** here; WebKit's own rule for pasting is not checked).
- Service workers: "Only secure contexts are allowed to register service workers" ([MDN: Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
- Potentially trustworthy origins are `https:`, `wss:`, `file:`, `127.0.0.0/8`, `::1`, `localhost` and `*.localhost`. The page does **not** list `.local` names or private IP ranges. Under this definition, `http://192.168.x.x` and `http://MBP-ALIANO.local` are not secure contexts ([MDN: Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
- Restricted-feature list: the page names "Async Clipboard API", "Service Workers", "Notifications API", "Web Share API", "Geolocation API" and `getUserMedia`. It does not name `crypto.randomUUID`, `crypto.subtle`, `crypto.getRandomValues`, `WebSocket` or `navigator.permissions`, and it does not name individual clipboard methods ([MDN: features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts)).
- `WebSocket` itself is not restricted in that list. `ws://` from an `http:` page is allowed, and `wss://` is needed from an `https:` page. The repo's socket URLs already follow this.

### What the app calls

`randomUUID` is the call that breaks first. It appears in a module-level line.

| API | Call site | Notes |
| --- | --- | --- |
| `crypto.randomUUID` | `packages/web/src/canvas/selectionReport.ts:13` | `const windowId = crypto.randomUUID();` runs when the module loads. The module is imported by `CanvasHost.tsx:4`. Over plain HTTP, the import would throw before any canvas code runs. |
| `crypto.randomUUID` | `packages/web/src/agent/store.ts:13` and `:266` | `newId` and `commandId`. Runtime calls, so they fail on use, not on import. |
| `navigator.clipboard.writeText` | `packages/web/src/settings/OutsideAgents.tsx:43`, `agent/transcript/PlanCard.tsx:32`, `agent/transcript/ChatMarkdown.tsx:28` and `:81`, `canvas/ContextMenu.tsx:148` and `:164` | On plain HTTP, `navigator.clipboard` is undefined, so `.writeText` throws a `TypeError` synchronously. |
| `navigator.clipboard.writeText` (optional chain) | `packages/web/src/hooks/useCopyToClipboard.ts:18` | `navigator.clipboard?.writeText(value).then(...)`. The optional chain short-circuits the whole chain, so this fails silently. |
| `navigator.clipboard.read`, `write`, `ClipboardItem`, `permissions.query('clipboard-read')` | `packages/web/src/canvas/ContextMenu.tsx:89-91` and `:160` | Paste from the context menu and copy a PNG. |
| `navigator.clipboard.write` (patched) | `packages/web/src/canvas/externalContent.ts:425-438` | Wraps `clipboard.write` after `if (!clipboard?.write) return`, so it is guarded. |
| `crypto.subtle` | none in `packages/web/src` or `packages/engine/src` | The engine uses `node:crypto` (`randomUUID`, `createHash`, `timingSafeEqual`). |
| `navigator.serviceWorker` | none found | No service worker registration. Not checked in the tldraw packages in full. |
| `getUserMedia`, `Notification`, `navigator.share`, `requestFullscreen` | none found | Searched in `packages/web/src`. |

### What tldraw calls

- Licensing: tldraw verifies the license key with `crypto.subtle` only when it is available. The docs say: "Keys are only verified when `crypto.subtle` is available. On plain HTTP in development, the browser doesn't expose it, so the SDK skips verification" ([tldraw docs: License key](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/license-key.mdx)). The source is `packages/editor/src/lib/license/LicenseManager.ts` (`this.isCryptoAvailable = !!crypto.subtle`), read through the GitHub search index in this pass.
- Copy and paste: tldraw's `copyAs` and clipboard utilities call `navigator.clipboard.write` and `writeText` and return "Copy not supported" when `navigator.clipboard` is missing ([`packages/tldraw/src/lib/utils/export/copyAs.ts`](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/export/copyAs.ts)). Copy inside tldraw degrades; the app's own calls do not.
- Sync: tldraw's `sync-core` names `crypto.randomUUID()` in server-side session ids and documentation comments. The client path was not traced in full (**unverified** whether the sync client calls it).
- Service workers: not checked in tldraw.

### Consequence

Over `http://<LAN IP>` or `http://<name>.local`, the app fails at module load (`selectionReport.ts`), and clipboard features fail. The LAN spec therefore needs HTTPS. Falling back to `getRandomValues` for `randomUUID` would let the page load, but the clipboard would still be missing, and it would be a patch to the app rather than a fix of the transport. Not recommended.

## Question 3: HTTPS on the LAN without Tailscale

### Option A: local CA with mkcert (recommended for a private LAN)

- mkcert creates a local CA and installs it in the system trust store on the Mac. It also covers Firefox, Chrome and Java, and it can issue certificates for hostnames and IP addresses. The example covers `localhost 127.0.0.1 ::1` ([mkcert README](https://github.com/FiloSottile/mkcert)).
- The CA file is `rootCA.pem`. It is shared to the iPad by AirDrop, email, or an HTTP server. The iPad installs it via "Settings > Profile Downloaded", then enables full trust ([mkcert README](https://github.com/FiloSottile/mkcert)).
- `rootCA-key.pem` "gives complete power to intercept secure requests from your machine". It must never leave the Mac ([mkcert README](https://github.com/FiloSottile/mkcert)).
- mkcert's README says it is for development and "should not be used on end users' machines" ([mkcert README](https://github.com/FiloSottile/mkcert)). That is a warning about the CA key, not a licence restriction on the LAN setup.

**iPadOS steps (Apple).**
1. Install the root CA profile on the iPad. Apple's page covers only the trust step: "Profiles you install manually, such as ones emailed to you or downloaded from a website, are not trusted for SSL/TLS by default, so you must enable trust yourself" ([Apple support 102390](https://support.apple.com/en-us/102390)).
2. Settings > General > About > Certificate Trust Settings. Turn on "Enable full trust for root certificates" for the root. Apple: "If 'Enable full trust for root certificates' doesn't appear, you haven't installed any additional certificates" ([Apple support 102390](https://support.apple.com/en-us/102390)).
3. Apple recommends Apple Configurator or MDM for deployment, which trusts SSL automatically ([Apple support 102390](https://support.apple.com/en-us/102390)). Not needed for one personal iPad.

**Certificate rules Apple enforces (iOS 13 and macOS 10.15 onwards).** Source: [Apple support 103769](https://support.apple.com/en-us/103769).
- RSA keys must be at least 2048 bits. The signature must be SHA-2.
- The server's DNS name must be in the SAN extension. "DNS names in the CommonName of a certificate are no longer trusted."
- Certificates issued after 1 July 2019 must include `id-kp-serverAuth` in Extended Key Usage.
- Validity must be 825 days or fewer, measured from NotBefore to NotAfter.
- The page does not mention IP-address SAN entries. Whether iOS accepts an IP SAN without a DNS SAN is **unverified** here. Put a `.local` DNS name in the SAN to be safe. mkcert issues the names passed on the command line.
- Plan for renewal before the 825-day limit. mkcert issues short certificates in its own default; its exact default validity was **not** read in this pass.

**WebSocket over TLS.** Once the page is served over HTTPS and the iPad trusts the chain, `wss://` should use the same trust decision as the page. This is the expected behaviour, but I did not find a source that states it for Safari on iPadOS. **Unverified**; test it on the device before the spec relies on it.

### Option B: a real certificate for a name that only resolves on the LAN

- Let's Encrypt's DNS-01 challenge works for names whose web servers are not public: "You can use this challenge to validate domain names whose webservers aren't exposed to the public internet." The name must resolve through DNS, and a TXT record is set through the DNS provider's API ([Let's Encrypt: challenge types](https://letsencrypt.org/docs/challenge-types/)).
- Trade-offs seen in the source: the setup is harder than HTTP-01; the DNS provider needs an API; propagation can take "often as much as an hour"; and the page warns that "Keeping API credentials on your web server is risky" ([Let's Encrypt: challenge types](https://letsencrypt.org/docs/challenge-types/)).
- Trade-offs not in the fetched source (general knowledge, not verified in this pass): the name and its certificate appear in public Certificate Transparency logs, which reveals the hostname (though not the LAN IP unless the DNS record holds it); a registered domain is required; and renewal needs automation on the Mac.
- Let's Encrypt cannot validate IP addresses with DNS-01. IP-address certificates are available, but they must use the short-lived profile (160 hours), and only HTTP-01 or TLS-ALPN-01 validate them. The HTTP-01 route needs the Mac reachable on port 80 from the internet ([Let's Encrypt: IP address certificates GA](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)). So an IP certificate for a LAN host does not fit without exposing the host.
- Whether Let's Encrypt issues for `.local` names is **not stated** in the fetched pages, and `.local` is not a publicly resolvable name, so do not assume it (**unverified**).

### Option C: Tailscale (excluded by the person)

Recorded for completeness: `tailscale serve` already gives the dev share an HTTPS name (`scripts/dev.ts`). It is what the person wants to avoid.

### Option D: no HTTPS, accept the gaps

Not viable for this app. Section 2 shows the clipboard and the module-load `randomUUID` break first. Separately, Wi-Fi traffic in plain HTTP can be read by anyone on the same network, which matters for any pairing token (Question 6). This is general knowledge, not from a fetched source.

## Question 4: reaching the Mac by name, and the macOS firewall

**Local hostname.** Apple: the local hostname is the computer name with `.local` added and spaces replaced by hyphens. It is shown at the bottom of Sharing settings and can be edited there. If another Mac on the network has the same name, a number is added ([Apple: Change your computer's local hostname](https://support.apple.com/guide/mac-help/change-computers-local-hostname-mac-mchlp2322/26/mac)). On this Mac the value is `MBP-ALIANO` (`scutil --get LocalHostName`, run here). Candidate URL: `https://MBP-ALIANO.local:<port>`.

**Does iPadOS Safari resolve `.local`?** Not confirmed from a primary source. A MacRumors thread (macOS 10.8 era) reports `name.local` failing while the IP worked (anecdotal). Trend Micro says iOS and iPadOS often cannot reach `.local` names in some organisational DNS setups (vendor troubleshooting, not Apple guidance) ([Trend Micro](https://docs.trendmicro.com/en-US/documentation/article/trend-vision-one-pa-not-connect-ios-ipados)). **Unverified** on a home network. A spec should keep an IP fallback and test the `.local` name on the target router.

**The IP changes.** A DHCP lease can change, so a certificate that names only a LAN IP can break. A `.local` SAN plus the Mac's Bonjour name avoids that, but only if the iPad resolves `.local` (see above). Pinning a DHCP reservation in the router is a user step, not something the app can do.

**macOS firewall.** Apple: when an app not in the firewall list receives a connection attempt, "an alert message appears asking if you want to allow or deny the connection over the network or internet". Until the person answers, "any attempts to connect to the app are denied" ([Apple: Firewall on Mac](https://support.apple.com/guide/mac-help/mh34041/mac)). So the first LAN connection to the engine would fail until the person clicks Allow.
- The Apple page did not describe the "Automatically allow built-in software" or "Automatically allow downloaded signed software" options. Whether a Node binary (rather than a signed Electron app) is exempt is **unverified**.
- Whether the firewall is on by default on the person's Mac is **unverified**.

## Question 5: Node and Electron listening on a LAN interface

**Binding.** Node's `net.Server.listen` takes a `host`. Per the Node docs:
- If `host` is omitted, the server accepts connections on `::` when IPv6 is available, else `0.0.0.0` ([Node.js: net](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)).
- Binding `::` on most systems also accepts IPv4 connections (dual-stack). `ipv6Only: true` turns that off ([Node.js: net](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)).
- Binding a specific LAN address (for example `host: '192.168.1.20'`) accepts only that interface. This is the narrowest option and needs a rebind if the address changes.

**Enumerating LAN addresses.** `os.networkInterfaces()` returns each interface's addresses. Each entry has `family` (`'IPv4'` or `'IPv6'` as a string since Node 18.4), `internal` (true for loopback), `address` and `netmask` ([Node.js: os](https://nodejs.org/api/os.html#osnetworkinterfaces)). A LAN listener filters `family === 'IPv4' && !internal`. Note that the `family` string was numeric in Node 18.0 to 18.3 (same source).

**Repo facts.** `packages/engine/src/listen.ts` hard-codes `host: LOOPBACK_HOST` with `exclusive: true` and says "There is no option to widen the bind". A LAN spec must replace this, and contract 1 and the published bundle layout (spec 01) must say so. The engine also prints `http://localhost:<port>` in its banner (`packages/engine/src/engine.ts:66`). The banner is part of the hosting contract, so changing it is a public change.

**Forked process.** The engine runs as a forked process from the desktop shell. A forked Node child calls `listen` the same way as a standalone process (Node docs; no Electron-specific API is needed). The contracts say the engine never imports Electron (spec 01 Out of Scope). The desktop shell does not need a change for the listener itself, but it must know the LAN address to show it (**unverified** whether the shell's IPC allows this).

**macOS Local Network privacy.** Apple TN3179 ("Understanding local network privacy") is the primary source. The page body did not load in this pass, so the rules for **listening** sockets versus outbound connections, and for Electron and child `node` processes, are **unverified** ([Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)). A developer forum summary of TN3179 says macOS automatically allows local network access for daemons started by launchd, programs run as root, and command-line tools run from Terminal or over SSH ([Apple Developer Forums search summary](https://developer.apple.com/forums/thread/762848)). That summary is secondary and not verified against the technote. The same summary says the prompt is tied to code signing and the main executable (secondary). A spec should expect a Local Network prompt on first launch and test it on the target macOS version.

## Question 6: pairing and auth in comparable tools

**code-server (VS Code in a browser).** Source: [code-server guide](https://coder.com/docs/code-server/guide).
- "By default, code-server uses password authentication." It "listens on `localhost`" by default.
- Rate limit: "two per minute plus an additional twelve per hour."
- "Never expose code-server directly to the internet without some form of authentication and encryption, otherwise someone can take over your machine via the terminal."
- For HTTPS, a certificate makes code-server respond to HTTPS and redirect HTTP to HTTPS. Self-signed certificates are a "last resort".
- The guide's suggested remote access is SSH port forwarding or a reverse proxy with its own auth.

**Jupyter Server (token).** Source: [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html).
- Token auth is "on by default". A token is generated and logged to the terminal.
- The token can be sent as an `Authorization: token ...` header, as a URL parameter (`?token=...`), or typed into the login form.
- After the first visit, "a cookie will be set in your browser and you won't need to use the token again" (cookie name and flags not given).
- Disabling auth is "NOT RECOMMENDED". Because the token sits in the URL, it may end up in browser history or logs (the page does not say this; reasoning from general knowledge).

**VS Code serve-web / server connection token.** The pages fetched (`code.visualstudio.com/docs/remote/vscode-server` and `vscode-web`) did not describe `--connection-token`. **Unverified**. The VS Code Server page says "an instance of the server is designed to be accessed by a single user".

**Home Assistant, Syncthing, and QR pairing flows.** Not fetched in this pass. **Unverified**.

**The repo already has a token pattern.** Spec 14's connection tokens, in `packages/engine/src/agentConnections/book.ts`, use `randomBytes` for the secret, `createHash` for storage, and `timingSafeEqual` for the comparison. Spec 07's per-session MCP bearer token is in `packages/engine/src/agent/mcp.ts` (`randomBytes`, `timingSafeEqual`). A LAN pairing can reuse the same shape: a one-time or revocable token made in Settings, shown as a QR code or typed, then exchanged for a cookie.

**Cookie vs URL token, and the plain-HTTP problem.**
- The Jupyter pattern (URL token once, then cookie) fits a pairing screen on the Mac. Once the device has the cookie, the URL no longer carries the secret.
- Over plain HTTP, both the token and the cookie cross the Wi-Fi in clear text. Setting the `Secure` cookie attribute does not help without HTTPS, because the browser will not send a `Secure` cookie over `http:` (general knowledge, not fetched; **unverified** here). So pairing and auth depend on HTTPS (Question 3). Pairing over plain HTTP would leak the secret to anyone on the network.
- The loopback guard's `Host` and `Origin` rules would have to change for LAN requests. A LAN spec then has to answer what replaces them: a valid token, a valid origin list (the Mac's LAN name), or both (**design question, not answered here**).

## Question 7: prior art

- **Excalidraw.** The official docs for development say to open `http://localhost:3000`. For collaboration, "you will need to set up collab server in local". Self-hosting "doesn't support sharing or collaboration features" ([Excalidraw docs](https://docs.excalidraw.com/docs/introduction/development)). No LAN or HTTPS guidance for other devices was found. Excalidraw's own hosted app is HTTPS on a public domain, so it is not a LAN precedent.
- **tldraw.** tldraw's sync and its hosted examples run over HTTPS on public domains (the sync-cloudflare template). No LAN guide was found in the docs. The licence rules (below) apply to any non-localhost host.
- **code-server and Jupyter.** Covered in Question 6: password or token auth, not exposed without encryption, reverse proxy or SSH for remote use.
- **Obsidian, Logseq, and other note apps.** Not checked in this pass. **Unverified**.

## Licence risk specific to this app

tldraw's licence docs say:
- Development: "the protocol is not HTTPS, the hostname is `localhost` or a loopback address (`127.x.x.x`, `::1`), or `NODE_ENV` is not `'production'`".
- Production: "HTTPS on a non-loopback domain with `NODE_ENV=production`" requires a valid key. "Without one, the SDK logs errors to the console and, after five seconds, stops rendering the editor."
- Domain check: "License keys specify which domains they work on." A mismatch logs "License key is not valid for this domain".
- Hobby keys keep the watermark. Hobby and trial keys "ping tldraw's servers with the license ID, license type, SDK version, build environment, and deployment URL". Nothing is sent from development environments ([tldraw docs: License key](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/license-key.mdx)).

Consequences for a LAN spec:
- Plain `http://<LAN IP>` counts as development under tldraw's rule (not HTTPS), so no key check runs there. But that is also the case where the app fails on `randomUUID` (Question 2).
- HTTPS on `https://MBP-ALIANO.local` is a non-loopback domain. If the build runs with `NODE_ENV=production`, the key must list that host. Whether the hobby key's host list covers `.local` or an IP is **unverified**. The person should check this on their key (without printing it), since a mismatch stops the editor after five seconds.
- A LAN deployment would also send the deployment URL in the hobby ping. This is a LAN URL, which is not sensitive, but a spec should say so.
- Contract 3 (the watermark stays visible) is not affected by any option here.

## Repo references

- Loopback guard: `docs/specs/01-engine-foundation.md` ("Loopback guards"), `docs/specs/00-index.md` ("Contracts no spec may break", 1)
- Bind: `packages/engine/src/listen.ts`
- Guard usage and banner: `packages/engine/src/engine.ts:66`
- Web socket URL: `packages/web/src/rpc/engine.ts:53`, `packages/web/src/canvas/CanvasHost.tsx:53-55`
- Module-level `randomUUID`: `packages/web/src/canvas/selectionReport.ts:13`
- Clipboard calls: `packages/web/src/canvas/ContextMenu.tsx`, `packages/web/src/hooks/useCopyToClipboard.ts`, `packages/web/src/settings/OutsideAgents.tsx`, `packages/web/src/agent/transcript/PlanCard.tsx`, `packages/web/src/agent/transcript/ChatMarkdown.tsx`
- Connection tokens: `packages/engine/src/agentConnections/book.ts`, `packages/engine/src/agent/mcp.ts`
- Dev share: `scripts/dev.ts`, `docs/specs/01-engine-foundation.md` ("Dev share relay")

## Unverified, and how to check

1. Whether Safari on iPadOS resolves `MBP-ALIANO.local` on the target home network. Test on the device.
2. Whether iOS accepts a certificate whose only SAN is an IP address. Avoid by using a `.local` DNS SAN.
3. The TN3179 rules for listening sockets, Electron, and child `node` processes. Read the page in a browser, then test the first-launch prompt on the target macOS version.
4. Whether `wss://` uses the same trust as the page on iPadOS Safari after a manual profile install. Test.
5. Whether the hobby licence key's host list covers a `.local` name. The person checks against tldraw (`sales@tldraw.com` per the docs). Do not paste the key into this repo.
6. Whether iPadOS desktop-class Safari sends a `Macintosh` user agent, which would make `tlenv.isIos` false.
7. Whether tldraw's sync client calls `crypto.randomUUID` on the page, and whether tldraw's `WebSocket` needs anything beyond `ws:`/`wss:`.
8. The VS Code connection-token rules (the pages fetched did not cover them).
9. Default validity used by mkcert. The Apple limit is 825 days.
10. Whether the macOS firewall is on by default on the target Mac, and whether a Node binary is exempt from the firewall prompt.

## Open questions for the person

1. Is a local CA on the Mac and a one-time profile install on the iPad acceptable? It is the only option without Tailscale and without public exposure.
2. Is the Mac always reachable at a fixed name, or must the iPad use an IP address that can change?
3. Should the LAN listener accept only the iPad, through a pairing step, or any device on the home network?
4. Which tldraw licence host list applies? The person should confirm on their key.
5. Is `NODE_ENV=production` used for the hosted build that would serve the LAN client?
