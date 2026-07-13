import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-2000 (MVP Stabilization) — regression test for two dead "Apply" buttons found during audit:
// the Text Lightbox's #textApply and the Shapes Lightbox's unlabeled primary button both had
// data-lightbox-close but no click handler in app.js, so clicking them did nothing beyond closing
// the dialog -- misleading, since every field in both dialogs already applies live through
// updateAll() (see the Text dialog's own "Changes preview live and undo/redo normally" footer
// note). Fixed by removing both dead buttons and standardizing their dismiss button to "Close",
// matching every other fully-live dialog (Import/Export/Production Sheet/Help/Library). Shipping
// and Settings keep their real Cancel+Apply pairing, since those dialogs genuinely batch
// session-local state and only commit it on Apply (see el('shipApply')/el('settingsApply')
// handlers in app.js) -- this test asserts that distinction stays intact.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

await test('1. the Text Lightbox no longer has a dead #textApply button (no id, no handler, live-apply only)', () => {
  assert.doesNotMatch(indexHtml, /id="textApply"/);
  assert.doesNotMatch(appJs, /textApply/);
});

await test('2. the Text Lightbox footer keeps its live-editing note and now has a single "Close" dismiss button', () => {
  const footer = indexHtml.match(/<footer class="lightbox-footer">\s*<span class="footer-note">Changes preview live[\s\S]*?<\/footer>/);
  assert.ok(footer, 'expected to find the Text Lightbox footer');
  assert.match(footer[0], />Close<\/button>/);
  assert.doesNotMatch(footer[0], />Apply<\/button>/);
  assert.doesNotMatch(footer[0], />Cancel<\/button>/);
});

await test('3. the Shapes Lightbox no longer has an unlabeled/unwired primary "Apply" button', () => {
  const shapesSection = indexHtml.slice(indexHtml.indexOf('id="lightboxShapes"'), indexHtml.indexOf('id="lightboxImport"'));
  assert.doesNotMatch(shapesSection, /class="btn primary" data-lightbox-close>Apply</);
  assert.match(shapesSection, /<button class="btn" data-lightbox-close>Close<\/button>\s*<\/footer>/);
});

await test('4. Shipping and Settings keep a real, wired Cancel+Apply pairing (batched session-local state, not live-applied)', () => {
  assert.match(appJs, /el\('shipApply'\)\.onclick=/);
  assert.match(appJs, /el\('settingsApply'\)\.onclick=/);
  const shipSection = indexHtml.slice(indexHtml.indexOf('id="lightboxShipping"'), indexHtml.indexOf('id="lightboxSettings"'));
  assert.match(shipSection, /id="shipApply"/);
  const settingsSection = indexHtml.slice(indexHtml.indexOf('id="lightboxSettings"'), indexHtml.indexOf('id="lightboxHelp"'));
  assert.match(settingsSection, /id="settingsApply"/);
});

await test('5. the Design Library delete-confirmation dialog keeps its real Cancel+Delete pairing (a genuine destructive-action confirmation, not a live-apply dialog)', () => {
  const confirmSection = indexHtml.slice(indexHtml.indexOf('id="lightboxLibraryConfirm"'), indexHtml.indexOf('id="lightboxLibraryConfirm"') + 800);
  assert.match(confirmSection, />Cancel<\/button>/);
  assert.match(confirmSection, /id="libraryConfirmDelete"/);
});

console.log('RS-2000 UI fix tests passed.');
