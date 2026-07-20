import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RC-005 — Autosave & Crash Recovery.
//
// src/persistence/test-autosave-manager.mjs already covers the pure recovery-record logic
// (schema/staleness/corruption handling) in isolation. This suite covers the app.js *wiring*
// around it, using this repository's established "extract the real source fragment, execute it via
// new Function() against minimal fakes" convention (see tools/test-rc-003-project-import-lightbox.mjs,
// tools/test-s110a-smart-shape-to-text-creation.mjs) so these tests fail on a real regression in
// app.js's own source, not just an assumption about what it does.
//
// Covered:
//  1. Boot-time recovery decision (the exact fragment between `let bootStatusMessage=null;` and
//     `let cleanProjectJson=...`): restores + normalizes via validateProject() when a usable
//     record exists, falls back to the freshly-constructed default project otherwise, and never
//     throws past a corrupt/throwing autosave.load() or an invalid recovered.project.
//  2. scheduleAutosave()/flushAutosaveNow() are wired into updateAll() and debounce-then-write
//     only on an actual content change (not "every mouse move").
//  3. Manual Save (#exportProject) clears the autosave slot.
//  4. Every "loading a project is a fresh start" site (Import/Open, Design Library "New Project",
//     Gallery "Open as copy") re-baselines the autosave slot to the newly loaded project.
//  5. A pagehide flush listener exists (mid-debounce refresh/crash must not lose the pending write).

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

await test('updateAll() calls scheduleAutosave() after regenerating (not before -- so it always sees the current project)', () => {
  const updateAllSrc = sliceBetween(appJs, 'async function updateAll(skipWrite=false){', '\n', 'updateAll()');
  const historyIdx = updateAllSrc.indexOf('updateHistoryUI()');
  const scheduleIdx = updateAllSrc.indexOf('scheduleAutosave()');
  assert.ok(historyIdx !== -1, 'expected updateAll() to call updateHistoryUI()');
  assert.ok(scheduleIdx !== -1, 'expected updateAll() to call scheduleAutosave()');
  assert.ok(scheduleIdx > historyIdx, 'scheduleAutosave() must run after the project has actually been regenerated/rendered this pass');
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
  // Import/Open, Design Library "New Project", and Gallery "Open as copy" -- see app.js's own
  // repeated "Mirrors #importProjectFile's ... fresh start" comments at each site.
  assert.equal(count, 3, 'expected exactly the three known "fresh start" sites (Import, Design Library New Project, Gallery Open as copy)');
});

// ---------- 5. pagehide flush listener exists ----------

await test("a 'pagehide' listener flushes any pending debounced autosave before the page unloads", () => {
  assert.match(appJs, /window\.addEventListener\('pagehide',flushAutosaveNow\)/);
});

// ---------- Normal Save/Open/Export behavior is unchanged ----------

await test('Export/Import/New-Project handlers still perform their original, pre-RC-005 actions (download / validateProject+replace / buildProjectFromItem)', () => {
  assert.match(appJs, /el\('exportProject'\)\.onclick=\(\)=>\{try\{download\('rhinestone-project\.json','application\/json',JSON\.stringify\(project,null,2\)\);cleanProjectJson=JSON\.stringify\(project\);updateHistoryUI\(\);/);
  assert.match(appJs, /validateProject\(JSON\.parse\(await file\.text\(\)\)\)/, 'Import must still validate the uploaded file exactly as before');
  assert.match(appJs, /buildProjectFromItem\(item,LIBRARY_NEW_PROJECT_DEFAULTS\)/, 'Design Library "New Project" must still build from the library item exactly as before');
});
