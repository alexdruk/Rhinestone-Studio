# RS-3046 — Layout service control and the tinted result in the Image → Strass lightbox

## Why

RS-3043 made `npm run studio` start the layout service with the app. With `npm run dev` alone the
service still had to be started by hand, and the lightbox did not say whether it was running: a
forgotten service showed only after a redraw, as "Placed with the old method". The redraw's result
was also shown as plain stones (Template), while the 2D canvas already had IMG-026Q's Tinted view,
which looks like the finished piece.

No layout rule, provider call, stone or saved field changes. Docker is not used.

## Part 1: layout service control

### Dev server routes (`tools/layout-control.mjs`, wired in `tools/dev-server.mjs`)

Both answer only to requests from this Mac: the socket's address is loopback (127.0.0.0/8, ::1),
the Host header names localhost, 127.0.0.1 or [::1] (no DNS rebinding), and a browser's Origin, if
sent, is this server's own (no other web page). Anything else gets 403
`{ error: "forbidden" }`. They are on whether or not Redraw with AI is set up.

- **`GET /api/layout-service/status`** reads `LAYOUT_SERVICE_URL/health` with RS-3043's
  `probeLayoutService()` (service name `rhinestone-studio-layout`, this checkout's version) and
  answers `{ used, state, label, reason, url, startTimeoutMs, canStart, startedHere }`:

  | state | label | when |
  | --- | --- | --- |
  | `ready` | Ready | RS's service, this version, models loaded, not busy |
  | `busy` | Busy | the same, `busy` true (a layout runs; the next waits) |
  | `starting` | Starting | RS's service answering with models not loaded, or a service this dev server started that does not answer yet (uvicorn opens its port only once the models are loaded) |
  | `not-running` | Not running | nothing answers; or no URL; or a remote host that cannot be reached; or the service this dev server started stopped or timed out (the reason says which) |
  | `wrong-service` | Wrong service | another service answers there, or an older RS version |

  In fake mode (`REDRAW_FAKE=1`) it answers `{ used: false, reason }`: no layout service is used.
  `probeLayoutService()` now also returns `busy`, and `unreachable` (the error code) for a failed
  connection that is neither a refusal nor the 3 s limit; RS-3043's results are otherwise unchanged.

- **`POST /api/layout-service/start`** starts the service only when `LAYOUT_SERVICE_URL` is
  `http://127.0.0.1:<port>` or `http://localhost:<port>` and nothing answers there. It runs
  `services/strass-layout/scripts/start_layout.sh` under `caffeinate -i` (macOS) with
  `LAYOUT_PORT=<port>`, in its own process group, through `tools/studio.mjs`'s own
  `defaultLayoutCommand()`, `startChild()` and `stopChild()` (now exported, not copied). It then
  watches it as the studio does: ready, stopped (with its exit code), another service, or not ready
  within `START_TIMEOUT_MS` (180 s, the studio's), in which case it is stopped.
  - 202 and the status (Starting) when it started the service;
  - 200 and the status when RS's service already answers or is already starting (nothing is
    started; two clicks start one service);
  - 409 `{ error, message }` for `wrong-service` (another service or an older RS on the port),
    `remote` (a URL on another machine), `no-port`, `not-set` and `not-used` (fake mode).

- **Stopping.** The dev server stops the service it started when it gets SIGINT, SIGTERM or SIGHUP,
  then ends by the same signal (so `npm run studio`'s exit message is unchanged); on any other exit
  it sends SIGTERM to that group without waiting. A service started by hand or by `npm run studio`
  is never stopped by it.

### Lightbox (`src/redraw/LayoutServiceMonitor.js`, `app.js`, `index.html`)

- An indicator above the redraw buttons: a dot, "Layout service: <state>", **Check**, the reason on
  hover and below it, and **Start layout service** when it is Not running or Wrong service. It shows
  only where a redraw provider is set up and the server uses the layout service (not in fake mode, not
  on a server without these routes).
- **Opening the lightbox** reads the state. When it is Not running the app asks the dev server to
  start it at once (the indicator goes straight to "Starting…"), then reads the state every 3 s
  until it is no longer Starting, giving up after the dev server's `startTimeoutMs` (180 s, as
  `npm run studio`). A refused or failed start shows the button and the dev server's message.
  Check re-reads the state and never starts anything; closing the lightbox stops polling.
- **The redraw button.** While the service is **Starting** the button waits: it is disabled, and the
  reason says it waits until the service is ready. While it is **Not running** or **Wrong service**
  the button's text says the result will use the old method ("Redraw with AI (old method)",
  "Try again (old method)") and the reason says the same. Ready, Busy (a layout queues in the
  service) and an unknown state leave it as before.

  Why both: RS's rules put production correctness first and ask for clarity. A service that is
  Starting will be ready in about a minute, so waiting costs little and avoids paying for a redraw
  whose stones would be placed with the old method. A service that is not running may never come
  (start refused, remote, another service), so blocking the button would leave the user stuck; the
  honest label lets them choose. The rule lives in `imageStudioState()` (`redrawLabel`,
  `redrawWaits`, `oldMethod`), next to the other "who sees what" rules; `redrawButton` still names
  the action, so "Try again" keeps asking before it discards manual edits.

