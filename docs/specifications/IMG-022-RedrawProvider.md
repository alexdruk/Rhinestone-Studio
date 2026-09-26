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
| `invalid-output` | The returned image did not decode or failed the subject-coverage check (D7), twice. |

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
  `FAKE_REDRAW_DATA_URL`: a 64 × 64 RGBA PNG (colour type 6). Pixel (x, y), with integer x and y
  from 0 to 63, is opaque Jet `#141414` when `Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24`, and
  fully transparent `(0, 0, 0, 0)` otherwise. `computeSubjectMask()` takes
  its alpha route and reports 44% subject coverage (checked on `aade23f` with an equivalent buffer),
  so it passes D7. The build generates the bytes once with a scratch script and pastes the
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
configured. "Configured" means `REDRAW_ACCESS_CODE` is non-empty **and** either `OPENAI_API_KEY` is
non-empty or `REDRAW_FAKE=1`. Fake mode therefore needs no key, and the access code is required in
both modes. Otherwise both routes answer 404 and the server logs one line at start-up saying
redraw is off and which variable is missing (never a value). With `REDRAW_FAKE=1` and a key both
set, fake mode wins and no OpenAI call is made. In fake mode the config route still answers
`{ providerId: 'openai-proxy', costLabel }`, so the browser runs the real proxy provider, consent
dialog and access-code path against the fixture. The consent dialog still names OpenAI even though
nothing is sent there. That is acceptable for a local check mode.
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
| `OPENAI_API_KEY` | none; required unless `REDRAW_FAKE=1` | Server-side only. Never sent to the browser or logged. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Sent as `model`. |
| `OPENAI_IMAGE_QUALITY` | `high` | Sent as `quality`. Changed from `medium` by IMG-023 (D6). |
| `REDRAW_ACCESS_CODE` | none, always required | Requests without a matching `X-Redraw-Access-Code` header get 401. Unset, both routes are 404, fake mode included. |
| `REDRAW_RATE_LIMIT_PER_HOUR` | `20` | In memory, per client IP. |
| `REDRAW_COST_LABEL` | empty | Free text for the consent dialog, e.g. "about $0.05 per image". Returned by the config route. |
| `REDRAW_FAKE` | unset | `1` returns the fixture image with no OpenAI call, for local and browser checks. Mounts the routes without `OPENAI_API_KEY`. |

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

`background` stays `transparent`. Transparent backgrounds on `gpt-image-2` are a preview feature
of the Images API as of August 2026. D7 no longer depends on it: if a model ignores `background`
and returns the subject on a plain opaque background, the Subject mask removes that background, so
the output is still valid.

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
* **After the provider returns**, the image is valid when it decodes and its **subject coverage**
  is at least 0.01 and at most 0.99. Subject coverage is the fraction of 1s in the `mask` that
  `computeSubjectMask(imageBuffer, options = {})` returns (`src/image/SubjectMask.js:208`, exported
  through `src/image/index.js:55`). It returns
  `{ mask: { widthPx, heightPx, data }, route: 'alpha'|'background', backgroundRgb }`, where `mask.data`
  holds 0/1 per pixel. It is called with no options, so the tolerance is
  `DEFAULT_SUBJECT_TOLERANCE_DE` (12), as the image pipeline calls it. To match the pipeline's size
  rule (`computeNativeSizeSubjectMask()`, `src/image/ImageFieldPipeline.js:112-117`), an image whose
  longer side is over 1000 px (`SUBJECT_MASK_RESIZE_TRIGGER_PX`, `:45`) is first shrunk with
  `resizeImageBuffer(buffer, 800, 800)` (`SUBJECT_MASK_MAX_DIMENSION_PX`, `:46`). Those two
  constants are not exported through the `src/image/index.js` barrel, so `src/redraw/index.js`
  restates 1000 and 800 with a comment naming them. A 1024 × 1024 OpenAI result is shrunk; the
  64 × 64 fake is not.

  This check replaces an alpha-only opacity check. The Subject mask's alpha route handles a
  transparent background. Its background route (the modal border colour, flood-filled from the
  border) removes a plain opaque background, so a fully opaque image on white is still valid. A
  blank image (fully transparent, or one flat colour) gives 0 coverage, and an image with no
  removable background gives about 1, so both are invalid.

  Invalid output triggers one more full provider call. A second invalid output rejects with
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
  `naturalWidthPx`/`naturalHeightPx` are the redrawn image's decoded size (1024 × 1024 from D5,
  already decoded by D7's check). They set the new box's aspect ratio and are written to the layer.
  `now` is an injected clock.
