# RS-3043 — One command for the layout service and the app

## Why

Before this, the user had to start `services/strass-layout/scripts/start_layout.sh` by hand and set
`LAYOUT_SERVICE_URL` in `.env`. When either was forgotten, every Image → Strass redraw was placed
with the old method, and the app named only the setting. The iMac is also PatternNifty's backup
machine; PatternNifty's own strass service uses port 8000, so RS must not.

## What changed

- **Port.** `start_layout.sh` reads `LAYOUT_PORT` (environment only, default 8001) and refuses a
  value that is not a port number before anything starts. `.env.example` sets
  `LAYOUT_SERVICE_URL=http://127.0.0.1:8001`. The Docker image still serves 8000 inside the
  container; publish it on another host port where 8000 is taken.
- **Service identity.** `GET /health` adds `"service": "rhinestone-studio-layout"`. With
  `version` (`strass_layout.__version__`), it lets the studio tell RS's service from another one on
  the same port. No layout rule changed.
- **`npm run studio`** (`tools/studio.mjs`, no dependency; `npm run dev` unchanged):
  1. stops at once if the dev server's port (5173) is taken;
  2. asks `GET /health` on the layout port. RS's service with this checkout's version is reused
     and left running when the studio stops. Anything else that answers there (another service, a
     non-JSON page, a port that accepts but does not answer within 3 s, or an older RS version)
     stops the studio with a message naming the port;
  3. otherwise starts `start_layout.sh` under `caffeinate -i` (macOS) and prints "Starting the
     layout service on port 8001..."; it waits for `ok` and `modelsLoaded`, up to 180 s, and
     otherwise stops the service and says so;
  4. starts `tools/dev-server.mjs` with `LAYOUT_SERVICE_URL` set to `http://127.0.0.1:<port>`,
     which wins over `.env`.

  Each child runs in its own process group, so Ctrl+C reaches only the studio. The studio then
  stops each whole group (SIGTERM, then SIGKILL after 10 s), so caffeinate, uvicorn and the dev
  server all go. If either child stops on its own, the studio stops the other and says which one
  stopped, with its exit code.
- **App message.** When the layout service is not set or not answering, the job's
  `layout-unavailable` message names the fix, and the app shows it after "Placed with the old
  method:":
  - "The layout service is not set up. Start Rhinestone Studio with npm run studio (or set
    LAYOUT_SERVICE_URL)."
  - "The layout service at `<url>` is not answering. Start the layout service, or start Rhinestone
    Studio with npm run studio."

  The dev server's start-up line for a missing URL says the same.
- **Docs.** The root README's start section now gives `npm run studio` first and the manual way
  second. The service README, `docs/ARCHITECTURE.md`, `docs/release-process/release-gate.md`,
  `docs/IS-PORT-PLAN.md` and the IMG-026 spec now say 8001.

## Tests

- `tools/test-rs-3043-studio.mjs` (integration group) runs real child processes:
  - a fake layout service that answers ok, answers as a different service, never answers, crashes
    before it is ready, or dies after start;
  - a fake dev server that records its `LAYOUT_SERVICE_URL`;
  - a hand-started RS service, which is reused, and an older version, which is refused;
  - a taken dev port and a bad `LAYOUT_PORT`;
  - a real SIGINT to a studio process, whose layout service is a grandchild behind a shell;
  - `start_layout.sh` itself, against a fake venv: port 8001 by default, `LAYOUT_PORT`, and a bad
    value.
- `tools/test-img-026-ai-layout-app.mjs` test 7 feeds the real `callLayoutService()` errors (no
  URL, and a refused connection on a closed port) through app.js's `startImageRedraw()`.
- `tools/test-img-026-redraw-jobs.mjs` tests 5 and 15 pin the new messages and the
  `.env.example` line.
- `services/strass-layout/tests/test_contract.py` `test_health` pins the `service` field.

## Checked on the iMac

- `npm run studio` while 5173 was taken by a running `npm run dev`: it stopped at once with the
  port message and started nothing.
- `LAYOUT_PORT=8002 node tools/studio.mjs 5174` started the real service and the dev server. A
  redraw in Chrome then ran a real layout on that service: 833 stones, 0 violations, 54 s.
  `REDRAW_FAKE` skips the layout service, so it could not be used. Instead a `NODE_OPTIONS=--import`
  stub in the dev server answered the one `api.openai.com` call with
  `prototype/img/N2_logo.png` and refused any other non-local request. Its log shows 1 stubbed
  OpenAI call, 1 layout POST and the health checks, and nothing else. After SIGINT, nothing was
  left on 8002 or 5174, and no caffeinate, uvicorn or dev server from that run was left.
- `node tools/studio.mjs 5174` with an RS service already running on 8001 reused it. After SIGINT,
  that service was still running and 5174 was free.
