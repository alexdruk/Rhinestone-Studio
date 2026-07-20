import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RC-005A — a manual-verification follow-up to RC-005 (Autosave & Crash Recovery): the boot-time
// recovery decision itself was already correct (tools/test-rc-005-autosave-crash-recovery.mjs), but
// the #status line it wrote was silent -- a plain, never-dismissing text update easy to miss right
// after a real recovery, the exact moment it matters most. Fix: reuse #status (this app's one
// existing notification channel -- every action already reports through it) and auto-clear it back
// to "Ready" after RECOVERY_NOTIFICATION_DISMISS_MS, but only when nothing else has changed #status
// in the meantime.
//
// This suite extracts and REALLY EXECUTES the exact final block of app.js (via `new Function`
// against a minimal fake `el`/`setTimeout`), matching this repository's established
// app.js-regression convention (see tools/test-rc-003-project-import-lightbox.mjs,
// tools/test-rc-005-autosave-crash-recovery.mjs), so it fails on a real regression in app.js's own
// source, not just an assumption about behavior. The recovery *decision* itself
// (bootStatusMessage's own true/false logic) is intentionally untouched here -- see
// tools/test-rc-005-autosave-crash-recovery.mjs for that; RC-005A only ever changed how the
// decision is *displayed*.

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

// ---------- Extract the real notification block (the last statement in app.js) ----------

const startMarker = 'const RECOVERY_NOTIFICATION_DISMISS_MS=5000;';
const startIdx = appJs.indexOf(startMarker);
assert.ok(startIdx !== -1, 'expected to find the RECOVERY_NOTIFICATION_DISMISS_MS notification block in app.js');
assert.ok(appJs.trim().endsWith('}'), 'expected the notification block to still be the final statement in app.js (this test extracts to end-of-file)');
const notificationSrc = appJs.slice(startIdx);

// Sanity: this really is the tail of the file, so the extraction below is the exact real block,
// not a stale copy that happens to also appear earlier.
assert.equal(appJs.indexOf(startMarker, startIdx + 1), -1, 'RECOVERY_NOTIFICATION_DISMISS_MS must appear exactly once in app.js');

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

// ---------- Behavior ----------

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

// ---------- Wiring: "reuse the existing notification/message system", no new dialog/workflow ----------

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
