# IMG-022 — Redraw provider

**Status: spec.** File:line citations are against `develop` @ `aade23f` (the RS-3041 merge). Every
anchor below was re-grepped on that tip. No implementation code exists yet.

## Objective

Image → Strass gets an optional **Redraw with AI** step. It sends the selected image layer's source
image to a *redraw provider* and gets back a flat, stone-scale illustration. That illustration
becomes the layer's `imageSrc`, and the existing image pipeline runs on it unchanged:
`GeometryEngine.generateImageLayout()` still makes every stone, and nothing downstream of
`layer.imageSrc` learns that a redraw happened.

The first provider calls OpenAI through a small server we host. A later milestone adds a second
provider that runs our own model in a browser Web Worker. This spec keeps that swap to one edited
file (`src/redraw/index.js`) plus the new provider's own file.

## Measured figures (why the redraw sets vividness 1.0)

Provenance: Claude's scratch run of `GeometryEngine.generateImageLayout()` on `develop` @ `aade23f`.
The inputs were two OpenAI Variant 1 outputs (the prompt in D6), 1254 × 1254 RGBA PNGs. The images
are not committed to the repo. Every other input was the import default: subject mask, transparent
`ignore`, max 400 px, staggered, SS6 (`stoneSize: 2`), gap 0.3 mm, fill gaps on, Auto colour count.

| Image | Width | Vividness 1.0 | Vividness 1.4 |
|---|---|---|---|
| Einstein | 157 mm | 4,152 stones, no Topaz | 4,152 stones; 494 turn Topaz, Light Colorado Topaz drops from 633 to 202 |
| Butterfly | 130 mm | 2,043 stones, no Peridot | 2,043 stones; 38 Peridot appear |

A redrawn image is already flat and saturated. The import default of 1.4 (`app.js:5550`) boosts it
again, which pushes skin and background tones into colours that are not in the picture. So the redraw
sets `vividness` to 1.0 (D9). These figures support the vividness choice only. They were taken at
157 mm and 130 mm, not at D9's 160 mm, and from 1254 px images, not the 1024 px the server requests
(D5). Stone count depends on the millimetre size and the 400 px working size, not on the source size.

## Decisions

These were settled before this spec was written. They are recorded here and not reopened. Where
this spec adds detail a decision leaves open, the detail is marked **(spec)**.

### D1. Contract

New folder `src/redraw/`. There is one interface:

```js
redrawImage({ dataUrl, signal }) // → Promise<{ dataUrl, providerId, model, promptVersion }>
```

Failures reject with a `RedrawError` (an `Error` subclass exported from `src/redraw/index.js`) whose
`code` is one of:

| Code | Meaning |
|---|---|
| `not-configured` | No provider is available, or the server says redraw is not set up (404). |
| `unauthorized` | The access code is missing or wrong (401). |
| `rate-limited` | Our hourly limit (429), or OpenAI's own rate limit. |
| `network` | Our server could not be reached (`fetch` rejected, not by abort). |
| `provider-failed` | The provider answered with a failure, including OpenAI 4xx/5xx after the retry, an OpenAI timeout after the retry, and a content-policy refusal. |
| `invalid-output` | The returned image did not decode or failed the opacity check (D7), twice. |

**(spec)** Cancelling is not an error code. An aborted `signal` rejects with the platform's
`AbortError` `DOMException`, unchanged, and the UI reports it as a cancel (D11).

