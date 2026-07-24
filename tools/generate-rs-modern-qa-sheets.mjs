#!/usr/bin/env node
/**
 * Generates RS Modern's visual acceptance package -- 12 numbered QA sheets plus an index, each as
 * both HTML and a high-resolution PNG, written to the repository-local gitignored tmp/qa/. Content
 * is the shared corpus in tools/rsModernQaCorpus.mjs (also used by the automated corpus-wide checks
 * in tools/test-rs-modern.mjs, so sheet content and test coverage never drift). Mirrors
 * tools/generate-rs-block-qa-sheets.mjs's own wiring over the shared tools/rhinestoneFontQaKit.mjs.
 *
 * Usage: node tools/generate-rs-modern-qa-sheets.mjs [output-dir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { descriptor, CAP_HEIGHT_MM, TOTAL_HEIGHT_MM } from '../src/text/rhinestoneFont/families/rsModern.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { SHEETS } from './rsModernQaCorpus.mjs';
import { createRhinestoneFontQaRunner } from './rhinestoneFontQaKit.mjs';

const run = createRhinestoneFontQaRunner({
  fontId: 'rs-modern',
  displayName: 'RS Modern',
  descriptor,
  capHeightMm: CAP_HEIGHT_MM,
  totalHeightMm: TOTAL_HEIGHT_MM,
  registry: createDefaultRhinestoneFontRegistry(),
  sheets: SHEETS,
  profileDir: '/tmp/rs-modern-qa-profile'
});

await run({ RhinestoneFontProvider, GeometryEngine, mkdir, writeFile, path, chromium });
