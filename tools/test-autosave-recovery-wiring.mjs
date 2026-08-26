import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';

// Autosave & Recovery — app.js wiring.
//
// tools/test-autosave-manager.mjs already covers the pure recovery-record logic
// (schema/staleness/corruption handling) in isolation. This suite covers the app.js *wiring*
// around it, using this repository's established "extract the real source fragment, execute it via
// new Function() against minimal fakes" convention (see tools/test-ui-import-autoswitch-regression.mjs,
// tools/test-shapes-around-text-creation.mjs) so these tests fail on a real regression in app.js's
// own source, not just an assumption about what it does.
//
// Two originally-separate suites (RC-005, RC-005A), merged here because they cover adjacent app.js
// code for the same feature:
//
//  1. Boot-time recovery decision (the exact fragment between `let bootStatusMessage=null;` and
//     `let cleanProjectJson=...`): restores + normalizes via validateProject() when a usable
//     record exists, falls back to the freshly-constructed default project otherwise, and never
//     throws past a corrupt/throwing autosave.load() or an invalid recovered.project.
//  2. scheduleAutosave()/flushAutosaveNow() are wired into updateAll() and debounce-then-write
//     only on an actual content change (not "every mouse move").
//  3. Manual Save (#exportProject) clears the autosave slot.
//  4. Every "loading a project is a fresh start" site (Import/Open, Gallery "Open as copy")
//     re-baselines the autosave slot to the newly loaded project.
//  5. A pagehide flush listener exists (mid-debounce refresh/crash must not lose the pending write).
//  6. The recovery *notification* (#status line): shown immediately, auto-dismisses back to "Ready"
//     after a few seconds unless a newer #status message has since been written, suppressed by a
//     higher-priority font-manifest boot error, and reuses #status rather than introducing a new
//     dialog/toast. The recovery *decision* itself (bootStatusMessage's true/false logic) is section
//     1 above; this section only covers how that decision is displayed.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const endIdx = source.indexOf(endMarker, start);
  assert.ok(endIdx !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, endIdx);
}

// Brace-balanced extraction: finds startMarker, then the function body from its opening "{" through
// the matching closing "}" (counting brace depth), regardless of how many physical lines or comments
// sit in between. Unlike sliceBetween()'s fixed end-marker approach, this survives a function being
// reformatted across multiple lines (e.g. a comment inserted mid-body) -- exactly what broke this
// suite's own updateAll() extraction under MONO-006A: sliceBetween(..., '\n', ...) silently captured
// only the function's first physical line once a multi-line comment pushed the rest of the body past
// that first newline, so the assertions below saw a truncated fragment missing calls that are, in
// fact, still present in the real function.
function extractFunctionBody(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart !== -1, `expected to find the opening "{" of ${label} in app.js`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`expected to find the matching closing "}" of ${label} in app.js`);
}

// ---------- 1. Boot-time recovery decision, executed for real ----------

const recoverySrc = sliceBetween(appJs, 'let bootStatusMessage=null;', 'let cleanProjectJson=JSON.stringify(project);', 'the boot-time recovery block');

function runRecovery({ initialProject, autosaveLoad, autosaveLoadThrows = false, validateProjectImpl }) {
  let cleared = false;
  const autosave = {
    load() {
      if (autosaveLoadThrows) throw new Error('load() blew up');
      return autosaveLoad;
    },
    clear() { cleared = true; }
  };
  const selectOnly = (id) => new Set([id]);
  const fakeConsole = { error() {}, warn() {} };
  const fn = new Function('autosave', 'validateProject', 'selectOnly', 'console', `
    let project = ${JSON.stringify(initialProject)};
    let selectedLayerId = 'preExistingSelection';
    let selectedLayerIds;
    ${recoverySrc}
    return { project, selectedLayerId, selectedLayerIds, bootStatusMessage };
  `);
  const result = fn(autosave, validateProjectImpl, selectOnly, fakeConsole);
  return { ...result, autosaveCleared: cleared };
}