`app.js` talks only to `src/redraw/index.js`. It never imports a provider file and the string
`OpenAI` never appears in `app.js`. `test-architecture-module-boundaries.mjs` test "app.js only
imports … permanent-module barrels (src/*/index.js)" already allows `./src/redraw/index.js` and
forbids a direct provider import, so no new boundary rule is needed.

**(spec)** `src/redraw/index.js` exports exactly:

* `redrawImage({ dataUrl, signal })`: the D1 contract. It prepares the upload (D7), calls the active
  provider, validates the output (D7) and retries once on `invalid-output`.
* `getRedrawAvailability()`: resolves `{ available: false }` or
  `{ available: true, providerId, consent }`, where `consent` is `null` (a provider that uploads
  nothing needs no consent) or `{ recipientName, costLabel, needsAccessCode }`. It runs provider
  selection (D2) once and caches the result.
* `setRedrawAccessCode(code)`: the code the active provider sends. `app.js` owns remembering it (D8).
* `RedrawError`, `REDRAW_ERROR_CODES`.
* `configureRedraw({ fetch, decodeImage, encodePng, provider })`: test and wiring injection. Any
  field left out keeps its default (`globalThis.fetch`, `decodeDataUrlToBuffer()` from
  `src/image/index.js`, a canvas PNG encoder, and D2's selection). Passing `provider` skips
  selection. `configureRedraw()` with no arguments resets everything, including the cached
  selection.

The consent text comes from `consent.recipientName`, so `app.js` shows "OpenAI" without containing
it, and a Worker provider that returns `consent: null` needs no `app.js` change.

### D2. Providers

* `src/redraw/OpenAiProxyProvider.js` posts to `/api/redraw` (wire format below). Its
  `consent` is `{ recipientName: 'OpenAI', costLabel, needsAccessCode: true }`, with `costLabel` taken
  from the config response.
* `src/redraw/FakeRedrawProvider.js` returns a fixed image for tests. **(spec)** It exports
  `FAKE_REDRAW_DATA_URL`: a 64 × 64 RGBA PNG (colour type 6) that is transparent except for a
  filled disc of radius 24 px in Jet `#141414` centred at (32, 32). About 44% of its pixels are
  opaque, so it passes D7. The build generates the bytes once with a scratch script and pastes the
  base64 in; no image file is added. Its `providerId` is `'fake'`, its `model` is `'fake'` and its
  `consent` is `null`.

A provider is a plain object:
`{ id, consent, redraw({ pngDataUrl, accessCode, signal }) → Promise<{ dataUrl, model, promptVersion }> }`.
`index.js` adds `providerId` to the result.

**Selection** happens in `src/redraw/index.js` from `GET /api/redraw/config`. A 200 response with a
JSON body `{ providerId: 'openai-proxy', costLabel }` selects `OpenAiProxyProvider`. Any other
outcome (404 on a static host, any other status, a network failure, a body that is not that shape)
means no provider, and the **Redraw with AI** button stays hidden.

A future `WorkerRedrawProvider` plugs in at this same selection point: `index.js` imports it and
picks it (for example when the config request fails and the Worker model is present). That edit to
`index.js` and the provider's own file are the whole swap. `app.js`, the layer transform and the UI
do not change.

**(spec) Wire format.** Request: `POST /api/redraw`, `Content-Type: application/json`, header
`X-Redraw-Access-Code: <code>`, body `{ "image": "<data:image/png;base64,…>" }`. Success: 200,
`{ "dataUrl": "data:image/png;base64,…", "model": "<model>", "promptVersion": 1 }`. Failure: the
status below with `{ "code": "<RedrawError code>", "message": "…" }`. The client maps 404 to
`not-configured` and uses `body.code` for every other failure status. An unparseable failure body
maps to `provider-failed`.

### D3. Server

New folder `server/redraw/` with three files:

* `env.mjs`: a tiny `.env` reader of our own (`KEY=value` lines, `#` comments, optional surrounding
  quotes, no expansion). Values already in `process.env` win over the file. It exports
  `loadRedrawEnv({ env = process.env, envFileText })` → the settings in D4 with defaults applied.
* `prompt.mjs`: `PROMPT_VERSION` and `buildRedrawPrompt()` (D6).
* `handler.mjs`: `createRedrawHandler({ settings, fetch = globalThis.fetch, now = Date.now, timeoutMs = 120000 })`
  → `{ handleConfig(req, res), handleRedraw(req, res) }`. The injectable `fetch`, `now` and
  `timeoutMs` mean tests never touch the network or wait on real time.

No new npm dependencies. The server uses Node 18+ globals `fetch`, `FormData` and `Blob`.

`tools/dev-server.mjs` mounts `GET /api/redraw/config` and `POST /api/redraw` only when redraw is
configured. **(spec)** "Configured" means both `OPENAI_API_KEY` and `REDRAW_ACCESS_CODE` are
non-empty, because D4 marks both as required. Otherwise both routes answer 404 and the server
logs one line at start-up saying redraw is off and which variable is missing (never a value).
Everything else the server does stays as it is: every other `POST` is still 405, every response
keeps `Cache-Control: no-cache, no-store`, and static files are served as before.

Its header comment currently says "Dev only -- the app itself never loads or depends on this file"
(`tools/dev-server.mjs:4`). That stops being true for redraw, so the build rewrites it to: the static
server plus the optional redraw routes; the app works without them (the button stays hidden); and
the file is still not a production host (production hosting is a non-goal, D12).

**(spec) Request handling in `handleRedraw`:**

1. The `X-Redraw-Access-Code` header must equal `REDRAW_ACCESS_CODE`, compared with
   `crypto.timingSafeEqual` on equal-length buffers. Otherwise 401 `unauthorized`.
2. Rate limit (D4): otherwise 429 `rate-limited`.
3. The body is read with a 20 MB cap (413 `provider-failed` above it). It must be JSON with an
   `image` string starting `data:image/png;base64,`. Otherwise 400 `provider-failed`.
4. `REDRAW_FAKE=1` returns 200 with `FAKE_REDRAW_DATA_URL` imported from
   `src/redraw/FakeRedrawProvider.js` (one fixture, one source), `model: 'fake'`, and makes no
   OpenAI call.
5. Otherwise it calls OpenAI (D5). If the client connection closes first, the handler aborts the
   upstream request, so Cancel does not leave a paid call running.

### D4. Settings

Read from the environment, then `.env` (already ignored, `.gitignore:13`). Every variable is
documented in a new tracked `.env.example`, with no real values.

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | none, required | Server-side only. Never sent to the browser or logged. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Sent as `model`. |
| `OPENAI_IMAGE_QUALITY` | `medium` | Sent as `quality`. |
| `REDRAW_ACCESS_CODE` | none, required | Requests without a matching `X-Redraw-Access-Code` header get 401. |
| `REDRAW_RATE_LIMIT_PER_HOUR` | `20` | In memory, per client IP. |
| `REDRAW_COST_LABEL` | empty | Free text for the consent dialog, e.g. "about $0.05 per image". Returned by the config route. |
| `REDRAW_FAKE` | unset | `1` returns the fixture image with no OpenAI call, for local and browser checks. |

**(spec) Rate limit.** A sliding window: the handler keeps each IP's request times
(`req.socket.remoteAddress`, never a forwarded header) and drops those older than 3,600,000 ms by
`now()`. A request is counted only after it passes the access-code check. The 21st counted request
inside the window gets 429. Fake-mode requests count too, so the limiter can be checked without
OpenAI.

### D5. OpenAI call

`POST https://api.openai.com/v1/images/edits`, `Authorization: Bearer <OPENAI_API_KEY>`, as
`multipart/form-data` built with `FormData`:

| Field | Value |
|---|---|
| `model` | `OPENAI_IMAGE_MODEL` |
| `prompt` | `buildRedrawPrompt()` |
| `image` | the uploaded PNG as a `Blob` of type `image/png`, file name `source.png` |
| `quality` | `OPENAI_IMAGE_QUALITY` |
| `size` | `1024x1024` |
| `background` | `transparent` |
| `output_format` | `png` |
| `n` | `1` |

Each attempt times out after 120 s (`timeoutMs`). A 5xx or a timeout is retried once. Mapping:

| OpenAI outcome | Our response |
|---|---|
| 200 with `data[0].b64_json` starting with the PNG signature | 200, `dataUrl: 'data:image/png;base64,' + b64_json` |
| 200 without a PNG in `data[0].b64_json` | 502 `invalid-output` |
| 429 | 429 `rate-limited` |
| 401 or 403 (our key is bad) | 502 `provider-failed`. Not `unauthorized`, which would tell the user their access code is wrong. |
| any other 4xx, including a content-policy refusal | 502 `provider-failed`, with OpenAI's `error.message` passed on |
| 5xx or timeout twice | 502 `provider-failed` |
| `fetch` itself rejects twice (DNS, reset) | 502 `provider-failed` |

Transparent backgrounds on `gpt-image-2` are a preview feature of the Images API as of August 2026.
If a model ignores `background`, the result is fully opaque and D7's check turns it into
`invalid-output`, not a bad layer.

### D6. Prompt

`server/redraw/prompt.mjs` exports `PROMPT_VERSION = 1` and `buildRedrawPrompt()`. The text is the
Variant 1 prompt below, verbatim, joined with `\n`, except the last line. That line is generated from
`STONE_COLORS` (`src/renderer/StoneColors.js:12`, re-exported from `CrystalColors.js:163`) as
`Name #hex` pairs in catalogue order (`Object.values(STONE_COLORS)`, which is `CRYSTAL_COLOR_LIST`
order). **(spec)** The hex is `previewColor`, the same value `imageColorPalette()` (`app.js:734`)
quantises against. The pairs are joined with `, ` on one line. A colour added to the catalogue
reaches the prompt with no edit here, per the standing rule that every catalogue colour appears in
every colour selector. `prompt.mjs` imports the catalogue through `src/renderer/StoneColors.js`,
which loads in plain Node (checked on `aade23f`).

```text
You are a rhinestone mosaic artist. Turn the attached image into a rhinestone mosaic picture.
Rules:
1. All stones are round and the same size. The picture is exactly 100 stones wide, in staggered (honeycomb) rows.
2. Each stone is ONE flat colour taken from the palette below. No gradients inside a stone, no reflections, no sparkle, only a small white highlight dot.
3. Use at most 8 colours from the palette for the whole picture, and use large even areas of one colour rather than mixing colours stone by stone.
4. Dark outlines, eyes, mouth and other key details are chains of Jet or Hematite stones, one stone wide.
5. Square image, subject fills the frame, transparent background, no frame, no text, no tables, no labels.
Palette (name and hex):
<generated from STONE_COLORS>
```

On `aade23f` the generated line is:

```text
Crystal #f5f5f5, Crystal AB #e9f7ff, Jet #141414, Siam #9b1c1c, Light Siam #d9534f, Rose #ef8fb0, Fuchsia #c2185b, Amethyst #7e3f98, Sapphire #2269d3, Light Sapphire #6fa8dc, Aquamarine #3fc1b0, Emerald #2aa66a, Peridot #b5cc18, Topaz #e08e26, Citrine #f2c94c, Gold #f3bd32, Silver #d8dde4, Hematite #3e3f44, Black Diamond #6b6b72, Grey #9a9ca2, Smoked Topaz #6e4a2e, Light Colorado Topaz #b98a5c, Light Peach #eec6a4
```

Any change to the wording is a `PROMPT_VERSION` bump. A catalogue change is not, because
`PROMPT_VERSION` versions the wording, not the palette.

### D7. Client limits

Both run in `src/redraw/index.js`, so every provider gets them.

* **Before upload**, the source `dataUrl` is decoded (`decodeDataUrlToBuffer()`), shrunk with
  `resizeImageBuffer(buffer, 1536, 1536)` (`src/image/ImageFieldPipeline.js:66`, which keeps the
  aspect ratio and never enlarges) and encoded to a PNG data URL. The encoder is a canvas
  (`putImageData` then `toDataURL('image/png')`), injected through `configureRedraw({ encodePng })`.
* **After the provider returns**, the image must decode. The fraction of pixels whose alpha is at
  least `ALPHA_COVERAGE_THRESHOLD` (128, `src/image/Alpha.js:15`, the cut-off the pipeline's
  `transparent: 'ignore'` already uses) must be at least 0.01 and at most 0.99. Anything else is
  invalid. Invalid output triggers one more full provider call. A second invalid output rejects with
  `invalid-output`.

Each attempt is a separate paid image and counts against D4's hourly limit, so one click costs at
most two images.

Everything in `src/redraw/**` is browser code under MAINT-007's Chrome 103 baseline and is scanned by
`test-browser-baseline.mjs`. In particular, no `AbortSignal.any()` (Chrome 116). `server/**` is Node
only and is not scanned.

### D8. Consent

Before the first upload of each page session, a consent dialog opens. It says the image will be
sent to `consent.recipientName` (OpenAI) for processing, shows `consent.costLabel`, and asks for the
access code (when `needsAccessCode`). **(spec)** It is a new Lightbox (`src/ui`'s `Lightbox`, like
every other dialog here), `#lightboxRedrawConsent`, with `#redrawConsentRecipient`,
`#redrawConsentCost`, `#redrawAccessCode` and `#redrawConsentContinue`. The cost line is hidden when
`costLabel` is empty. "Each page session" is an in-memory flag in `app.js`; a reload asks again.
Closing the dialog without Continue cancels the redraw with no request.

The access code is remembered in `localStorage` under `rhinestoneStudio.redrawAccessCode`, with load
and save each wrapped in `try/catch` exactly like `loadFavoriteFontIds()`/`saveFavoriteFontIds()`
(`app.js:375-376`). The dialog pre-fills it. An `unauthorized` result clears the stored code and the
session flag, so the next click asks again. A provider with `consent: null` never shows the dialog.

### D9. Layer transform

The transform is pure data, in **(spec)** `src/redraw/RedrawLayerTransform.js`, exported through
`index.js`, so tests import it instead of scraping `app.js`:

* `applyRedraw(layer, result, { canvas, naturalWidthPx, naturalHeightPx, now })` returns a new layer.
  `naturalWidthPx`/`naturalHeightPx` are the redrawn image's decoded size (1024 × 1024 from D5) and
  set only the new box's aspect ratio. `now` is an injected clock.
* `restoreOriginal(layer)` returns a new layer.

`app.js` applies either one as a single history step: `commitHistory()` first (it snapshots the
state *before* the change, `app.js:2591`, as the import handler does at `:5551`), then replaces the
layer in `project.layers`, sets `imageBufferCache` for the new `imageSrc` (as the import handler does
at `:5548`), and calls `updateAll(true)`. Undo reverts either one.

`applyRedraw` sets:

* `imageSrc`: the redrawn data URL. `imageName`: the original name plus ` (AI redraw)`.
* `vividness`: `1.0` (see "Measured figures").
* `w`/`h`: the redrawn image's aspect ratio, longer side 160 mm, then clamped to
  `canvas.width - 20` × `canvas.height - 20` by the same uniform shrink `computeDefaultImagePlacement()`
  uses (`app.js:5531-5540`). `x`/`y`: set so the box stays centred on the old box's centre
  (`x + w/2`, `y + h/2`). The position is not clamped, which D9 does not ask for.
* `redraw`: `{ originalImageSrc, originalImageName, previousVividness, previousW, previousH, providerId, model, promptVersion, createdAt }`,
  with `createdAt` as `new Date(now()).toISOString()`.
* Every other field is unchanged, including `rotationDeg` (the box rotates about its centre, which
  did not move) and `naturalWidthPx`/`naturalHeightPx` (see Findings F1).

**Redrawing again.** A layer that has `redraw` can be redrawn again. The request always sends
`redraw.originalImageSrc`, not the current `imageSrc`. **(spec)** The second `applyRedraw` keeps
`originalImageSrc`, `originalImageName`, `previousVividness`, `previousW` and `previousH` from the
first record, so **Use original** always returns to the layer as it was before any redraw. It
replaces `providerId`, `model`, `promptVersion` and `createdAt`. The new `imageName` is
`originalImageName + ' (AI redraw)'`, never a double suffix. `x`/`y` stay centred on the current box.

**Use original** (`restoreOriginal`) sets `imageSrc`, `imageName`, `vividness`, `w` and `h` exactly
from `layer.redraw`, recentres `x`/`y` on the current box's centre, and deletes `layer.redraw` (the
key is gone, not `undefined`). **(spec)** Recentring matters because the operator may move the
layer between the redraw and Use original. When they have not, the restored `x`/`y` equal the
originals up to floating-point rounding (the test allows 1e-9 mm).

`duplicateLayer()` (`app.js:4441`) deep-copies a layer, so a copy carries its own `redraw` record and
its own Use original. No change is needed there.

### D10. Persistence

The redrawn image and `layer.redraw` are saved with the project (Save/Export at `app.js:5578`,
autosave at `:2578`), so reopening never triggers a paid call. A project saves both images, the
original inside `redraw`. Autosave already catches and logs a failed write (`:2578`), so a larger
project cannot break editing.

A project without `layer.redraw` round-trips byte-identical: no code path adds a `redraw` key (not
even `undefined`) to a layer that has none.

`validateProject()` (`app.js:1255`): `layer.redraw` is optional. When present on an `image` layer,
it must be a plain object whose `originalImageSrc` is a non-empty string starting with
`data:image/`. Otherwise the import fails with
`Image layer "<id>" has an invalid 'redraw' record: originalImageSrc must be a data:image/ URL.`
**(spec)** The check is one line placed after the `imageSrc` rule (`:1281`). It must use only `l`
and built-ins: seventeen tests run `validateProject()` through `new Function()` with a fixed
dependency list (see "Existing tests"), and a new free identifier would break all of them.
Other `redraw` fields are not checked, which matches the function's permissive style for secondary
fields.

**SEC-001 answer.** SEC-001's import hardening does **not** drop unknown layer fields. It adds the
`LAYER_ID_PATTERN` check (`app.js:1254`, applied at `:1266`) and `escapeHtml()` at the `innerHTML`
sites. `validateProject()` copies top-level project fields one by one, but it copies each layer with
a spread, `layers:obj.layers.map(l=>({...l,visible:l.visible!==false}))` (`app.js:1342`). So
`layer.redraw` survives Import, Open and autosave recovery (`:2554`), which all go through
`validateProject()`. The Gallery's `toAppProjectShape()` (`src/gallery/RhsFixtureBridge.js:282`)
does whitelist layer fields, but it only reads bundled fixtures, which never have `redraw`.

No `redraw` string reaches `innerHTML`: `imageName` already goes through `layerLabel()`'s escaping,
and the new UI sets `textContent` only.

### D11. UI (Image → Strass only)

In the Source group (`index.html:1152`), after `#imageStudioRemove` (`:1157`):

* `#imageRedraw` **Redraw with AI**: shown only when `getRedrawAvailability()` resolved
  `available: true` and the selected layer is an image. It is disabled while a request runs.
* `#imageRedrawCancel` **Cancel**: shown only while a request runs. It aborts the request's
  `AbortController`.
* `#imageRedrawUseOriginal` **Use original**: shown when the selected image layer has `redraw`. It
  works even when no provider is available (it makes no request).
* `#imageRedrawStatus`, a `.hint` line: "Redrawing… this can take up to two minutes." while a request
  runs, then the result or error message.

Visibility is set in `renderImageStudio()` (`app.js:6506`), next to the existing
`#imageStudioRemove` enable/disable lines. `getRedrawAvailability()` is called once when the Image
→ Strass lightbox first opens.

**(spec)** The request is bound to the layer id and the source it started from. When it resolves,
if that layer is gone, or its `redraw?.originalImageSrc ?? imageSrc` changed, the result is dropped
with "The image changed while redrawing, so the result was not applied." No history step is added.

Messages (**(spec)**), shown in `#imageRedrawStatus` and `#status`:

| Outcome | Text |
|---|---|
| success | `Redrawn with AI. Use original to undo this.` |
| cancel (`AbortError`) | `Redraw cancelled.` |
| `not-configured` | `AI redraw is not set up on this server.` |
| `unauthorized` | `The access code was not accepted. Enter it again to continue.` |
| `rate-limited` | `The redraw limit has been reached. Try again later.` |
| `network` | `Could not reach the redraw service. Check your connection and try again.` |
| `provider-failed` | `The redraw service could not process this image.` plus the server's message when there is one |
| `invalid-output` | `The redrawn image came back unusable, so nothing was changed. Try again.` |
| Use original | `Restored the original image.` |

No other panel changes.

### D12. Non-goals

The line-gap repair step, logins or subscriptions, production hosting, and the Web Worker provider.

## Anchors

Re-grepped on `aade23f`.

| Anchor | Where |
|---|---|
| Image import handler `el('importImageFile').addEventListener('change',…)` | `app.js:5542` |
| Its layer literal (`vividness:1.4`, `stoneSize:2`, `maskMode:'subject'`) | `app.js:5550` |
| Its `commitHistory()` | `app.js:5551` |
| `computeDefaultImagePlacement()` | `app.js:5531` (`TARGET_LONG_SIDE_MM=200` at `:5534`, clamp at `:5538`) |
| `imageBufferCache` | `app.js:230` |
| `imageColorPalette()` | `app.js:734` |
| `validateProject()` | `app.js:1255`; `imageSrc` rule `:1281`; layer spread `:1342` |
| `LAYER_ID_PATTERN` | `app.js:1254` |
| `loadFavoriteFontIds()`/`saveFavoriteFontIds()` | `app.js:375-376` |
| `commitHistory()` | `app.js:2591` |
| autosave write | `app.js:2578` |
| `duplicateLayer()` | `app.js:4441` |
| `#exportProject` | `app.js:5578` |
| `renderImageStudio()` | `app.js:6506`; `#imageStudioRemove` enable `:6522`/`:6527`; stat line `:6636` |
| Source group / `#imageStudioRemove` | `index.html:1152` / `:1157` |
| dev-server header "Dev only -- the app itself never loads or depends on this file" | `tools/dev-server.mjs:4`; GET/HEAD-only guard `:62` |
| `STONE_COLORS` | `src/renderer/StoneColors.js:12` → `src/renderer/CrystalColors.js:163` (23 entries) |
| `.env` ignored | `.gitignore:13` |
| `decodeDataUrlToBuffer()` | `src/image/ImageDecoder.js:112` |
| `resizeImageBuffer()` | `src/image/ImageFieldPipeline.js:66` |
| `ALPHA_COVERAGE_THRESHOLD` | `src/image/Alpha.js:15` |

## Tests the build must add

All in a new `tools/test-img-022-redraw-provider.mjs`, registered in `tools/test-groups.mjs` under
`integration` (it runs `validateProject()` from `app.js`, so it does not fit `core`, whose files have
no `app.js` dependency). The tests never touch the network, never need `OPENAI_API_KEY`, never
mutate source and never run git. Handler tests call `handleConfig`/`handleRedraw` with fake
`req`/`res` objects and an injected `fetch` and `now`. They do not start the dev server.

**T1. Prompt.** `PROMPT_VERSION === 1`. The line after `Palette (name and hex):`, split on `, `,
equals `Object.values(STONE_COLORS).map(c => `${c.name} ${c.previewColor}`)` exactly: every entry
once, in catalogue order, nothing else. Every line above it equals the Variant 1 text in D6.

**T2. Access code.** A missing header and a wrong header each get 401 with `code: 'unauthorized'`,
and the fake `fetch` is never called.

**T3. Rate limit.** With the default of 20 and a fixed `now`, requests 1 to 20 from one IP succeed
(in fake mode) and the 21st gets 429 `rate-limited`. A request from a second IP still succeeds.
Moving `now` forward by 3,600,001 ms lets the first IP through again.

**T4. Retry.** Fake `fetch` answers 500 then 200 with a PNG: the handler answers 200 and `fetch` was
called twice. 500 then 500: 502 `provider-failed`, two calls. A fake `fetch` that never settles
with `timeoutMs: 10`: two attempts, then 502 `provider-failed`.

**T5. Outgoing request.** The captured request goes to `https://api.openai.com/v1/images/edits` with
`Authorization: Bearer <key>`. Its `FormData` has `model` = `gpt-image-2`, `quality` = `medium`,
`size` = `1024x1024`, `background` = `transparent`, `output_format` = `png`, `n` = `1`, `prompt` =
`buildRedrawPrompt()`, and `image` as a `Blob` of type `image/png`. With `OPENAI_IMAGE_MODEL` and
`OPENAI_IMAGE_QUALITY` set, those values are sent instead.

**T6. Status mapping.** OpenAI 429 → 429 `rate-limited`; 401 → 502 `provider-failed`; 400 with an
`error.message` → 502 `provider-failed` carrying that message; 200 without a PNG → 502
`invalid-output`.

**T7. Env.** `loadRedrawEnv()` applies every D4 default; `process.env` wins over the file text;
quotes and comments are handled; the config route answers 404 when either required variable is
empty and 200 `{ providerId: 'openai-proxy', costLabel }` when both are set.

**T8. Provider selection.** With `configureRedraw({ fetch })`: config 404 → `available: false`;
config network error → `available: false`; config 200 with a bad body → `available: false`; config
200 with a good body → `available: true, providerId: 'openai-proxy'` and consent recipient `OpenAI`.
`configureRedraw({ provider: fakeProvider })` → `redrawImage()` resolves with
`providerId: 'fake'` and makes no `fetch` call.

**T9. Client limits.** With injected `decodeImage`/`encodePng`: a 3000 × 2000 source reaches the
provider at 1536 × 1024. An output with 0% opaque pixels, then a valid one: resolves, two provider
calls. Two outputs at 100% opaque: rejects `invalid-output` after two calls. An output that fails to
decode counts as invalid. An abort before the provider resolves rejects with `AbortError`, not a
`RedrawError`.

**T10. Layer transform.** On a fixture image layer (x 20, y 30, w 200, h 150, `vividness` 1.4,
`rotationDeg` 15, canvas 300 × 250) with a 1024 × 1024 result and a fixed `now`: `imageSrc`,
`imageName` (with ` (AI redraw)`), `vividness` 1, `w` = `h` = 160, centre unchanged (120, 105), and
the `redraw` record hold the exact values; every other key is deep-equal to the input. On a
100 × 100 canvas, `w` = `h` = 80. A second `applyRedraw` keeps the first record's `original*` and
`previous*` fields. `restoreOriginal()` then gives back `imageSrc`, `imageName`, `vividness`, `w`
and `h` exactly, `x`/`y` within 1e-9 mm, and no `redraw` key.

**T11. Round trip and validation.** For a project with an image layer and no `redraw`, passed once
through `validateProject()` (extracted the way `test-project-validation-security.mjs` does),
`JSON.stringify` of a second pass equals the first, and no layer has a `redraw` key. With a
`redraw` record whose `originalImageSrc` is `data:image/png;base64,AAAA`, it is accepted and kept.
With `originalImageSrc` of `''`, `'https://x/y.png'` or missing, or with `redraw: 'x'`, it throws the
D10 message.

**T12. Wiring.** `app.js` imports `./src/redraw/index.js` and does not contain `OpenAI`,
`OpenAiProxyProvider` or `FakeRedrawProvider`.

## Existing tests that grep the text this build changes

The build changes these places. For each one, these are the existing tests that match that text,
including regex-escaped forms. The build prompt should carry this list.

**`validateProject()` (`app.js:1255`, new line after `:1281`).** Each of these extracts the whole
function, most with `/function validateProject\(obj\)\{[\s\S]*?\n\}\n/`, and runs it through
`new Function()` with a fixed dependency list. The new line must add no free identifier and no
`\n}\n`:
`test-crystal-color-integration.mjs:111`, `test-examples-regression.mjs:53`,
`test-fill-algorithms-integration.mjs:177` (an `indexOf('\n}\n')` slice),
`test-image-trace-regression.mjs:118`, `test-mono-006-monogram-ui.mjs:558`,
`test-mono-019-layer-ids.mjs:50`, `test-object-template-integration.mjs:44`,
`test-path-boolean-integration.mjs:269`, `test-product-plate-round-dinner.mjs:243`,
`test-product-vessel-dimensions.mjs:191`, `test-project-validation-security.mjs:39`,
`test-rs-3037-flat-sheet.mjs:99`, `test-s200-app-integration.mjs:158`,
`test-shapes-design-consolidation.mjs:118`, `test-svg-integration.mjs:68`. Presence only:
`test-production-export-validation.mjs:200`, `test-project-model-consolidation.mjs:93`.

**`renderImageStudio()` (`app.js:6506`).** `test-img-005-check-and-fix.mjs:338` extracts the body by
`'async function renderImageStudio(){'` and checks two substrings. `test-img-021-rotated-image-stones.mjs:295`
extracts it and counts `ctx.drawImage(` (must stay 2) and `drawInBox(` (must stay 3); the new
lines must not add either. `test-img-012-auto-colour-count.mjs:374` and
`test-img-015-direct-catalogue-colour.mjs:161-167` find the `#imgColorCountAuto` hint inside it.
`test-rs-3037-flat-sheet.mjs:454` matches
`el\('imageStudioSwitchToSheet'\)\.style\.display=currentObjectTemplate\(\)\.id==='sheet'\?'none':''`,
which must stay verbatim. `test-autosave-recovery-wiring.mjs`, `test-rs-3039-large-layout.mjs`,
`test-text-position-workflow.mjs`, `test-mono-006-monogram-ui.mjs:160` and
`test-ui-import-autoswitch-regression.mjs:150` only name it as a stub or in the `updateAll()` tail
order, which does not change.

**Code next to `#imageStudioRemove` (`app.js:5560`).** `test-img-011-import-defaults.mjs:53` extracts
`/el\('imageStudioRemove'\)\.onclick=\(\)=>\{[\s\S]*?\};/` and asserts (`:61`) that the extract
calls `el()` with no id but `imageStudioRemove`. New handlers must not be written inside that
statement.

**Not changed, but close.** The import handler (`:5542-5559`) and `computeDefaultImagePlacement()`
(`:5531-5540`) stay byte-identical. `test-img-011-import-defaults.mjs:36` extracts the latter with
`/function computeDefaultImagePlacement\(naturalWidthPx,naturalHeightPx\)\{[\s\S]*?\n\}/` and runs it
with only `project` injected. That is why D9's clamp is re-stated in `RedrawLayerTransform.js`
instead of shared: a shared helper would add a free identifier to that extract. `:47` extracts the
import handler, and `test-img-017-vividness.mjs:193` asserts its literal contains `,vividness:1.4,`.
`test-img-013-fill-empty-slots.mjs` and `test-ui-shell-structure.mjs:218` reference
`importImageFile`. None is affected if the handler is left alone.

**`index.html` Source group.** `test-ui-shell-structure.mjs:218` asserts a list of ids exist
(`importImage`, `importImageFile`, `imageStudioRemove`, …). Adding elements does not affect it.

**`tools/dev-server.mjs`.** `test-dev-server-no-cache.mjs` spawns the real server and checks
`/app.js` (200, the file's bytes, `no-cache, no-store`), `/` (200, HTML), a missing file (404 with the
header), and the `dev`/`start` scripts in `package.json`. Nothing greps the header comment. It runs
with no `.env`, so redraw is off, and the new routes must answer 404 then, with the same header.

**Browser baseline.** `test-browser-baseline.mjs:100` scans every `.js` under `src/`, so it will
scan `src/redraw/**`.

## Build housekeeping

* New files: `src/redraw/index.js`, `src/redraw/OpenAiProxyProvider.js`,
  `src/redraw/FakeRedrawProvider.js`, `src/redraw/RedrawLayerTransform.js`,
  `server/redraw/handler.mjs`, `server/redraw/prompt.mjs`, `server/redraw/env.mjs`, `.env.example`,
  `tools/test-img-022-redraw-provider.mjs`.
* Changed: `app.js`, `index.html`, `tools/dev-server.mjs`, `tools/test-groups.mjs`.
* No new npm dependencies and no image files.
* Browser check: run `REDRAW_FAKE=1` with any non-empty `OPENAI_API_KEY` and a
  `REDRAW_ACCESS_CODE`. Check consent, redraw, Undo, Use original, Cancel, and that the button stays
  hidden with no env set. Then do one live OpenAI call only with the operator's go-ahead, since it
  is billed.

## Findings for decision

These are points where a settled decision has a consequence the brief may not have meant. The spec
follows the decisions as given.

* **F1. `naturalWidthPx`/`naturalHeightPx` go stale.** D9 leaves every other field unchanged, so
  after a redraw these still hold the original upload's size. The Studio's stat line
  (`app.js:6636`) then shows e.g. "photo.jpg (AI redraw) — 4000×3000px" for a 1024 × 1024 image.
  Nothing else reads them (`computeDefaultImagePlacement()` takes its own arguments), so no stone
  moves. Suggested fix: set them to the redrawn size and record `previousNaturalWidthPx`/
  `previousNaturalHeightPx` in `layer.redraw` so Use original restores them.
* **F2. Fake mode needs a dummy key.** D3 mounts the routes only when `OPENAI_API_KEY` is set, so a
  `REDRAW_FAKE=1` check needs a placeholder key. That is harmless but odd. The alternative is to
  mount when the key is set or `REDRAW_FAKE=1`.
* **F3. The box can leave the canvas.** D9 keeps the 160 mm box centred on the old centre and clamps
  only its size. A small image placed near an edge can end up partly off the canvas.
* **F4. Clamp logic is stated twice.** `RedrawLayerTransform.js` restates
  `computeDefaultImagePlacement()`'s one-line uniform shrink rather than sharing it, for the test
  extraction reason in "Existing tests". CLAUDE.md discourages duplicated logic. Sharing it means
  moving `computeDefaultImagePlacement()` into `src/` and updating `test-img-011`, which is outside
  this milestone.
* **F5. The transparency parameter is in preview.** If OpenAI stops honouring
  `background: transparent` for `gpt-image-2`, every redraw fails as `invalid-output` after two
  billed images. D7 keeps bad output out of the project, but it does not avoid the cost.