## Part 2: the tinted view in the result

- The lightbox's view toggle gains **Tinted**, shown for an ai-layout layer (`views.tinted`). A
  redraw that comes back with a layout now ends on Tinted (it ended on Template), and the lightbox
  opens an ai-layout layer on Tinted. **Template** (the plain stones) and **Source** (the original
  image) are the switch; AI image and Overlay stay.
- The view is IMG-026Q's renderer, unchanged (`TintedViewCache` from `src/renderer/TintedView.js`),
  through a cache of its own so the 2D canvas's tinted bitmap is kept. Black & white layers
  (`redrawLookOf(l).mode === 'bw'`) use the crystal gap rule, Colour layers do not, the same rule
  as the 2D canvas. The open gaps show the 2D canvas's Tinted white. Gap violations keep their red
  rings. While the bitmap renders in slices the plain stones show, then the studio redraws.
- It is a view only: it reads the layer's stones from the StoneLayout and never creates, moves or
  resizes one; the choice is not saved, not in history, and not in any export (exports copy the 2D
  canvas through `withoutTintedView()`, unchanged; the studio canvas is in none).
- The result's stats (Stones, Sizes, Colours, Bounding box, Min gap, Gap violations, Coverage,
  Enlarged) and buttons are unchanged.

## Tests

- `tools/test-rs-3046-layout-service-control.mjs` (integration): loopback, Host and Origin
  checks; every status state and reason; start with a local URL (202, then Ready, one service for
  two clicks), reuse of a running RS service (200, nothing started, left running), refusal of another
  service, a remote URL, no port, no URL and fake mode; a service that crashes or never answers;
  the real dev server, started from a copy of `tools/` whose real `start_layout.sh` (under
  `caffeinate -i`, checked in `ps`) finds a fake venv: SIGINT and SIGTERM stop the service it
  started before it exits, and a hand-started service is left running.
- `tools/test-rs-3046-lightbox.mjs` (integration): the monitor against a scripted dev server
  (Not running → Starting… → Ready with 3 s polls, refused and failed starts with the button, giving
  up at the limit, Check, close, fake mode, 404) and against the real routes over HTTP with a fake
  service process; `imageStudioState()`'s button rule; app.js's `syncImageRedrawControls()`,
  `renderLayoutServiceIndicator()`, `openLayoutServiceIndicator()` and `showTintedForAiLayout()`,
  run; `renderImageStudio()` from app.js run for real on both fake layouts (Colour and Black &
  white): Tinted draws the bitmap with the right gap rule, Template and Source switch away, and the
  StoneLayout, the layer and the project are unchanged, with no history step or autosave.
- `tools/test-img-026-lightbox.mjs`: test 1 adds the new state fields; test 9 now expects
  Source then Tinted.

## Checked on the iMac (4 Nov 2026, Chrome, headless)

The user's own ports (5173, 8001) were not used. The OpenAI call was stubbed in the dev server with
RS-3043's `NODE_OPTIONS=--import` stub (with a dummy key and access code in the environment), and
the layout service was the real one.

- **`npm run dev` with no layout service** (`node tools/dev-server.mjs 5174`,
  `LAYOUT_SERVICE_URL=http://127.0.0.1:8002`). Opening the lightbox went straight to "Starting…",
  and "Redraw with AI" stayed disabled. The dev server started `caffeinate -i start_layout.sh` on
  port 8002, and the indicator reached Ready 25 s later. Check kept it Ready.
  - A Colour redraw, then a Black & white one, each took 51 s: 833 stones, 0 violations. Each
    result opened on Tinted, and Template, Source and Tinted again each drew a different picture.
    The layer's `aiLayout` and its StoneLayout stones were identical before and after switching
    views.
  - The stub log shows 2 stubbed OpenAI calls, 2 layout POSTs and the health checks, and nothing
    else.
  - Ctrl+C (SIGINT) to the dev server stopped uvicorn and caffeinate. Port 8002 was free, and the
    dev server ended by the signal.
- **`npm run studio`** (`LAYOUT_PORT=8003 node tools/studio.mjs 5175`). The lightbox's first
  state was Ready, with no Starting.
- **Every product** (Mug, Straight Tumbler, Bottle, Round Dinner Plate, Flat Sheet), with the
  Black & white ai-layout layer imported. The lightbox opened on Tinted with the indicator Ready;
  the switch worked and the stones were unchanged. The only console error was the favicon 404 that
  predates this milestone.