const defaultLikeProject = { name: 'Untitled Project', canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text' }] };
const identityValidateProject = (obj) => obj; // stands in for app.js's real validateProject() below

await test('no recoverable record: project/selectedLayerId are left untouched, no status message, autosave not cleared', () => {
  const result = runRecovery({ initialProject: defaultLikeProject, autosaveLoad: null, validateProjectImpl: identityValidateProject });
  assert.deepEqual(result.project, defaultLikeProject);
  assert.equal(result.selectedLayerId, 'preExistingSelection');
  assert.equal(result.bootStatusMessage, null);
  assert.equal(result.autosaveCleared, false);
});

await test('a usable recovered record replaces the project, runs it through validateProject(), and sets a status message', () => {
  const recoveredProject = { name: 'Recovered Draft', canvas: { width: 210, height: 90 }, layers: [{ id: 'circle1', type: 'circle' }] };
  let validateProjectCalledWith = null;
  const validateProjectImpl = (obj) => { validateProjectCalledWith = obj; return { ...obj, normalized: true }; };
  const result = runRecovery({
    initialProject: defaultLikeProject,
    autosaveLoad: { project: recoveredProject, selectedLayerId: 'circle1', savedAt: 12345 },
    validateProjectImpl
  });
  assert.deepEqual(validateProjectCalledWith, recoveredProject, 'the recovered project must be re-validated exactly like Import does');
  assert.equal(result.project.normalized, true);
  assert.equal(result.selectedLayerId, 'circle1');
  assert.ok(result.selectedLayerIds.has('circle1'));
  assert.match(result.bootStatusMessage, /Restored/);
});

await test('recovered selectedLayerId not present among the recovered layers falls back to the first layer', () => {
  const recoveredProject = { name: 'Recovered', canvas: { width: 210, height: 90 }, layers: [{ id: 'onlyLayer', type: 'circle' }] };
  const result = runRecovery({
    initialProject: defaultLikeProject,
    autosaveLoad: { project: recoveredProject, selectedLayerId: 'a-layer-id-that-no-longer-exists', savedAt: 1 },
    validateProjectImpl: identityValidateProject
  });
  assert.equal(result.selectedLayerId, 'onlyLayer');
});

await test('autosave.load() throwing falls back to the original project without propagating, and clears the slot', () => {
  const result = runRecovery({ initialProject: defaultLikeProject, autosaveLoadThrows: true, validateProjectImpl: identityValidateProject });
  assert.deepEqual(result.project, defaultLikeProject);
  assert.equal(result.bootStatusMessage, null);
  assert.equal(result.autosaveCleared, true, 'a broken recovery record must be cleared so it never blocks a later boot again');
});

await test('a recovered record whose project fails validateProject() falls back to the original project and clears the slot', () => {
  const throwingValidateProject = () => { throw new Error('project.canvas.width must be a positive number.'); };
  const result = runRecovery({
    initialProject: defaultLikeProject,
    autosaveLoad: { project: { canvas: { width: -1 } }, selectedLayerId: 'x', savedAt: 1 },
    validateProjectImpl: throwingValidateProject
  });
  assert.deepEqual(result.project, defaultLikeProject);
  assert.equal(result.bootStatusMessage, null);
  assert.equal(result.autosaveCleared, true);
});

// ---------- 2. scheduleAutosave() is wired into updateAll(), debounced, diff-gated ----------
//
// updateAll() is executed for real (not just text-searched) against fakes for every collaborator it
// calls, so this suite proves actual runtime behavior -- call order, and that stale-token/failure
// exits genuinely short-circuit before the successful-regeneration tail -- rather than merely where
// names appear in the source text. This also makes the extraction immune to updateAll() being
// reformatted across physical lines (a multi-line comment inserted mid-body is exactly what broke
// the old sliceBetween(..., '\n', ...)-based version of this test under MONO-006A).

function runUpdateAll({ skipWrite = false, buildGenerate, statusText = 'Ready', permanentEngineError = null, isDrawing = false, projectLayers = [] } = {}) {
  const calls = [];
  const record = (name) => () => { calls.push(name); };
  const consoleErrors = [];
  let statusValue = statusText;
  const el = (id) => {
    assert.equal(id, 'status', `updateAll() must only touch #status, not #${id}`);
    return { get textContent() { return statusValue; }, set textContent(v) { statusValue = v; } };
  };
  const engine = { generate: null };
  const project = { layers: projectLayers };
  const fakeConsole = { error: (...args) => consoleErrors.push(args) };
  const writeSelectedControlsToLayer = record('writeSelectedControlsToLayer');
  const renderLayerUI = record('renderLayerUI');
  const drawLayout = record('drawLayout');
  const drawCup = record('drawCup');
  const updateStats = record('updateStats');
  const updateHistoryUI = record('updateHistoryUI');
  const updateEditingUI = record('updateEditingUI');
  const updateViewButtons = record('updateViewButtons');
  const updateTextOutsidePrintableWarning = record('updateTextOutsidePrintableWarning');
  const scheduleAutosave = record('scheduleAutosave');
  let syncFromProjectLayersArg = null;
  const drawingTool = {
    isActive: isDrawing,
    resize: record('drawingTool.resize'),
    syncFromProjectLayers: (pathLayers) => { syncFromProjectLayersArg = pathLayers; calls.push('drawingTool.syncFromProjectLayers'); }
  };

  const updateAllSrc = extractFunctionBody(appJs, 'async function updateAll(skipWrite=false,forceStoneRebuild=false){', 'updateAll()');
  const factory = new Function(
    'writeSelectedControlsToLayer', 'engine', 'project', 'el', 'permanentEngineError', 'console',
    'renderLayerUI', 'drawLayout', 'drawCup', 'updateStats', 'updateHistoryUI', 'updateEditingUI',
    'updateViewButtons', 'updateTextOutsidePrintableWarning', 'scheduleAutosave', 'drawingTool', 'devicePixelRatio',
    // RS-3032 Step A: updateAll()'s own body now references the real, module-level SHAPE_LIBRARY_KINDS
    // (its Design-canvas sync call site is widened to also cover shape-library layers) -- injected
    // here as the same real Set app.js imports, not a fake, so this stays a real-behavior extraction.
    'SHAPE_LIBRARY_KINDS',
    `
    let generationToken=0;
    let layout;
    function bumpGenerationToken(){generationToken++}
    ${updateAllSrc}
    return { updateAll, bumpGenerationToken };
    `
  );
  const { updateAll, bumpGenerationToken } = factory(
    writeSelectedControlsToLayer, engine, project, el, permanentEngineError, fakeConsole,
    renderLayerUI, drawLayout, drawCup, updateStats, updateHistoryUI, updateEditingUI,
    updateViewButtons, updateTextOutsidePrintableWarning, scheduleAutosave, drawingTool, 1,
    SHAPE_LIBRARY_KINDS
  );
  if (buildGenerate) engine.generate = buildGenerate(bumpGenerationToken);
  const tailCalls = () => calls.filter((c) => c !== 'writeSelectedControlsToLayer');
  return { run: () => updateAll(skipWrite), calls, tailCalls, getStatus: () => statusValue, consoleErrors, getSyncFromProjectLayersArg: () => syncFromProjectLayersArg };
}

const SUCCESS_TAIL_ORDER = ['renderLayerUI', 'drawLayout', 'drawCup', 'updateStats', 'updateHistoryUI', 'updateEditingUI', 'updateViewButtons', 'updateTextOutsidePrintableWarning', 'scheduleAutosave'];

await test('a successful regeneration draws/updates stats/history/warnings and only then schedules autosave, in the required order', async () => {
  const { run, calls, getStatus } = runUpdateAll({ buildGenerate: () => async () => ({ count: 3 }) });
  await run();
  assert.deepEqual(calls, ['writeSelectedControlsToLayer', ...SUCCESS_TAIL_ORDER]);
  assert.equal(getStatus(), 'Ready');
});

await test('updateAll(true) (skipWrite) skips writeSelectedControlsToLayer() but still completes the successful-regeneration tail', async () => {
  const { run, calls } = runUpdateAll({ skipWrite: true, buildGenerate: () => async () => ({}) });
  await run();
  assert.deepEqual(calls, SUCCESS_TAIL_ORDER);
});

await test('a thrown generation error reports it via #status and console.error, and runs none of the successful-regeneration tail', async () => {
  const { run, tailCalls, getStatus, consoleErrors } = runUpdateAll({ buildGenerate: () => async () => { throw new Error('boom'); } });
  await run();
  assert.deepEqual(tailCalls(), [], 'no draw/history/autosave call may run after a failed generation');
  assert.equal(getStatus(), 'Text generation failed: boom');
  assert.equal(consoleErrors.length, 1);
});

await test('a generation token superseded during the await (a newer updateAll() call started first) discards this pass entirely, even though generate() itself succeeded', async () => {
  const { run, tailCalls, getStatus } = runUpdateAll({ buildGenerate: (bump) => async () => { bump(); return {}; } });
  await run();
  assert.deepEqual(tailCalls(), [], 'a stale/superseded pass must not run any of the successful-regeneration tail');
  assert.equal(getStatus(), 'Ready', 'a discarded pass must not touch #status at all');
});

await test('a generation token superseded during the await also short-circuits the failure path (no status write, no console.error, no tail)', async () => {
  const { run, tailCalls, getStatus, consoleErrors } = runUpdateAll({ buildGenerate: (bump) => async () => { bump(); throw new Error('boom'); } });
  await run();
  assert.deepEqual(tailCalls(), [], 'a stale/superseded pass must not run any of the successful-regeneration tail even on a failed generation');
  assert.equal(getStatus(), 'Ready', 'a discarded failing pass must not overwrite #status');
  assert.equal(consoleErrors.length, 0, 'a discarded failing pass must not log the error either');
});

await test('RS-3010: while drawing mode is active, updateAll() resyncs via drawingTool.resize() instead of drawLayout()', async () => {
  const { run, calls } = runUpdateAll({ isDrawing: true, buildGenerate: () => async () => ({}) });
  await run();
  assert.deepEqual(calls, ['writeSelectedControlsToLayer', ...SUCCESS_TAIL_ORDER.flatMap((c) => c === 'drawLayout' ? ['drawingTool.resize', 'drawingTool.syncFromProjectLayers'] : [c])]);
  assert.ok(!calls.includes('drawLayout'), 'drawLayout() must not run while drawingTool owns layoutCanvas');
});

await test('canvas-desync fix: while drawing mode is active, updateAll() reconciles Design shapes via drawingTool.syncFromProjectLayers(), passed the current \'path\' layers plus every SHAPE_LIBRARY_KINDS layer (RS-3032 Step A) plus every svg/image layer (RS-3012 Step 2) but no others', async () => {
  const projectLayers = [
    { id: 'p1', type: 'path' },
    { id: 't1', type: 'text' },
    { id: 'p2', type: 'path' },
    { id: 'c1', type: 'circle' },
    { id: 's1', type: 'star' },
    { id: 'svg1', type: 'svg' },
    { id: 'img1', type: 'image' }
  ];
  const { run, getSyncFromProjectLayersArg } = runUpdateAll({ isDrawing: true, projectLayers, buildGenerate: () => async () => ({}) });
  await run();
  assert.deepEqual(getSyncFromProjectLayersArg(), [projectLayers[0], projectLayers[2], projectLayers[4], projectLayers[5], projectLayers[6]], 'expected path + shape-library + svg/image layers only -- text/circle must stay excluded');
});

await test('canvas-desync fix: while drawing mode is inactive, updateAll() never calls drawingTool.syncFromProjectLayers()', async () => {
  const { run, calls } = runUpdateAll({ isDrawing: false, buildGenerate: () => async () => ({}) });
  await run();
  assert.ok(!calls.includes('drawingTool.syncFromProjectLayers'), 'sync must only run while Design actually owns the canvas');
});

await test('a lingering "Text generation failed" status is cleared back to Ready once generation succeeds again, and a font-manifest error still takes priority over it', async () => {
  const recovered = runUpdateAll({ statusText: 'Text generation failed: boom', buildGenerate: () => async () => ({}) });
  await recovered.run();
  assert.equal(recovered.getStatus(), 'Ready');

  const withManifestError = runUpdateAll({ statusText: 'Ready', permanentEngineError: new Error('manifest fetch failed'), buildGenerate: () => async () => ({}) });
  await withManifestError.run();
  assert.match(withManifestError.getStatus(), /Font manifest failed to load \(manifest fetch failed\)/);
});

await test('scheduleAutosave() and flushAutosaveNow() are diff-gated against lastAutosavedProjectJson, not unconditional', () => {
  const scheduleSrc = sliceBetween(appJs, 'function scheduleAutosave(){', '\n}', 'scheduleAutosave()');
  const flushSrc = sliceBetween(appJs, 'function flushAutosaveNow(){', '\n}', 'flushAutosaveNow()');
  assert.match(scheduleSrc, /JSON\.stringify\(project\)===lastAutosavedProjectJson/, 'scheduleAutosave() must skip (re)scheduling when nothing changed since the last autosave');
  assert.match(flushSrc, /json===lastAutosavedProjectJson/, 'flushAutosaveNow() must no-op when nothing changed since the last autosave');
  assert.match(scheduleSrc, /setTimeout\(flushAutosaveNow,AUTOSAVE_DEBOUNCE_MS\)/, 'scheduleAutosave() must debounce via a timer, not write synchronously on every call');
  assert.match(scheduleSrc, /clearTimeout\(autosaveTimer\)/, 'scheduleAutosave() must reset any pending timer on each call (that is what turns per-keystroke/per-drag-frame calls into one write after activity settles)');
});

// ---------- 3. Manual Save clears the autosave slot ----------

await test('#exportProject (Save) clears the autosave slot after a successful download', () => {
  const exportProjectSrc = sliceBetween(appJs, "el('exportProject').onclick=", "el('exportLayout').onclick=", '#exportProject handler');
  assert.match(exportProjectSrc, /autosave\.clear\(\)/, 'Save/Export must clear the autosave recovery slot -- work that was just manually saved has nothing left to "recover"');
  assert.match(exportProjectSrc, /download\(/, 'the handler must still perform the real Project JSON download (normal Save behavior unchanged)');
});

// ---------- 4. Every "fresh start" site re-baselines the autosave slot ----------

await test('every "loading a project is a fresh start" site re-baselines the autosave slot to the newly loaded project', () => {
  const freshStartMarker = 'history.clear();cleanProjectJson=JSON.stringify(project);';
  let searchFrom = 0;
  let count = 0;
  while (true) {
    const idx = appJs.indexOf(freshStartMarker, searchFrom);
    if (idx === -1) break;
    count++;
    const after = appJs.slice(idx, idx + 800);
    assert.match(after, /lastAutosavedProjectJson=null;flushAutosaveNow\(\);/, `expected the "fresh start" site at offset ${idx} (history.clear() + dirty-baseline-reset) to also re-baseline the autosave slot`);
    searchFrom = idx + freshStartMarker.length;
  }
  // Import/Open and Gallery "Open as copy" -- see app.js's own repeated "Mirrors
  // #importProjectFile's ... fresh start" comments at each site.
  assert.equal(count, 2, 'expected exactly the two known "fresh start" sites (Import, Gallery Open as copy)');
});

// ---------- 5. pagehide flush listener exists ----------

await test("a 'pagehide' listener flushes any pending debounced autosave before the page unloads", () => {
  assert.match(appJs, /window\.addEventListener\('pagehide',flushAutosaveNow\)/);
});

// ---------- Normal Save/Open/Export behavior is unchanged ----------

await test('Export/Import handlers still perform their original, pre-recovery-feature actions (download / validateProject+replace)', () => {
  assert.match(appJs, /el\('exportProject'\)\.onclick=\(\)=>\{try\{download\('rhinestone-project\.json','application\/json',JSON\.stringify\(project,null,2\)\);cleanProjectJson=JSON\.stringify\(project\);updateHistoryUI\(\);/);
  assert.match(appJs, /validateProject\(JSON\.parse\(await file\.text\(\)\)\)/, 'Import must still validate the uploaded file exactly as before');
});

// ---------- 6. Recovery notification (#status), extracted and executed for real ----------

const notificationStartMarker = 'const RECOVERY_NOTIFICATION_DISMISS_MS=5000;';
const notificationStartIdx = appJs.indexOf(notificationStartMarker);
assert.ok(notificationStartIdx !== -1, 'expected to find the RECOVERY_NOTIFICATION_DISMISS_MS notification block in app.js');
assert.ok(appJs.trim().endsWith('}'), 'expected the notification block to still be the final statement in app.js (this test extracts to end-of-file)');
const notificationSrc = appJs.slice(notificationStartIdx);

// Sanity: this really is the tail of the file, so the extraction below is the exact real block,
// not a stale copy that happens to also appear earlier.
assert.equal(appJs.indexOf(notificationStartMarker, notificationStartIdx + 1), -1, 'RECOVERY_NOTIFICATION_DISMISS_MS must appear exactly once in app.js');

function runNotification({ bootStatusMessage, permanentEngineError = null, statusTextBeforeTimerFires = undefined }) {
  let statusText = 'Ready';
  const el = (id) => {
    assert.equal(id, 'status', `the notification block must only ever touch #status, not #${id}`);
    return {
      get textContent() { return statusText; },
      set textContent(v) { statusText = v; }
    };
  };
  let scheduledCallback = null;
  let scheduledDelay = null;
  const fakeSetTimeout = (cb, delay) => { scheduledCallback = cb; scheduledDelay = delay; return 1; };

  // The extracted block itself returns nothing; el()/setTimeout are the real closures above, so
  // their side effects (mutating statusText, capturing the scheduled callback) are what this reads.
  const fn = new Function('el', 'setTimeout', 'bootStatusMessage', 'permanentEngineError', notificationSrc);
  fn(el, fakeSetTimeout, bootStatusMessage, permanentEngineError);

  const statusRightAfterBoot = statusText;
  if (statusTextBeforeTimerFires !== undefined) statusText = statusTextBeforeTimerFires;
  if (scheduledCallback) scheduledCallback();
  return { statusRightAfterBoot, statusAfterTimerFires: statusText, timerWasScheduled: scheduledCallback !== null, scheduledDelay };
}

await test('an actual recovery shows the notification immediately in #status', () => {
  const result = runNotification({ bootStatusMessage: 'Restored unsaved changes from autosave (crash/refresh recovery).' });
  assert.equal(result.statusRightAfterBoot, 'Restored unsaved changes from autosave (crash/refresh recovery).');
});

await test('the notification auto-dismisses back to "Ready" after a few seconds', () => {
  const result = runNotification({ bootStatusMessage: 'Restored unsaved changes from autosave (crash/refresh recovery).' });
  assert.ok(result.timerWasScheduled, 'expected a dismiss timer to be scheduled');
  assert.ok(result.scheduledDelay >= 2000 && result.scheduledDelay <= 10000, `expected a "few seconds" dismiss delay, got ${result.scheduledDelay}ms`);
  assert.equal(result.statusAfterTimerFires, 'Ready');
});

await test('normal startup (nothing recovered) never shows or schedules the notification', () => {
  const result = runNotification({ bootStatusMessage: null });
  assert.equal(result.statusRightAfterBoot, 'Ready', '#status must be left completely untouched on an ordinary boot');
  assert.equal(result.timerWasScheduled, false, 'no dismiss timer should exist when there was nothing to recover');
});

await test('a font-manifest failure at boot takes priority: the recovery notification is suppressed entirely', () => {
  const result = runNotification({ bootStatusMessage: 'Restored unsaved changes from autosave (crash/refresh recovery).', permanentEngineError: new Error('manifest fetch failed') });
  assert.equal(result.statusRightAfterBoot, 'Ready', 'the recovery message must not overwrite/precede the more urgent font-manifest error message');
  assert.equal(result.timerWasScheduled, false);
});

await test('the auto-dismiss never clobbers a real action the operator took in the meantime', () => {
  const result = runNotification({
    bootStatusMessage: 'Restored unsaved changes from autosave (crash/refresh recovery).',
    statusTextBeforeTimerFires: 'Imported my-other-project.json: 2 layer(s)'
  });
  assert.equal(result.statusAfterTimerFires, 'Imported my-other-project.json: 2 layer(s)', 'a real, newer #status message must survive the recovery notification\'s own dismiss timer');
});

await test('the notification reuses #status -- no new dialog/toast/overlay element is introduced', () => {
  assert.match(notificationSrc, /el\('status'\)\.textContent=/);
  assert.doesNotMatch(notificationSrc, /createElement|innerHTML|appendChild|new Lightbox|\.open\(\)/, 'must not introduce any new DOM element, Lightbox, or dialog/workflow');
});

await test('bootStatusMessage is only ever assigned inside the boot-time recovery block -- Save/Import/New Project/Gallery/Library never trigger this notification', () => {
  // Excludes its own `let bootStatusMessage=null;` declaration (a plain re-init, not a "message
  // was actually set" assignment) -- only a real string assignment counts.
  const assignments = [...appJs.matchAll(/bootStatusMessage='/g)];
  assert.equal(assignments.length, 1, `expected exactly one real string assignment to bootStatusMessage (the boot recovery decision); found ${assignments.length}`);
  const idx = assignments[0].index;
  const precedingContext = appJs.slice(Math.max(0, idx - 400), idx);
  assert.match(precedingContext, /const recovered=autosave\.load\(\);/, 'the sole bootStatusMessage assignment must live inside the autosave recovery decision, not any Save/Import/New-Project/Gallery/Library handler');
});