* `restoreOriginal(layer)` returns a new layer.

`app.js` applies either one as a single history step: `commitHistory()` first (it snapshots the
state *before* the change, `app.js:2591`, as the import handler does at `:5551`), then replaces the
layer in `project.layers`, sets `imageBufferCache` for the new `imageSrc` (as the import handler does
at `:5548`), and calls `updateAll(true)`. Undo reverts either one.

`applyRedraw` sets:

* `imageSrc`: the redrawn data URL. `imageName`: the original name plus ` (AI redraw)`.
* `vividness`: `1.0` (see "Measured figures").
* `naturalWidthPx`/`naturalHeightPx`: the redrawn image's decoded size. The Studio's stat line
  (`app.js:6636`) then shows the image actually in use.
* `w`/`h`: the redrawn image's aspect ratio, longer side 160 mm, then clamped to
  `canvas.width - 20` × `canvas.height - 20` by the same uniform shrink `computeDefaultImagePlacement()`
  uses (`app.js:5531-5540`; the clamp line is `:5538`).
* `x`/`y`: first set so the box is centred on the old box's centre (`x + w/2`, `y + h/2`). Then the
  box is shifted, never scaled again, so it lies fully inside the canvas:
  `x = min(max(x, 0), canvas.width - w)`, and likewise `y` with `canvas.height - h`. The size clamp
  above leaves a 20 mm margin, so the box always fits and the shift always succeeds. The shift is
  0 when the centred box already fits. "Inside" refers to the unrotated box. A rotated layer's
  corners can still cross the edge, as they can for any rotated layer today.
* `redraw`: `{ originalImageSrc, originalImageName, previousVividness, previousW, previousH, previousNaturalWidthPx, previousNaturalHeightPx, previousX, previousY, appliedX, appliedY, providerId, model, promptVersion, createdAt }`,
  with `createdAt` as `new Date(now()).toISOString()`. `previousX`/`previousY` are the layer's
  `x`/`y` before the redraw. `appliedX`/`appliedY` are the `x`/`y` this `applyRedraw` produced, after
  the shift.
* Every other field is unchanged, including `rotationDeg`.

**The restated clamp.** The uniform-shrink line in `RedrawLayerTransform.js` restates
`computeDefaultImagePlacement()`'s clamp (`app.js:5538`) instead of sharing it. It carries a
comment naming `computeDefaultImagePlacement()` in `app.js`. The build adds a matching one-line
comment in the comment block directly above `computeDefaultImagePlacement()` (`app.js:5526-5530`,
outside the function) pointing back to `src/redraw/RedrawLayerTransform.js`. Reason:
`test-img-011-import-defaults.mjs:36` cuts `computeDefaultImagePlacement()` out of `app.js` with a
regex and runs it through `new Function('project', …)` with only `project` injected. A shared
helper would be a free identifier in that extract and break the test. No test matches the comment
block above the function (grepped on `aade23f`), and the regex starts at `function`, so the
comment is safe there.

**Redrawing again.** A layer that has `redraw` can be redrawn again. The request always sends
`redraw.originalImageSrc`, not the current `imageSrc`. **(spec)** The second `applyRedraw` keeps
`originalImageSrc`, `originalImageName`, `previousVividness`, `previousW`, `previousH`,
`previousNaturalWidthPx`, `previousNaturalHeightPx`, `previousX` and `previousY` from the first
record, so **Use original** always returns to the layer as it was before any redraw. It replaces
`appliedX`, `appliedY`, `providerId`, `model`, `promptVersion` and `createdAt`. The new `imageName` is
`originalImageName + ' (AI redraw)'`, never a double suffix. `x`/`y` are centred on the current
box, then shifted inside the canvas as above.

