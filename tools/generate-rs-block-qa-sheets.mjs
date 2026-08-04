#!/usr/bin/env node
/**
 * Generates RS Block's visual acceptance package -- 12 numbered QA sheets plus an index, each as
 * both HTML and a high-resolution PNG, written to the repository-local gitignored tmp/qa/. Content
 * is the shared corpus in tools/rsBlockQaCorpus.mjs (also used by the automated corpus-wide checks
 * in tools/test-rs-block.mjs, so sheet content and test coverage never drift).
 *
 * FONT-002 (Part 3): the actual rendering/screenshot pipeline now lives in the family-agnostic
 * tools/rhinestoneFontQaKit.mjs (shared with tools/generate-rs-modern-qa-sheets.mjs) -- this file is
 * just RS Block's own wiring (fontId, descriptor, vertical metrics, corpus).
 *
 * Usage: node tools/generate-rs-block-qa-sheets.mjs [output-dir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { descriptor, CAP_HEIGHT_MM, TOTAL_HEIGHT_MM } from '../src/text/rhinestoneFont/families/rsBlock.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { SHEETS } from './rsBlockQaCorpus.mjs';
import { createRhinestoneFontQaRunner } from './rhinestoneFontQaKit.mjs';

const run = createRhinestoneFontQaRunner({
  fontId: 'rs-block',
  displayName: 'RS Block',
  descriptor,
  capHeightMm: CAP_HEIGHT_MM,
  totalHeightMm: TOTAL_HEIGHT_MM,
  registry: createDefaultRhinestoneFontRegistry(),
  sheets: SHEETS,
  profileDir: '/tmp/rs-block-qa-profile'
});

await run({ RhinestoneFontProvider, GeometryEngine, mkdir, writeFile, path, chromium });