**Use original** (`restoreOriginal`) sets `imageSrc`, `imageName`, `vividness`, `w`, `h`,
`naturalWidthPx` and `naturalHeightPx` exactly from `layer.redraw`, and deletes `layer.redraw` (the
key is gone, not `undefined`). For `x`/`y`:

* If the layer's current `x` and `y` each equal `appliedX` and `appliedY` within 1e-9 mm, the layer
  has not moved since the redraw, and `x`/`y` are restored to `previousX`/`previousY` exactly. This
  is exact whether or not the redraw shifted the box.
* Otherwise the operator moved the layer after the redraw. The original box is recentred on the
  current box's centre, so it stays where the operator put it.

A record without numeric `appliedX`/`appliedY` (not produced by this build, but possible in a
hand-edited file) takes the recentre branch.

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
| `computeSubjectMask(imageBuffer, options = {})` | `src/image/SubjectMask.js:208`; exported at `src/image/index.js:55` |
| `SUBJECT_MASK_RESIZE_TRIGGER_PX = 1000` / `SUBJECT_MASK_MAX_DIMENSION_PX = 800` | `src/image/ImageFieldPipeline.js:45` / `:46`; used at `:112-117` |
| Comment block above `computeDefaultImagePlacement()` | `app.js:5526-5530` |

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
quotes and comments are handled. The config route answers 404 with no `REDRAW_ACCESS_CODE`
(with or without a key, fake or not), 404 with an access code but neither a key nor
`REDRAW_FAKE=1`, and 200 `{ providerId: 'openai-proxy', costLabel }` with an access code and a key.

**T7b. Fake mode with no key.** Settings with `REDRAW_FAKE=1`, `REDRAW_ACCESS_CODE` set and no
`OPENAI_API_KEY`: the config route answers 200 `{ providerId: 'openai-proxy', costLabel }`;
`handleRedraw` with the right code answers 200 with `FAKE_REDRAW_DATA_URL` and `model: 'fake'`; a
wrong code still gets 401; and the injected `fetch` is never called. With a key also set, fake mode
still wins (no `fetch` call).

**T8. Provider selection.** With `configureRedraw({ fetch })`: config 404 → `available: false`;
config network error → `available: false`; config 200 with a bad body → `available: false`; config
200 with a good body → `available: true, providerId: 'openai-proxy'` and consent recipient `OpenAI`.
`configureRedraw({ provider: fakeProvider })` → `redrawImage()` resolves with
`providerId: 'fake'` and makes no `fetch` call.

**T9. Client limits.** With injected `decodeImage`/`encodePng`, and the real `computeSubjectMask()`,
a 3000 × 2000 source reaches the provider at 1536 × 1024. The output fixtures are 64 × 64 RGBA
buffers built in the test. For each fixture, the test first asserts its `route` and coverage from
`computeSubjectMask()` directly, so a change in the mask shows up as a fixture failure, not as a
confusing validity failure. The figures below were checked on `aade23f`.

* **Opaque on white (valid).** Every pixel opaque. Pixel (x, y), with integer x and y from 0 to 63,
  is Jet-dark `(20, 20, 20)` when `Math.hypot(x - 31.5, y - 31.5) <= 20`, and white
  `(255, 255, 255)` otherwise. Route `background`, coverage 0.3086. `redrawImage()`
  resolves after one provider call.
* **The fake image (valid).** `FAKE_REDRAW_DATA_URL`'s own pixels (D2 formula,
  `Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24`): route `alpha`, coverage 0.4404.
* **Blank (invalid).** Two cases: fully transparent (route `alpha`, coverage 0) and flat opaque
  white (route `background`, coverage 0).
* **Fully covered (invalid).** Every pixel opaque: a checkerboard of 3 px cells in red
  `(255, 0, 0)` and blue `(0, 0, 255)`. Route `background`, coverage 1. No border run of
  background-coloured pixels reaches IMG-014's 5%-of-side seed length (3.2 px here), so nothing is
  flood-filled as background.

An invalid fixture, then the valid one: resolves, two provider calls. Two invalid outputs (each of
the three invalid fixtures in turn): rejects `invalid-output` after two calls. An output that fails
to decode counts as invalid. An abort before the provider resolves rejects with `AbortError`, not a
`RedrawError`.

**T10. Layer transform.** On a fixture image layer (x 20, y 30, w 200, h 150, `naturalWidthPx`
4000, `naturalHeightPx` 3000, `vividness` 1.4, `rotationDeg` 15, canvas 300 × 250) with a
1024 × 1024 result and a fixed `now`: `imageSrc`, `imageName` (with ` (AI redraw)`), `vividness` 1,
`naturalWidthPx` = `naturalHeightPx` = 1024, `w` = `h` = 160, centre unchanged (120, 105) with no
shift (x 40, y 25), and the `redraw` record hold the exact values, including
`previousNaturalWidthPx` 4000 and `previousNaturalHeightPx` 3000. Every other key is deep-equal to the
input. On a 100 × 100 canvas, `w` = `h` = 80, shifted to x 20, y 20. A second `applyRedraw` keeps the
first record's `original*` and `previous*` fields, including both `previousNatural*`.
The record holds `previousX` 20, `previousY` 30, `appliedX` 40, `appliedY` 25; the second
`applyRedraw` keeps `previousX`/`previousY` and replaces `appliedX`/`appliedY`.
`restoreOriginal()` then gives back `imageSrc`, `imageName`, `vividness`, `w`, `h`, `naturalWidthPx`
(4000), `naturalHeightPx` (3000), `x` 20 and `y` 30 exactly, and no `redraw` key.

**T10b. A small image touching the canvas edge.** Canvas 300 × 250. A layer at x 0, y 0, w 40, h 30
(touching the top and left edges): the 160 mm box centred on (20, 15) would sit at (-60, -65), and it
is shifted to x 0, y 0 with `w` = `h` = 160 (not rescaled). A layer at x 260, y 220, w 40, h 30
(touching the right and bottom edges): the centred box at (200, 155) is shifted to x 140, y 90. In
both cases `0 ≤ x`, `x + w ≤ 300`, `0 ≤ y` and `y + h ≤ 250`, and `appliedX`/`appliedY` equal the
shifted position. `restoreOriginal()` on the unmoved first layer gives `w` 40, `h` 30, x 0, y 0
exactly, and on the unmoved second layer x 260, y 220 exactly. Moving the first layer by 1e-10 mm
still counts as unmoved and restores x 0, y 0.

**T10c. Moved after the redraw.** The first T10b layer, redrawn (x 0, y 0, 160 × 160), then moved to
x 50, y 40 (centre (130, 120)): `restoreOriginal()` gives `w` 40, `h` 30, recentred on (130, 120):
x 110, y 105. Moving only `x` (x 50, y 0) also counts as moved: x 110, y 65.

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
(`:5531-5540`) stay byte-identical. The only nearby change is one comment line added to the block
above the function (`:5526-5530`). No test matches that block, and every extract of the function
starts at `function computeDefaultImagePlacement(`. `test-img-011-import-defaults.mjs:36` extracts the latter with
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
* A one-line comment above `computeDefaultImagePlacement()` in `app.js` pointing to
  `src/redraw/RedrawLayerTransform.js` (D9, "The restated clamp").
* Browser check: run `REDRAW_FAKE=1` and a `REDRAW_ACCESS_CODE`, with no `OPENAI_API_KEY`. Check consent, redraw, Undo, Use original, Cancel, and that the button stays
  hidden with no env set. Then do one live OpenAI call only with the operator's go-ahead, since it
  is billed.

## Findings for decision

None open. F1 to F5 from the first version of this spec are resolved in D9 (F1, F3, F4), D3/D4 (F2)
and D5/D7 (F5). F6 (Use original after a shifted redraw) is resolved in D9: the record keeps
`previousX`/`previousY` and `appliedX`/`appliedY`, and Use original restores the position exactly
unless the layer was moved after the redraw.
